import { zValidator } from '@hono/zod-validator';
import { createExerciseSchema, updateExerciseSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, isNull, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import { findExerciseConflict, loadExerciseCatalog } from '../lib/exercises';
import { likeContains } from '../lib/sql';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Exercise not found' } } as const;
// existingName is a separate field, not just prose, so a client can compose its
// own localized sentence instead of echoing this English string at the user.
const duplicate = (existingName: string) =>
  ({
    error: {
      code: 'duplicate',
      message: `That name already resolves to the existing exercise "${existingName}"`,
      existingName,
    },
  }) as const;

export const exercisesRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const q = c.req.query('q');
    const includeArchived = c.req.query('includeArchived') === 'true';
    const rows = await db
      .select()
      .from(schema.exercises)
      .where(
        and(
          or(isNull(schema.exercises.userId), eq(schema.exercises.userId, c.get('userId'))),
          includeArchived ? undefined : eq(schema.exercises.isArchived, false),
          q
            ? or(
                likeContains(schema.exercises.nameEn, q),
                likeContains(schema.exercises.nameJa, q),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.exercises.nameEn));
    return c.json(rows);
  })
  .post(
    '/',
    zValidator('json', createExerciseSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const input = c.req.valid('json');
      const db = getDb(c.env.DB);

      // Same duplicate rule as the MCP create_exercise tool: a row whose name
      // already resolves would split one movement's history across two rows.
      const catalog = await loadExerciseCatalog(db, c.get('userId'));
      const conflict = findExerciseConflict(catalog, [input.name, input.nameJa]);
      if (conflict) return c.json(duplicate(conflict.nameEn), 409);

      const id = crypto.randomUUID();
      await db.insert(schema.exercises).values({
        id,
        userId: c.get('userId'),
        nameEn: input.name,
        nameJa: input.nameJa ?? null,
        type: input.type,
        muscleGroup: input.muscleGroup,
        equipment: input.equipment,
      });
      const created = await db.query.exercises.findFirst({ where: eq(schema.exercises.id, id) });
      return c.json(created, 201);
    },
  )
  .patch(
    '/:id',
    zValidator('json', updateExerciseSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const id = c.req.param('id');
      // Only the owner's custom rows are editable; seed rows (userId NULL) 404.
      const existing = await db.query.exercises.findFirst({
        where: and(eq(schema.exercises.id, id), eq(schema.exercises.userId, c.get('userId'))),
      });
      if (!existing) return c.json(notFound, 404);
      const patch = c.req.valid('json');
      const { name, ...rest } = patch;

      // Renaming can collide just as creating can. The row being edited is
      // excluded, or keeping its own current name would count as a conflict.
      if (name !== undefined || patch.nameJa !== undefined) {
        const catalog = await loadExerciseCatalog(db, c.get('userId'));
        const conflict = findExerciseConflict(
          catalog.filter((e) => e.id !== id),
          [name, patch.nameJa],
        );
        if (conflict) return c.json(duplicate(conflict.nameEn), 409);
      }

      if (Object.keys(patch).length > 0) {
        await db
          .update(schema.exercises)
          .set({ ...rest, ...(name !== undefined ? { nameEn: name } : {}) })
          .where(eq(schema.exercises.id, id));
      }
      const updated = await db.query.exercises.findFirst({ where: eq(schema.exercises.id, id) });
      return c.json(updated);
    },
  )
  .get('/:id/last-sets', async (c) => {
    const db = getDb(c.env.DB);
    const exerciseId = c.req.param('id');
    const excludeWorkoutId = c.req.query('excludeWorkoutId');
    const [lastOccurrence] = await db
      .select({
        workoutExerciseId: schema.workoutExercises.id,
        workoutId: schema.workouts.id,
        startedAt: schema.workouts.startedAt,
      })
      .from(schema.workoutExercises)
      .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
      .where(
        and(
          eq(schema.workouts.userId, c.get('userId')),
          eq(schema.workoutExercises.exerciseId, exerciseId),
          excludeWorkoutId ? ne(schema.workouts.id, excludeWorkoutId) : undefined,
        ),
      )
      .orderBy(desc(schema.workouts.startedAt))
      .limit(1);
    if (!lastOccurrence) return c.json(null);
    const lastSets = await db
      .select()
      .from(schema.sets)
      .where(eq(schema.sets.workoutExerciseId, lastOccurrence.workoutExerciseId))
      .orderBy(asc(schema.sets.position));
    return c.json({
      workoutId: lastOccurrence.workoutId,
      startedAt: lastOccurrence.startedAt,
      sets: lastSets,
    });
  });
