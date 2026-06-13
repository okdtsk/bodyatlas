import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

export const accountRoutes = new Hono<ProtectedEnv>().get('/export', async (c) => {
  const db = getDb(c.env.DB);
  const userId = c.get('userId');

  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) return c.json({ error: { code: 'not_found', message: 'User not found' } }, 404);
  const { googleSub: _g, ...userExport } = user;

  const workouts = await db.query.workouts.findMany({
    where: eq(schema.workouts.userId, userId),
    with: { workoutExercises: { with: { sets: true } } },
  });
  const templates = await db.query.templates.findMany({
    where: eq(schema.templates.userId, userId),
    with: { templateExercises: true },
  });
  const meals = await db.select().from(schema.meals).where(eq(schema.meals.userId, userId));
  const sleep = await db.select().from(schema.sleepRecords).where(eq(schema.sleepRecords.userId, userId));
  const measurements = await db
    .select()
    .from(schema.bodyMeasurements)
    .where(eq(schema.bodyMeasurements.userId, userId));
  const exercises = await db.select().from(schema.exercises).where(eq(schema.exercises.userId, userId));

  const tokenRows = await db.select().from(schema.apiTokens).where(eq(schema.apiTokens.userId, userId));
  const apiTokens = tokenRows.map((t) => ({ name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt }));
  const ai = await db.query.aiSettings.findFirst({ where: eq(schema.aiSettings.userId, userId) });
  const aiSettings = ai ? { provider: ai.provider, model: ai.model } : null;

  const payload = {
    exportedAt: new Date().toISOString(),
    user: userExport,
    workouts,
    templates,
    meals,
    sleep,
    measurements,
    exercises,
    apiTokens,
    aiSettings,
  };
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="bodyatlas-export-${date}.json"`,
    },
  });
});
