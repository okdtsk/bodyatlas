import { zValidator } from '@hono/zod-validator';
import { aiSettingsInputSchema } from '@bodyatlas/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { AiError, complete } from '../lib/llm';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({
    error: { code: 'validation', message: 'Invalid request body', details: issues },
  }) as const;

const validateSettings = zValidator('json', aiSettingsInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

/** Shape returned by GET and PUT (never key material). */
function toSettingsResponse(row: {
  provider: string;
  model: string;
  lastReviewAt: Date | null;
}) {
  return {
    provider: row.provider,
    model: row.model,
    hasKey: true,
    lastReviewAt: row.lastReviewAt ? row.lastReviewAt.toISOString() : null,
  };
}

export const aiRoutes = new Hono<ProtectedEnv>()
  .get('/settings', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const row = await db.query.aiSettings.findFirst({
      where: eq(schema.aiSettings.userId, userId),
    });
    if (!row) {
      return c.json({ provider: null, hasKey: false });
    }
    return c.json(toSettingsResponse(row));
  })

  .put('/settings', validateSettings, async (c) => {
    const input = c.req.valid('json');
    const userId = c.get('userId');
    const db = getDb(c.env.DB);

    // Load existing row to decide whether a key is required
    const existing = await db.query.aiSettings.findFirst({
      where: eq(schema.aiSettings.userId, userId),
    });

    let encryptedKey: string;
    let keyIv: string;

    if (input.apiKey) {
      // Encrypt new key
      const encrypted = await encryptSecret(input.apiKey, c.env.AI_KEY_SECRET);
      encryptedKey = encrypted.ciphertext;
      keyIv = encrypted.iv;
    } else if (existing) {
      // Keep existing key
      encryptedKey = existing.encryptedKey;
      keyIv = existing.keyIv;
    } else {
      // No key, no existing row → 422
      return c.json(
        {
          error: {
            code: 'validation',
            message: 'apiKey is required when no settings are stored yet',
          },
        },
        422,
      );
    }

    const now = new Date();
    const values = {
      userId,
      provider: input.provider,
      model: input.model,
      encryptedKey,
      keyIv,
      lastReview: existing?.lastReview ?? null,
      lastReviewAt: existing?.lastReviewAt ?? null,
      updatedAt: now,
    };

    await db
      .insert(schema.aiSettings)
      .values(values)
      .onConflictDoUpdate({
        target: schema.aiSettings.userId,
        set: {
          provider: input.provider,
          model: input.model,
          encryptedKey,
          keyIv,
          updatedAt: now,
        },
      });

    // Re-fetch to build the response from the stored row
    const saved = await db.query.aiSettings.findFirst({
      where: eq(schema.aiSettings.userId, userId),
    });

    return c.json(toSettingsResponse(saved!));
  })

  .delete('/settings', async (c) => {
    const userId = c.get('userId');
    const db = getDb(c.env.DB);
    await db.delete(schema.aiSettings).where(eq(schema.aiSettings.userId, userId));
    return c.json({ ok: true });
  })

  .post('/test', async (c) => {
    const userId = c.get('userId');
    const db = getDb(c.env.DB);
    const row = await db.query.aiSettings.findFirst({
      where: eq(schema.aiSettings.userId, userId),
    });

    if (!row) {
      return c.json(
        { error: { code: 'ai_not_configured', message: 'No AI settings configured' } },
        409,
      );
    }

    let apiKey: string;
    try {
      apiKey = await decryptSecret(row.encryptedKey, row.keyIv, c.env.AI_KEY_SECRET);
    } catch {
      return c.json(
        { error: { code: 'ai_error', message: 'Failed to decrypt API key' } },
        502,
      );
    }

    try {
      await complete({
        provider: row.provider,
        model: row.model,
        apiKey,
        system: 'You are a helpful assistant.',
        prompt: 'Reply with exactly: ok',
        maxTokens: 20,
      });
      return c.json({ ok: true });
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'AI request failed';
      return c.json({ error: { code: 'ai_error', message } }, 502);
    }
  });
