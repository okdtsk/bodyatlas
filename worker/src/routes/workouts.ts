import { zValidator } from '@hono/zod-validator';
import { createWorkoutSchema, updateWorkoutSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema, type Db } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Workout not found' } } as const;

export async function loadWorkoutDetail(db: Db, userId: string, id: string) {
  return db.query.workouts.findFirst({
    where: and(eq(schema.workouts.id, id), eq(schema.workouts.userId, userId)),
    with: {
      workoutExercises: {
        orderBy: asc(schema.workoutExercises.position),
        with: { exercise: true, sets: { orderBy: asc(schema.sets.position) } },
      },
    },
  });
}

async function findActive(db: Db, userId: string) {
  return db.query.workouts.findFirst({
    where: and(eq(schema.workouts.userId, userId), isNull(schema.workouts.endedAt)),
  });
}

export const workoutsRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const { from, to, exerciseId } = c.req.query();
    const limit = Math.min(Number(c.req.query('limit') ?? 30) || 30, 100);

    let idFilter: string[] | undefined;
    if (exerciseId) {
      const rows = await db
        .selectDistinct({ workoutId: schema.workoutExercises.workoutId })
        .from(schema.workoutExercises)
        .where(eq(schema.workoutExercises.exerciseId, exerciseId));
      idFilter = rows.map((r) => r.workoutId);
      if (idFilter.length === 0) return c.json([]);
    }

    const rows = await db.query.workouts.findMany({
      where: and(
        eq(schema.workouts.userId, userId),
        from ? gte(schema.workouts.startedAt, new Date(from)) : undefined,
        to ? lte(schema.workouts.startedAt, new Date(to)) : undefined,
        idFilter ? inArray(schema.workouts.id, idFilter) : undefined,
      ),
      orderBy: desc(schema.workouts.startedAt),
      limit,
      with: {
        workoutExercises: {
          orderBy: asc(schema.workoutExercises.position),
          with: { exercise: true, sets: true },
        },
      },
    });

    return c.json(
      rows.map((w) => ({
        id: w.id,
        startedAt: w.startedAt,
        endedAt: w.endedAt,
        notes: w.notes,
        templateId: w.templateId,
        exerciseNames: w.workoutExercises.map((we) => we.exercise.nameEn),
        exerciseNamesJa: w.workoutExercises.map((we) => we.exercise.nameJa ?? we.exercise.nameEn),
        setCount: w.workoutExercises.reduce((n, we) => n + we.sets.length, 0),
      })),
    );
  })
  .get('/active', async (c) => {
    const db = getDb(c.env.DB);
    const active = await findActive(db, c.get('userId'));
    if (!active) return c.json({ workout: null });
    return c.json({ workout: await loadWorkoutDetail(db, c.get('userId'), active.id) });
  })
  .post(
    '/',
    zValidator('json', createWorkoutSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const userId = c.get('userId');
      const input = c.req.valid('json');

      const active = await findActive(db, userId);
      if (active) {
        return c.json(
          {
            error: {
              code: 'active_workout_exists',
              message: 'A workout is already in progress',
              details: { workoutId: active.id },
            },
          },
          409,
        );
      }

      let exerciseIds: string[] = [];
      let templateId: string | null = null;
      if (input.templateId) {
        const tpl = await db.query.templates.findFirst({
          where: and(eq(schema.templates.id, input.templateId), eq(schema.templates.userId, userId)),
          with: { templateExercises: { orderBy: asc(schema.templateExercises.position) } },
        });
        if (!tpl) return c.json({ error: { code: 'not_found', message: 'Template not found' } }, 404);
        templateId = tpl.id;
        exerciseIds = tpl.templateExercises.map((te) => te.exerciseId);
      } else if (input.copyFromWorkoutId) {
        const source = await loadWorkoutDetail(db, userId, input.copyFromWorkoutId);
        if (!source) return c.json(notFound, 404);
        exerciseIds = source.workoutExercises.map((we) => we.exercise.id);
      }

      const id = crypto.randomUUID();
      const inserts = [
        db.insert(schema.workouts).values({ id, userId, templateId }),
        ...exerciseIds.map((exerciseId, i) =>
          db.insert(schema.workoutExercises).values({
            id: crypto.randomUUID(),
            workoutId: id,
            exerciseId,
            position: i + 1,
          }),
        ),
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.batch(inserts as any);
      return c.json(await loadWorkoutDetail(db, userId, id), 201);
    },
  )
  .get('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const detail = await loadWorkoutDetail(db, c.get('userId'), c.req.param('id'));
    if (!detail) return c.json(notFound, 404);
    return c.json(detail);
  })
  .patch(
    '/:id',
    zValidator('json', updateWorkoutSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const userId = c.get('userId');
      const id = c.req.param('id');
      const existing = await db.query.workouts.findFirst({
        where: and(eq(schema.workouts.id, id), eq(schema.workouts.userId, userId)),
      });
      if (!existing) return c.json(notFound, 404);
      const input = c.req.valid('json');
      await db
        .update(schema.workouts)
        .set({
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.finish ? { endedAt: new Date() } : {}),
        })
        .where(eq(schema.workouts.id, id));
      return c.json(await loadWorkoutDetail(db, userId, id));
    },
  )
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const id = c.req.param('id');
    const existing = await db.query.workouts.findFirst({
      where: and(eq(schema.workouts.id, id), eq(schema.workouts.userId, userId)),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.workouts).where(eq(schema.workouts.id, id)); // cascades
    return c.json({ ok: true });
  });
