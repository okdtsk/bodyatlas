import { and, asc, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import { strengthSeries } from '../lib/stats';
import type { ProtectedEnv } from '../types';

const DEFAULT_WINDOW_DAYS = 84;

function parseFrom(raw: string | undefined): Date | null {
  if (!raw) return new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
const invalidFrom = { error: { code: 'validation', message: 'Invalid from date' } } as const;

export const trendsRoutes = new Hono<ProtectedEnv>()
  .get('/strength/:exerciseId', async (c) => {
    const from = parseFrom(c.req.query('from'));
    if (!from) return c.json(invalidFrom, 422);
    const db = getDb(c.env.DB);
    const series = await strengthSeries(db, c.get('userId'), c.req.param('exerciseId'), from);
    return c.json(series);
  })
  .get('/volume', async (c) => {
    const from = parseFrom(c.req.query('from'));
    if (!from) return c.json(invalidFrom, 422);
    const db = getDb(c.env.DB);
    const rows = await db
      .select({
        startedAt: schema.workouts.startedAt,
        muscleGroup: schema.exercises.muscleGroup,
        setId: schema.sets.id,
      })
      .from(schema.sets)
      .innerJoin(schema.workoutExercises, eq(schema.sets.workoutExerciseId, schema.workoutExercises.id))
      .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
      .innerJoin(schema.exercises, eq(schema.workoutExercises.exerciseId, schema.exercises.id))
      .where(and(eq(schema.workouts.userId, c.get('userId')), gte(schema.workouts.startedAt, from)));

    const byKey = new Map<string, { startedAt: Date; muscleGroup: string; setCount: number }>();
    for (const row of rows) {
      const key = `${row.startedAt.getTime()}|${row.muscleGroup}`;
      const entry = byKey.get(key) ?? { startedAt: row.startedAt, muscleGroup: row.muscleGroup, setCount: 0 };
      entry.setCount += 1;
      byKey.set(key, entry);
    }
    return c.json([...byKey.values()]);
  })
  .get('/nutrition-body', async (c) => {
    const from = parseFrom(c.req.query('from'));
    if (!from) return c.json(invalidFrom, 422);
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const meals = await db
      .select({ eatenAt: schema.meals.eatenAt, calories: schema.meals.calories, proteinG: schema.meals.proteinG })
      .from(schema.meals)
      .where(and(eq(schema.meals.userId, userId), gte(schema.meals.eatenAt, from)))
      .orderBy(asc(schema.meals.eatenAt))
      .limit(2000);
    const measurements = await db
      .select({
        measuredAt: schema.bodyMeasurements.measuredAt,
        weightKg: schema.bodyMeasurements.weightKg,
        bodyFatPct: schema.bodyMeasurements.bodyFatPct,
      })
      .from(schema.bodyMeasurements)
      .where(and(eq(schema.bodyMeasurements.userId, userId), gte(schema.bodyMeasurements.measuredAt, from)))
      .orderBy(asc(schema.bodyMeasurements.measuredAt))
      .limit(2000);
    return c.json({ meals, measurements });
  });
