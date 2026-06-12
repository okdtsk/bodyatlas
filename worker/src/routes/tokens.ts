import { zValidator } from '@hono/zod-validator';
import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { generateToken, sha256Hex } from '../auth/tokens';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;

const notFound = { error: { code: 'not_found', message: 'Token not found' } } as const;

const tokenNameSchema = z.object({
  name: z.string().trim().min(1).max(60),
});

const validateName = zValidator('json', tokenNameSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

export const tokensRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const rows = await db
      .select({
        id: schema.apiTokens.id,
        name: schema.apiTokens.name,
        createdAt: schema.apiTokens.createdAt,
        lastUsedAt: schema.apiTokens.lastUsedAt,
      })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.userId, userId))
      .orderBy(desc(schema.apiTokens.createdAt));
    return c.json(rows);
  })
  .post('/', validateName, async (c) => {
    const { name } = c.req.valid('json');
    const userId = c.get('userId');
    const db = getDb(c.env.DB);
    const token = generateToken();
    const tokenHash = await sha256Hex(token);
    const id = crypto.randomUUID();
    const now = new Date();
    await db.insert(schema.apiTokens).values({
      id,
      userId,
      name,
      tokenHash,
      createdAt: now,
    });
    return c.json(
      {
        id,
        name,
        createdAt: now,
        token,
      },
      201,
    );
  })
  .delete('/:id', async (c) => {
    const userId = c.get('userId');
    const { id } = c.req.param();
    const db = getDb(c.env.DB);
    const row = await db.query.apiTokens.findFirst({
      where: and(eq(schema.apiTokens.id, id), eq(schema.apiTokens.userId, userId)),
    });
    if (!row) return c.json(notFound, 404);
    await db.delete(schema.apiTokens).where(eq(schema.apiTokens.id, id));
    return c.json({ ok: true });
  });
