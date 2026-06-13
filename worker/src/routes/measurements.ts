import { zValidator } from '@hono/zod-validator';
import { measurementInputSchema, type MeasurementInput } from '@bodyatlas/shared';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Measurement not found' } } as const;

const validate = zValidator('json', measurementInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

// Full-replace EXCEPT the timestamp: omitting measuredAt preserves the stored value (defaultFn only applies on create).
function toRow(input: MeasurementInput) {
  return {
    ...(input.measuredAt ? { measuredAt: new Date(input.measuredAt) } : {}),
    weightKg: input.weightKg ?? null,
    bodyFatPct: input.bodyFatPct ?? null,
  };
}

export const measurementsRoutes = new Hono<ProtectedEnv>()
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
      .from(schema.bodyMeasurements)
      .where(
        and(
          eq(schema.bodyMeasurements.userId, c.get('userId')),
          fromDate ? gte(schema.bodyMeasurements.measuredAt, fromDate) : undefined,
          toDate ? lt(schema.bodyMeasurements.measuredAt, toDate) : undefined,
        ),
      )
      .orderBy(asc(schema.bodyMeasurements.measuredAt))
      .limit(100);
    return c.json(rows);
  })
  .post('/', validate, async (c) => {
    const db = getDb(c.env.DB);
    const input = c.req.valid('json');
    if (input.clientId) {
      const dup = await db.query.bodyMeasurements.findFirst({
        where: and(
          eq(schema.bodyMeasurements.userId, c.get('userId')),
          eq(schema.bodyMeasurements.clientId, input.clientId),
        ),
      });
      if (dup) return c.json(dup, 200);
    }
    const id = crypto.randomUUID();
    await db
      .insert(schema.bodyMeasurements)
      .values({ id, userId: c.get('userId'), clientId: input.clientId ?? null, ...toRow(input) })
      .onConflictDoNothing({ target: schema.bodyMeasurements.clientId });
    const created = await db.query.bodyMeasurements.findFirst({
      where: input.clientId
        ? and(
            eq(schema.bodyMeasurements.userId, c.get('userId')),
            eq(schema.bodyMeasurements.clientId, input.clientId),
          )
        : eq(schema.bodyMeasurements.id, id),
    });
    return c.json(created, 201);
  })
  .put('/:id', validate, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.bodyMeasurements.findFirst({
      where: and(eq(schema.bodyMeasurements.id, id), eq(schema.bodyMeasurements.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.update(schema.bodyMeasurements).set(toRow(c.req.valid('json'))).where(eq(schema.bodyMeasurements.id, id));
    return c.json(await db.query.bodyMeasurements.findFirst({ where: eq(schema.bodyMeasurements.id, id) }));
  })
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.bodyMeasurements.findFirst({
      where: and(eq(schema.bodyMeasurements.id, id), eq(schema.bodyMeasurements.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.bodyMeasurements).where(eq(schema.bodyMeasurements.id, id));
    return c.json({ ok: true });
  });
