import { zValidator } from '@hono/zod-validator';
import { sleepInputSchema, type SleepInput } from '@bodyatlas/shared';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Sleep record not found' } } as const;

const validate = zValidator('json', sleepInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

function toRow(input: SleepInput) {
  return {
    bedAt: new Date(input.bedAt),
    wokeAt: new Date(input.wokeAt),
    quality: input.quality ?? null,
    notes: input.notes ?? null,
  };
}

export const sleepRoutes = new Hono<ProtectedEnv>()
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
      .from(schema.sleepRecords)
      .where(
        and(
          eq(schema.sleepRecords.userId, c.get('userId')),
          fromDate ? gte(schema.sleepRecords.wokeAt, fromDate) : undefined,
          toDate ? lt(schema.sleepRecords.wokeAt, toDate) : undefined,
        ),
      )
      .orderBy(asc(schema.sleepRecords.wokeAt))
      .limit(100);
    return c.json(rows);
  })
  .post('/', validate, async (c) => {
    const db = getDb(c.env.DB);
    const input = c.req.valid('json');
    if (input.clientId) {
      const dup = await db.query.sleepRecords.findFirst({
        where: and(
          eq(schema.sleepRecords.userId, c.get('userId')),
          eq(schema.sleepRecords.clientId, input.clientId),
        ),
      });
      if (dup) return c.json(dup, 200);
    }
    const id = crypto.randomUUID();
    await db
      .insert(schema.sleepRecords)
      .values({ id, userId: c.get('userId'), clientId: input.clientId ?? null, ...toRow(input) })
      .onConflictDoNothing({ target: schema.sleepRecords.clientId });
    const created = await db.query.sleepRecords.findFirst({
      where: input.clientId
        ? and(
            eq(schema.sleepRecords.userId, c.get('userId')),
            eq(schema.sleepRecords.clientId, input.clientId),
          )
        : eq(schema.sleepRecords.id, id),
    });
    return c.json(created, 201);
  })
  .put('/:id', validate, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.sleepRecords.findFirst({
      where: and(eq(schema.sleepRecords.id, id), eq(schema.sleepRecords.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.update(schema.sleepRecords).set(toRow(c.req.valid('json'))).where(eq(schema.sleepRecords.id, id));
    return c.json(await db.query.sleepRecords.findFirst({ where: eq(schema.sleepRecords.id, id) }));
  })
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.sleepRecords.findFirst({
      where: and(eq(schema.sleepRecords.id, id), eq(schema.sleepRecords.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.sleepRecords).where(eq(schema.sleepRecords.id, id));
    return c.json({ ok: true });
  });
