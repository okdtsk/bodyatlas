import { zValidator } from '@hono/zod-validator';
import { addWorkoutExerciseSchema, createWorkoutSchema, setInputSchema, updateWorkoutSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
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

/** Loads a workout_exercise only if its workout belongs to the user. */
async function ownedWorkoutExercise(db: Db, userId: string, workoutId: string, weId: string) {
  const [row] = await db
    .select({ id: schema.workoutExercises.id })
    .from(schema.workoutExercises)
    .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
    .where(
      and(
        eq(schema.workoutExercises.id, weId),
        eq(schema.workoutExercises.workoutId, workoutId),
        eq(schema.workouts.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export const workoutsRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const { from, to, exerciseId } = c.req.query();
    const limit = Math.max(1, Math.min(Number(c.req.query('limit') ?? 30) || 30, 100));

    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return c.json({ error: { code: 'validation', message: 'Invalid from/to date' } }, 422);
    }

    let idFilter: string[] | undefined;
    if (exerciseId) {
      const rows = await db
        .selectDistinct({ workoutId: schema.workoutExercises.workoutId })
        .from(schema.workoutExercises)
        .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
        .where(and(eq(schema.workoutExercises.exerciseId, exerciseId), eq(schema.workouts.userId, userId)));
      idFilter = rows.map((r) => r.workoutId);
      if (idFilter.length === 0) return c.json([]);
    }

    const rows = await db.query.workouts.findMany({
      where: and(
        eq(schema.workouts.userId, userId),
        fromDate ? gte(schema.workouts.startedAt, fromDate) : undefined,
        toDate ? lte(schema.workouts.startedAt, toDate) : undefined,
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

      let exercisePairs: Array<{ exerciseId: string; targetSets: number | null }> = [];
      let templateId: string | null = null;
      if (input.templateId) {
        const tpl = await db.query.templates.findFirst({
          where: and(eq(schema.templates.id, input.templateId), eq(schema.templates.userId, userId)),
          with: { templateExercises: { orderBy: asc(schema.templateExercises.position) } },
        });
        if (!tpl) return c.json({ error: { code: 'not_found', message: 'Template not found' } }, 404);
        templateId = tpl.id;
        exercisePairs = tpl.templateExercises.map((te) => ({
          exerciseId: te.exerciseId,
          targetSets: te.targetSets ?? null,
        }));
      } else if (input.copyFromWorkoutId) {
        const source = await loadWorkoutDetail(db, userId, input.copyFromWorkoutId);
        if (!source) return c.json(notFound, 404);
        exercisePairs = source.workoutExercises.map((we) => ({
          exerciseId: we.exercise.id,
          targetSets: we.targetSets ?? null,
        }));
      }

      const id = crypto.randomUUID();
      const inserts = [
        db.insert(schema.workouts).values({ id, userId, templateId }),
        ...exercisePairs.map(({ exerciseId, targetSets }, i) =>
          db.insert(schema.workoutExercises).values({
            id: crypto.randomUUID(),
            workoutId: id,
            exerciseId,
            position: i + 1,
            targetSets,
          }),
        ),
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.batch(inserts as any);
      return c.json(await loadWorkoutDetail(db, userId, id), 201);
    },
  )
  // --- nested: workout exercises ---
  // Nested mutations intentionally work on finished workouts too: editing past
  // sessions (e.g., fixing a mistyped weight from history) is a feature. The
  // single-active rule only governs workout creation, not edits.
  .post(
    '/:id/exercises',
    zValidator('json', addWorkoutExerciseSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const userId = c.get('userId');
      const workout = await db.query.workouts.findFirst({
        where: and(eq(schema.workouts.id, c.req.param('id')), eq(schema.workouts.userId, userId)),
      });
      if (!workout) return c.json(notFound, 404);
      const { exerciseId } = c.req.valid('json');
      // Unlike templates, archived exercises may still be added mid-workout;
      // archiving only prevents new template references.
      const exercise = await db.query.exercises.findFirst({
        where: and(
          eq(schema.exercises.id, exerciseId),
          or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
        ),
      });
      if (!exercise) return c.json(validationError([{ message: 'Unknown exerciseId' }]), 422);
      const existing = await db
        .select({ position: schema.workoutExercises.position })
        .from(schema.workoutExercises)
        .where(eq(schema.workoutExercises.workoutId, workout.id))
        .orderBy(desc(schema.workoutExercises.position))
        .limit(1);
      const we = {
        id: crypto.randomUUID(),
        workoutId: workout.id,
        exerciseId,
        position: (existing[0]?.position ?? 0) + 1,
      };
      await db.insert(schema.workoutExercises).values(we);
      return c.json({ ...we, exercise }, 201);
    },
  )
  .delete('/:id/exercises/:weId', async (c) => {
    const db = getDb(c.env.DB);
    const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
    if (!we) return c.json(notFound, 404);
    await db.delete(schema.workoutExercises).where(eq(schema.workoutExercises.id, we.id)); // cascades to sets
    return c.json({ ok: true });
  })
  // --- nested: sets ---
  .post(
    '/:id/exercises/:weId/sets',
    zValidator('json', setInputSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
      if (!we) return c.json(notFound, 404);
      const input = c.req.valid('json');
      const last = await db
        .select({ position: schema.sets.position })
        .from(schema.sets)
        .where(eq(schema.sets.workoutExerciseId, we.id))
        .orderBy(desc(schema.sets.position))
        .limit(1);
      const set = {
        id: crypto.randomUUID(),
        workoutExerciseId: we.id,
        position: (last[0]?.position ?? 0) + 1,
        weightKg: input.weightKg ?? null,
        reps: input.reps ?? null,
        rpe: input.rpe ?? null,
        durationSec: input.durationSec ?? null,
        distanceM: input.distanceM ?? null,
        note: input.note ?? null,
      };
      await db.insert(schema.sets).values(set);
      return c.json(set, 201);
    },
  )
  .patch(
    '/:id/exercises/:weId/sets/:setId',
    zValidator('json', setInputSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
      if (!we) return c.json(notFound, 404);
      const setId = c.req.param('setId');
      const existing = await db.query.sets.findFirst({
        where: and(eq(schema.sets.id, setId), eq(schema.sets.workoutExerciseId, we.id)),
      });
      if (!existing) return c.json(notFound, 404);
      const input = c.req.valid('json');
      await db
        .update(schema.sets)
        .set({
          weightKg: input.weightKg ?? null,
          reps: input.reps ?? null,
          rpe: input.rpe ?? null,
          durationSec: input.durationSec ?? null,
          distanceM: input.distanceM ?? null,
          // FULL-VALUE semantics: omitting note clears it — SetInputRow always resends the complete payload.
          note: input.note ?? null,
        })
        .where(eq(schema.sets.id, setId));
      const updated = await db.query.sets.findFirst({ where: eq(schema.sets.id, setId) });
      return c.json(updated);
    },
  )
  .delete('/:id/exercises/:weId/sets/:setId', async (c) => {
    const db = getDb(c.env.DB);
    const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
    if (!we) return c.json(notFound, 404);
    const setId = c.req.param('setId');
    const existing = await db.query.sets.findFirst({
      where: and(eq(schema.sets.id, setId), eq(schema.sets.workoutExerciseId, we.id)),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.sets).where(eq(schema.sets.id, setId));
    return c.json({ ok: true });
  })
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
      const newStartedAt = input.startedAt ? new Date(input.startedAt) : existing.startedAt;
      const newEndedAt = input.endedAt
        ? new Date(input.endedAt)
        : input.finish
          ? new Date()
          : existing.endedAt;
      if (newEndedAt && newStartedAt > newEndedAt) {
        return c.json(
          { error: { code: 'invalid_time_range', message: 'endedAt must be after startedAt' } },
          422,
        );
      }
      await db
        .update(schema.workouts)
        .set({
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.startedAt ? { startedAt: newStartedAt } : {}),
          ...(input.endedAt || input.finish ? { endedAt: newEndedAt } : {}),
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
