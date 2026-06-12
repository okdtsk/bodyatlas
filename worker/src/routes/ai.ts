import { zValidator } from '@hono/zod-validator';
import { aiSettingsInputSchema, estimateMealInputSchema, estimateResultSchema } from '@bodyatlas/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { decryptSecret, encryptSecret } from '../lib/crypto';
import { AiError, complete } from '../lib/llm';
import { buildCoachSummary } from '../lib/coach';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

/**
 * Strips optional markdown code fences (```json ... ``` or ``` ... ```)
 * from LLM output, then JSON.parses the result.
 */
export function parseStrictJson(text: string): unknown {
  let cleaned = text.trim();
  // Strip leading fence with optional language tag (e.g. ```json or ```)
  cleaned = cleaned.replace(/^```[a-z]*\n?/i, '');
  // Strip trailing fence
  cleaned = cleaned.replace(/\n?```\s*$/, '');
  return JSON.parse(cleaned.trim());
}

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
  })

  .post(
    '/estimate-meal',
    zValidator('json', estimateMealInputSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const userId = c.get('userId');
      const db = getDb(c.env.DB);
      const { description } = c.req.valid('json');

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
        return c.json({ error: { code: 'ai_error', message: 'Failed to decrypt API key' } }, 502);
      }

      const system =
        'You are a nutrition expert. The user will describe a meal or food item. ' +
        'Reply with ONLY minified JSON (no code fences, no explanation) matching exactly these fields: ' +
        '{"calories":<int 0-10000>,"proteinG":<number>,"fatG":<number>,"carbsG":<number>,' +
        '"confidence":"low"|"medium"|"high","note":"<optional string ≤100 chars>"}';

      let rawText: string;
      try {
        rawText = await complete({
          provider: row.provider,
          model: row.model,
          apiKey,
          system,
          prompt: description,
          maxTokens: 400,
        });
      } catch (err) {
        const message = err instanceof AiError ? err.message : 'AI request failed';
        return c.json({ error: { code: 'ai_error', message } }, 502);
      }

      let parsed: unknown;
      try {
        parsed = parseStrictJson(rawText);
      } catch {
        return c.json(
          { error: { code: 'ai_parse_error', message: 'Failed to parse AI response as JSON' } },
          502,
        );
      }

      const result = estimateResultSchema.safeParse(parsed);
      if (!result.success) {
        return c.json(
          {
            error: {
              code: 'ai_parse_error',
              message: 'AI response did not match expected nutrition schema',
            },
          },
          502,
        );
      }

      return c.json(result.data);
    },
  )

  .post('/coach-review', async (c) => {
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
      return c.json({ error: { code: 'ai_error', message: 'Failed to decrypt API key' } }, 502);
    }

    // Build 28-day summary
    const summary = await buildCoachSummary(db, userId);

    // Load user locale for locale-aware prompt
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    const locale = user?.locale ?? 'en';
    const langInstruction =
      locale === 'ja'
        ? 'Respond entirely in Japanese.'
        : 'Respond in English.';

    const system =
      `You are a friendly, evidence-based personal coach. ${langInstruction} ` +
      'Structure your response with three sections: ' +
      '**Wins** (what went well), **Focus Areas** (what to improve), and **Suggestions for Next Week**. ' +
      'Keep the total response to ≤300 words. Use plain text with simple headings.';

    const prompt = JSON.stringify(summary);

    let review: string;
    try {
      review = await complete({
        provider: row.provider,
        model: row.model,
        apiKey,
        system,
        prompt,
        maxTokens: 1500,
      });
    } catch (err) {
      // Provider failure — do NOT overwrite prior stored review
      const message = err instanceof AiError ? err.message : 'AI request failed';
      return c.json({ error: { code: 'ai_error', message } }, 502);
    }

    // Persist review
    const generatedAt = new Date();
    await db
      .update(schema.aiSettings)
      .set({ lastReview: review, lastReviewAt: generatedAt })
      .where(eq(schema.aiSettings.userId, userId));

    return c.json({ review, generatedAt: generatedAt.toISOString() });
  })

  .get('/review', async (c) => {
    const userId = c.get('userId');
    const db = getDb(c.env.DB);

    const row = await db.query.aiSettings.findFirst({
      where: eq(schema.aiSettings.userId, userId),
    });

    if (!row || !row.lastReview) {
      return c.json({ review: null, generatedAt: null });
    }

    return c.json({
      review: row.lastReview,
      generatedAt: row.lastReviewAt ? row.lastReviewAt.toISOString() : null,
    });
  });
