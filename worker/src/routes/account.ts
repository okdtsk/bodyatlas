import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { getCookie, deleteCookie } from 'hono/cookie';
import { SESSION_COOKIE } from '../auth/middleware';
import { deleteSession } from '../auth/session';
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
})
  .delete('/', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');

    const workoutIds = (
      await db.select({ id: schema.workouts.id }).from(schema.workouts).where(eq(schema.workouts.userId, userId))
    ).map((r) => r.id);
    if (workoutIds.length > 0) {
      const weIds = (
        await db.select({ id: schema.workoutExercises.id }).from(schema.workoutExercises)
          .where(inArray(schema.workoutExercises.workoutId, workoutIds))
      ).map((r) => r.id);
      if (weIds.length > 0) {
        await db.delete(schema.sets).where(inArray(schema.sets.workoutExerciseId, weIds));
        await db.delete(schema.workoutExercises).where(inArray(schema.workoutExercises.id, weIds));
      }
      await db.delete(schema.workouts).where(eq(schema.workouts.userId, userId));
    }

    const templateIds = (
      await db.select({ id: schema.templates.id }).from(schema.templates).where(eq(schema.templates.userId, userId))
    ).map((r) => r.id);
    if (templateIds.length > 0) {
      await db.delete(schema.templateExercises).where(inArray(schema.templateExercises.templateId, templateIds));
      await db.delete(schema.templates).where(eq(schema.templates.userId, userId));
    }

    await db.delete(schema.meals).where(eq(schema.meals.userId, userId));
    await db.delete(schema.sleepRecords).where(eq(schema.sleepRecords.userId, userId));
    await db.delete(schema.bodyMeasurements).where(eq(schema.bodyMeasurements.userId, userId));
    await db.delete(schema.aiSettings).where(eq(schema.aiSettings.userId, userId));
    await db.delete(schema.exercises).where(eq(schema.exercises.userId, userId));
    await db.delete(schema.users).where(eq(schema.users.id, userId));

    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.env.SESSIONS, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });

    return c.json({ ok: true });
  });
