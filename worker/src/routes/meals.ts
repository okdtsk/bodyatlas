import { zValidator } from '@hono/zod-validator';
import { mealFavoriteSchema, mealInputSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, gte, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import { likeContains } from '../lib/sql';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Meal not found' } } as const;

const validateMeal = zValidator('json', mealInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

// Full-replace EXCEPT the timestamp: omitting eatenAt preserves the stored value (defaultFn only applies on create).
function toRow(input: import('@bodyatlas/shared').MealInput) {
  return {
    name: input.name,
    ...(input.eatenAt ? { eatenAt: new Date(input.eatenAt) } : {}),
    calories: input.calories ?? null,
    proteinG: input.proteinG ?? null,
    fatG: input.fatG ?? null,
    carbsG: input.carbsG ?? null,
    notes: input.notes ?? null,
  };
}

export const mealsRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const { from, to } = c.req.query();
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return c.json({ error: { code: 'validation', message: 'Invalid from/to date' } }, 422);
    }
    const rows = await db
      .select()
      .from(schema.meals)
      .where(
        and(
          eq(schema.meals.userId, c.get('userId')),
          fromDate ? gte(schema.meals.eatenAt, fromDate) : undefined,
          toDate ? lt(schema.meals.eatenAt, toDate) : undefined,
        ),
      )
      .orderBy(asc(schema.meals.eatenAt))
      .limit(200);
    return c.json(rows);
  })
  .get('/search', async (c) => {
    const db = getDb(c.env.DB);
    const q = c.req.query('q');
    const rows = await db
      .select()
      .from(schema.meals)
      .where(
        and(
          eq(schema.meals.userId, c.get('userId')),
          q ? likeContains(schema.meals.name, q) : undefined,
        ),
      )
      .orderBy(desc(schema.meals.eatenAt))
      .limit(300);
    // Dedupe by name (rows are newest-first, so the first hit per name carries
    // the latest nutrition); a name is favorite if ANY of its rows is.
    const byName = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byName.get(row.name);
      if (!existing) {
        byName.set(row.name, row);
      } else if (row.isFavorite && !existing.isFavorite) {
        byName.set(row.name, { ...existing, isFavorite: true });
      }
    }
    const deduped = [...byName.values()]
      .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite))
      .slice(0, 20);
    return c.json(deduped);
  })
  .post('/', validateMeal, async (c) => {
    const db = getDb(c.env.DB);
    const input = c.req.valid('json');
    if (input.clientId) {
      const dup = await db.query.meals.findFirst({
        where: and(eq(schema.meals.userId, c.get('userId')), eq(schema.meals.clientId, input.clientId)),
      });
      if (dup) return c.json(dup, 200);
    }
    const id = crypto.randomUUID();
    await db
      .insert(schema.meals)
      .values({ id, userId: c.get('userId'), clientId: input.clientId ?? null, ...toRow(input) })
      .onConflictDoNothing({ target: schema.meals.clientId });
    const created = await db.query.meals.findFirst({
      where: input.clientId
        ? and(eq(schema.meals.userId, c.get('userId')), eq(schema.meals.clientId, input.clientId))
        : eq(schema.meals.id, id),
    });
    return c.json(created, 201);
  })
  .put('/:id', validateMeal, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.meals.findFirst({
      where: and(eq(schema.meals.id, id), eq(schema.meals.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.update(schema.meals).set(toRow(c.req.valid('json'))).where(eq(schema.meals.id, id));
    return c.json(await db.query.meals.findFirst({ where: eq(schema.meals.id, id) }));
  })
  .patch(
    '/:id/favorite',
    zValidator('json', mealFavoriteSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const id = c.req.param('id');
      const existing = await db.query.meals.findFirst({
        where: and(eq(schema.meals.id, id), eq(schema.meals.userId, c.get('userId'))),
      });
      if (!existing) return c.json(notFound, 404);
      await db
        .update(schema.meals)
        .set({ isFavorite: c.req.valid('json').isFavorite })
        .where(eq(schema.meals.id, id));
      return c.json(await db.query.meals.findFirst({ where: eq(schema.meals.id, id) }));
    },
  )
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.meals.findFirst({
      where: and(eq(schema.meals.id, id), eq(schema.meals.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.meals).where(eq(schema.meals.id, id));
    return c.json({ ok: true });
  });
