import { zValidator } from '@hono/zod-validator';
import { updateMeSchema } from '@bodyatlas/shared';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

function toMe(user: typeof schema.users.$inferSelect) {
  const { googleSub: _googleSub, createdAt: _createdAt, ...me } = user;
  return me;
}

export const meRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, c.get('userId')),
    });
    if (!user) {
      return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
    }
    return c.json(toMe(user));
  })
  .patch(
    '/',
    zValidator('json', updateMeSchema, (result, c) => {
      if (!result.success) {
        return c.json(
          {
            error: {
              code: 'validation',
              message: 'Invalid request body',
              details: result.error.issues,
            },
          },
          422,
        );
      }
    }),
    async (c) => {
      const patch = c.req.valid('json');
      const db = getDb(c.env.DB);
      if (Object.keys(patch).length > 0) {
        await db
          .update(schema.users)
          .set(patch)
          .where(eq(schema.users.id, c.get('userId')));
      }
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, c.get('userId')),
      });
      if (!user) {
        return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
      }
      return c.json(toMe(user));
    },
  );
