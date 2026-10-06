/**
 * MCP tool handlers — plain functions testable without the Durable Object.
 *
 * Each handler takes (d1, userId, input) and returns a JSON-serializable result.
 * Thrown ToolError(message) is a user-facing error (shown as isError content).
 */
import { EQUIPMENT, EXERCISE_TYPES, MUSCLE_GROUPS } from '@bodyatlas/shared';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, desc, eq, gte, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../db';
import {
  findExerciseConflict,
  loadExerciseCatalog,
  visibleExercises,
} from '../lib/exercises';
import { likeContains } from '../lib/sql';
import { dayWindowFor, strengthSeries } from '../lib/stats';
import { matchExercise, type ExerciseCandidate } from './match';
import type { Bindings } from '../types';
import { isAllowedUser } from '../auth/private-access';
import { recordSecurityAudit } from '../lib/security-audit';

// ---------------------------------------------------------------------------
// ToolError
// ---------------------------------------------------------------------------

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

// ---------------------------------------------------------------------------
// Input schemas (reuse shared shapes; refined schemas can't spread .shape)
// ---------------------------------------------------------------------------

const mealToolInput = z.object({
  name: z.string().trim().min(1).max(120),
  eatenAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid eatenAt datetime' })
    .optional()
    .describe('ISO datetime with timezone, e.g. 2026-06-12T07:00:00+09:00'),
  calories: z.number().int().min(0).max(10000).optional().describe('kcal'),
  proteinG: z.number().min(0).max(1000).optional().describe('grams'),
  fatG: z.number().min(0).max(1000).optional().describe('grams'),
  carbsG: z.number().min(0).max(1000).optional().describe('grams'),
  notes: z.string().trim().max(500).optional(),
});

const weightToolInput = z.object({
  measuredAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid measuredAt datetime' })
    .optional()
    .describe('ISO datetime with timezone'),
  weightKg: z.number().positive().max(500).optional().describe('kg'),
  bodyFatPct: z.number().min(1).max(75).optional().describe('percent 1–75'),
});

const sleepToolInput = z.object({
  bedAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid bedAt datetime' })
    .describe('ISO datetime with timezone'),
  wokeAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid wokeAt datetime' })
    .describe('ISO datetime with timezone'),
  quality: z.number().int().min(1).max(5).optional().describe('1 (worst) – 5 (best)'),
  notes: z.string().trim().max(500).optional(),
});

const setToolInput = z.object({
  weightKg: z.number().positive().max(1000).optional().describe('kg'),
  reps: z.number().int().positive().max(1000).optional(),
  rpe: z.number().min(1).max(10).multipleOf(0.5).optional().describe('RPE 1–10 (0.5 steps)'),
  durationSec: z.number().int().positive().max(86400).optional(),
  distanceM: z.number().positive().max(1000000).optional().describe('metres'),
  note: z.string().trim().min(1).max(200).optional(),
});

const workoutExerciseToolInput = z.object({
  exerciseName: z
    .string()
    .min(1)
    .describe(
      'Exercise name in English or Japanese. Matched case-insensitively; a partial name works if it identifies exactly one exercise. Use search_exercises to find names, create_exercise to add a missing one.',
    ),
  sets: z.array(setToolInput).min(1).max(50),
});

const workoutToolInput = z.object({
  startedAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid startedAt' })
    .optional()
    .describe('ISO datetime with timezone (defaults to now-1h)'),
  endedAt: z
    .string()
    .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid endedAt' })
    .optional()
    .describe('ISO datetime with timezone (defaults to now)'),
  notes: z.string().max(2000).optional(),
  exercises: z.array(workoutExerciseToolInput).min(1).max(30),
});

const searchExercisesToolInput = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Substring of an English or Japanese name. Omit to list the whole catalog.'),
  limit: z.number().int().min(1).max(50).optional().describe('1–50, default 20'),
});

const createExerciseToolInput = z.object({
  name: z.string().trim().min(1).max(100).describe('Display name, in the user’s own language'),
  nameJa: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .describe(
      'Japanese name, when known. Set it whenever the user talks about this exercise in Japanese so it stays findable in both languages.',
    ),
  type: z.enum(EXERCISE_TYPES),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
});

const recentWorkoutsToolInput = z.object({
  limit: z.number().int().min(1).max(20).optional().describe('1–20, default 5'),
});

const trendsToolInput = z.object({
  kind: z.enum(['strength', 'volume', 'nutrition-body', 'sleep']),
  exerciseName: z
    .string()
    .optional()
    .describe('Required for kind=strength. Exact name (case-insensitive).'),
  days: z.number().int().min(1).max(365).optional().describe('Lookback days, default 84'),
});

const todayToolInput = z.object({});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact set string, e.g. "80kg × 8 @8" or "60sec" */
function formatSet(s: {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  durationSec: number | null;
  distanceM: number | null;
}): string {
  if (s.durationSec !== null && s.weightKg === null && s.reps === null) {
    const dist = s.distanceM !== null ? ` ${s.distanceM}m` : '';
    return `${s.durationSec}sec${dist}`;
  }
  const weight = s.weightKg !== null ? `${s.weightKg}kg × ` : '';
  const reps = s.reps !== null ? `${s.reps}` : '-';
  const rpe = s.rpe !== null ? ` @${s.rpe}` : '';
  return `${weight}${reps}${rpe}`;
}

const RECOVERY_HINT =
  'Call search_exercises to browse the catalog, or create_exercise to add it if it is genuinely new.';

/** Resolve a name against an already-loaded catalog, or throw a ToolError explaining why not. */
function resolveExerciseIn(catalog: ExerciseCandidate[], exerciseName: string): string {
  const result = matchExercise(catalog, exerciseName);
  if (result.kind === 'match') return result.exercise.id;

  const names = result.suggestions.map((s) => s.nameEn).join(', ');
  if (result.kind === 'ambiguous') {
    throw new ToolError(
      `Exercise name "${exerciseName}" is ambiguous — it matches: ${names}. Use the full name.`,
    );
  }
  const didYouMean = names ? ` Did you mean: ${names}?` : '';
  throw new ToolError(`Exercise not found: "${exerciseName}".${didYouMean} ${RECOVERY_HINT}`);
}

/** Resolve a single exercise name for callers that only need one. */
async function resolveExercise(
  db: ReturnType<typeof getDb>,
  userId: string,
  exerciseName: string,
): Promise<string> {
  return resolveExerciseIn(await loadExerciseCatalog(db, userId), exerciseName);
}

// ---------------------------------------------------------------------------
// Tool handler plain functions
// ---------------------------------------------------------------------------

export async function logMeal(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof mealToolInput>,
): Promise<{ id: string; name: string; eatenAt: string }> {
  const db = getDb(d1);
  const id = crypto.randomUUID();
  await db.insert(schema.meals).values({
    id,
    userId,
    name: input.name,
    ...(input.eatenAt ? { eatenAt: new Date(input.eatenAt) } : {}),
    calories: input.calories ?? null,
    proteinG: input.proteinG ?? null,
    fatG: input.fatG ?? null,
    carbsG: input.carbsG ?? null,
    notes: input.notes ?? null,
  });
  const row = await db.query.meals.findFirst({ where: eq(schema.meals.id, id) });
  return { id: row!.id, name: row!.name, eatenAt: row!.eatenAt.toISOString() };
}

export async function logWeight(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof weightToolInput>,
): Promise<{ id: string; weightKg: number | null; bodyFatPct: number | null; measuredAt: string }> {
  if (input.weightKg === undefined && input.bodyFatPct === undefined) {
    throw new ToolError('Provide weightKg or bodyFatPct');
  }
  const db = getDb(d1);
  const id = crypto.randomUUID();
  await db.insert(schema.bodyMeasurements).values({
    id,
    userId,
    ...(input.measuredAt ? { measuredAt: new Date(input.measuredAt) } : {}),
    weightKg: input.weightKg ?? null,
    bodyFatPct: input.bodyFatPct ?? null,
  });
  const row = await db.query.bodyMeasurements.findFirst({ where: eq(schema.bodyMeasurements.id, id) });
  return {
    id: row!.id,
    weightKg: row!.weightKg,
    bodyFatPct: row!.bodyFatPct,
    measuredAt: row!.measuredAt.toISOString(),
  };
}

export async function logSleep(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof sleepToolInput>,
): Promise<{ id: string; bedAt: string; wokeAt: string; durationMin: number }> {
  const bedAt = new Date(input.bedAt);
  const wokeAt = new Date(input.wokeAt);
  if (wokeAt <= bedAt) throw new ToolError('wokeAt must be after bedAt');
  const diff = wokeAt.getTime() - bedAt.getTime();
  if (diff > 24 * 3600 * 1000) throw new ToolError('Sleep duration cannot exceed 24 hours');

  const db = getDb(d1);
  const id = crypto.randomUUID();
  await db.insert(schema.sleepRecords).values({
    id,
    userId,
    bedAt,
    wokeAt,
    quality: input.quality ?? null,
    notes: input.notes ?? null,
  });
  const row = await db.query.sleepRecords.findFirst({ where: eq(schema.sleepRecords.id, id) });
  const durationMin = Math.round((row!.wokeAt.getTime() - row!.bedAt.getTime()) / 60000);
  return {
    id: row!.id,
    bedAt: row!.bedAt.toISOString(),
    wokeAt: row!.wokeAt.toISOString(),
    durationMin,
  };
}

export async function logWorkout(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof workoutToolInput>,
): Promise<{ workoutId: string; exerciseCount: number; setCount: number }> {
  const db = getDb(d1);
  const now = new Date();
  const startedAt = input.startedAt ? new Date(input.startedAt) : new Date(now.getTime() - 3600 * 1000);
  const endedAt = input.endedAt ? new Date(input.endedAt) : now;

  // Resolve all exercise names first (fail fast before inserting)
  const catalog = await loadExerciseCatalog(db, userId);
  const resolvedExercises = input.exercises.map((ex) => ({
    exerciseId: resolveExerciseIn(catalog, ex.exerciseName),
    sets: ex.sets,
  }));

  const workoutId = crypto.randomUUID();

  // Build batch inserts
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inserts: any[] = [
    db.insert(schema.workouts).values({
      id: workoutId,
      userId,
      startedAt,
      endedAt,
      notes: input.notes ?? null,
    }),
  ];

  let totalSetCount = 0;
  for (let i = 0; i < resolvedExercises.length; i++) {
    const { exerciseId, sets } = resolvedExercises[i]!;
    const weId = crypto.randomUUID();
    inserts.push(
      db.insert(schema.workoutExercises).values({
        id: weId,
        workoutId,
        exerciseId,
        position: i + 1,
      }),
    );
    for (let j = 0; j < sets.length; j++) {
      const s = sets[j]!;
      inserts.push(
        db.insert(schema.sets).values({
          id: crypto.randomUUID(),
          workoutExerciseId: weId,
          position: j + 1,
          weightKg: s.weightKg ?? null,
          reps: s.reps ?? null,
          rpe: s.rpe ?? null,
          durationSec: s.durationSec ?? null,
          distanceM: s.distanceM ?? null,
          note: s.note ?? null,
        }),
      );
      totalSetCount++;
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.batch(inserts as any);

  return {
    workoutId,
    exerciseCount: resolvedExercises.length,
    setCount: totalSetCount,
  };
}

export async function searchExercises(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof searchExercisesToolInput>,
): Promise<
  Array<{
    name: string;
    nameJa: string | null;
    type: string;
    muscleGroup: string;
    equipment: string;
    isCustom: boolean;
  }>
> {
  const db = getDb(d1);
  const { query } = input;
  const rows = await db
    .select({
      nameEn: schema.exercises.nameEn,
      nameJa: schema.exercises.nameJa,
      type: schema.exercises.type,
      muscleGroup: schema.exercises.muscleGroup,
      equipment: schema.exercises.equipment,
      userId: schema.exercises.userId,
    })
    .from(schema.exercises)
    .where(
      and(
        visibleExercises(userId),
        query
          ? or(
              likeContains(schema.exercises.nameEn, query),
              likeContains(schema.exercises.nameJa, query),
            )
          : undefined,
      ),
    )
    .orderBy(asc(schema.exercises.nameEn))
    .limit(input.limit ?? 20);

  return rows.map((r) => ({
    name: r.nameEn,
    nameJa: r.nameJa,
    type: r.type,
    muscleGroup: r.muscleGroup,
    equipment: r.equipment,
    isCustom: r.userId !== null,
  }));
}

export async function createExercise(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof createExerciseToolInput>,
): Promise<{
  id: string;
  name: string;
  nameJa: string | null;
  type: string;
  muscleGroup: string;
  equipment: string;
}> {
  const db = getDb(d1);

  // Refuse a name that already resolves — a near-duplicate row would silently
  // split the user's strength history across two exercises.
  const catalog = await loadExerciseCatalog(db, userId);
  const conflict = findExerciseConflict(catalog, [input.name, input.nameJa]);
  if (conflict) {
    throw new ToolError(
      `"${input.name}" already resolves to the existing exercise "${conflict.nameEn}". Log against that instead.`,
    );
  }

  const id = crypto.randomUUID();
  const nameJa = input.nameJa ?? null;
  await db.insert(schema.exercises).values({
    id,
    userId,
    nameEn: input.name,
    nameJa,
    type: input.type,
    muscleGroup: input.muscleGroup,
    equipment: input.equipment,
  });
  return {
    id,
    name: input.name,
    nameJa,
    type: input.type,
    muscleGroup: input.muscleGroup,
    equipment: input.equipment,
  };
}

export async function getRecentWorkouts(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof recentWorkoutsToolInput>,
): Promise<Array<{ startedAt: string; exercises: Array<{ name: string; sets: string[] }>; notes: string | null }>> {
  const db = getDb(d1);
  const limit = input.limit ?? 5;
  const rows = await db.query.workouts.findMany({
    where: eq(schema.workouts.userId, userId),
    orderBy: desc(schema.workouts.startedAt),
    limit,
    with: {
      workoutExercises: {
        orderBy: asc(schema.workoutExercises.position),
        with: {
          exercise: true,
          sets: { orderBy: asc(schema.sets.position) },
        },
      },
    },
  });

  return rows.map((w) => ({
    startedAt: w.startedAt.toISOString(),
    notes: w.notes,
    exercises: w.workoutExercises.map((we) => ({
      name: we.exercise.nameEn,
      sets: we.sets.map(formatSet),
    })),
  }));
}

export async function getTrends(
  d1: D1Database,
  userId: string,
  input: z.infer<typeof trendsToolInput>,
): Promise<unknown> {
  const db = getDb(d1);
  const days = input.days ?? 84;
  const from = new Date(Date.now() - days * 86400000);

  if (input.kind === 'strength') {
    if (!input.exerciseName) {
      throw new ToolError('exerciseName is required for kind=strength');
    }
    const exerciseId = await resolveExercise(db, userId, input.exerciseName);
    return strengthSeries(db, userId, exerciseId, from);
  }

  if (input.kind === 'volume') {
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
      .where(and(eq(schema.workouts.userId, userId), gte(schema.workouts.startedAt, from)));

    const byKey = new Map<string, { startedAt: string; muscleGroup: string; setCount: number }>();
    for (const row of rows) {
      const key = `${row.startedAt.getTime()}|${row.muscleGroup}`;
      const entry = byKey.get(key) ?? {
        startedAt: row.startedAt.toISOString(),
        muscleGroup: row.muscleGroup,
        setCount: 0,
      };
      entry.setCount += 1;
      byKey.set(key, entry);
    }
    return [...byKey.values()];
  }

  if (input.kind === 'nutrition-body') {
    const meals = await db
      .select({
        eatenAt: schema.meals.eatenAt,
        calories: schema.meals.calories,
        proteinG: schema.meals.proteinG,
      })
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
    return { meals, measurements };
  }

  // kind === 'sleep'
  const sleepRows = await db
    .select({
      wokeAt: schema.sleepRecords.wokeAt,
      durationMin: sql<number>`CAST((${schema.sleepRecords.wokeAt} - ${schema.sleepRecords.bedAt}) / 60 AS INTEGER)`,
      quality: schema.sleepRecords.quality,
    })
    .from(schema.sleepRecords)
    .where(and(eq(schema.sleepRecords.userId, userId), gte(schema.sleepRecords.wokeAt, from)))
    .orderBy(asc(schema.sleepRecords.wokeAt))
    .limit(200);
  return sleepRows.map((r) => ({
    wokeAt: r.wokeAt.toISOString(),
    durationMin: r.durationMin,
    quality: r.quality,
  }));
}

export async function getToday(
  d1: D1Database,
  userId: string,
  now: Date = new Date(),
): Promise<{
  nutrition: {
    kcal: number;
    targetKcal: number | null;
    proteinG: number;
    targetProteinG: number | null;
  };
  workout: 'active' | 'done' | 'rest';
  lastSleep: { durationMin: number; quality: number | null } | null;
  latestWeightKg: number | null;
}> {
  const db = getDb(d1);

  // Load user for timezone + targets
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) throw new ToolError('User not found');

  const timezone = user.timezone ?? 'UTC';
  const { from, to } = dayWindowFor(timezone, now);

  // Today's meals
  const todayMeals = await db
    .select({ calories: schema.meals.calories, proteinG: schema.meals.proteinG })
    .from(schema.meals)
    .where(and(eq(schema.meals.userId, userId), gte(schema.meals.eatenAt, from), lt(schema.meals.eatenAt, to)));

  // Round the sums: floating-point accumulation otherwise reports 44.800000000000004.
  const kcal = Math.round(todayMeals.reduce((sum, m) => sum + (m.calories ?? 0), 0));
  const proteinG =
    Math.round(todayMeals.reduce((sum, m) => sum + (m.proteinG ?? 0), 0) * 10) / 10;

  // Today's workout status
  const todayWorkouts = await db
    .select({ id: schema.workouts.id, endedAt: schema.workouts.endedAt })
    .from(schema.workouts)
    .where(
      and(
        eq(schema.workouts.userId, userId),
        gte(schema.workouts.startedAt, from),
        lt(schema.workouts.startedAt, to),
      ),
    )
    .limit(10);

  let workoutStatus: 'active' | 'done' | 'rest';
  if (todayWorkouts.length === 0) {
    workoutStatus = 'rest';
  } else if (todayWorkouts.some((w) => w.endedAt === null)) {
    workoutStatus = 'active';
  } else {
    workoutStatus = 'done';
  }

  // Last sleep record (most recent)
  const lastSleepRow = await db.query.sleepRecords.findFirst({
    where: eq(schema.sleepRecords.userId, userId),
    orderBy: desc(schema.sleepRecords.wokeAt),
  });
  const lastSleep = lastSleepRow
    ? {
        durationMin: Math.round(
          (lastSleepRow.wokeAt.getTime() - lastSleepRow.bedAt.getTime()) / 60000,
        ),
        quality: lastSleepRow.quality,
      }
    : null;

  // Latest weight
  const latestMeasurement = await db.query.bodyMeasurements.findFirst({
    where: and(eq(schema.bodyMeasurements.userId, userId)),
    orderBy: desc(schema.bodyMeasurements.measuredAt),
  });

  return {
    nutrition: {
      kcal,
      targetKcal: user.targetKcal ?? null,
      proteinG,
      targetProteinG: user.targetProteinG ?? null,
    },
    workout: workoutStatus,
    lastSleep,
    latestWeightKg: latestMeasurement?.weightKg ?? null,
  };
}

// ---------------------------------------------------------------------------
// registerTools — wires everything into the McpServer
// ---------------------------------------------------------------------------

function toolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

function toolError(message: string) {
  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}

async function runTool<T>(fn: () => Promise<T>) {
  try {
    return toolResult(await fn());
  } catch (e) {
    if (e instanceof ToolError) return toolError(e.message);
    throw e;
  }
}

export function registerTools(
  server: McpServer,
  db: D1Database,
  getUserId: () => string,
  bindings: Bindings,
): void {
  const privateTool = async <T>(operation: string, fn: () => Promise<T>) => {
    const actorId = getUserId();
    const audit = (status: number) => recordSecurityAudit(db, { actorId, action: 'mcp_tool', category: 'mcp', operation, status });
    if (!await isAllowedUser(bindings, actorId)) {
      await audit(403);
      return toolError('Account is not permitted');
    }
    try {
      const result = await runTool(fn);
      await audit('isError' in result ? 400 : 200);
      return result;
    } catch (error) {
      await audit(500);
      throw error;
    }
  };
  server.registerTool(
    'log_meal',
    {
      description:
        'Log a meal. Provide name and optionally eatenAt (ISO datetime with timezone), calories (kcal), proteinG/fatG/carbsG (grams).',
      inputSchema: mealToolInput,
    },
    async (input) => privateTool('log_meal', () => logMeal(db, getUserId(), input)),
  );

  server.registerTool(
    'log_weight',
    {
      description:
        'Log a body measurement. Provide weightKg (kg) and/or bodyFatPct (%). measuredAt is optional ISO datetime with timezone.',
      inputSchema: weightToolInput,
    },
    async (input) => privateTool('log_weight', () => logWeight(db, getUserId(), input)),
  );

  server.registerTool(
    'log_sleep',
    {
      description:
        'Log a sleep record. bedAt and wokeAt are ISO datetimes with timezone. quality is 1 (worst)–5 (best).',
      inputSchema: sleepToolInput,
    },
    async (input) => privateTool('log_sleep', () => logSleep(db, getUserId(), input)),
  );

  server.registerTool(
    'log_workout',
    {
      description:
        'Log a completed workout with exercises and sets. Exercise names are matched case-insensitively against the catalog (English or Japanese); a partial name works if it identifies exactly one exercise. If a name is not found, call search_exercises to find the right one, then create_exercise if it is genuinely missing — do not give up. Sets need at least reps, durationSec, or distanceM. weightKg in kg; RPE 1–10 in 0.5 steps.',
      inputSchema: workoutToolInput,
    },
    async (input) => privateTool('log_workout', () => logWorkout(db, getUserId(), input)),
  );

  server.registerTool(
    'search_exercises',
    {
      description:
        'Search the exercise catalog (seeded exercises plus the user’s custom ones). query matches a substring of the English or Japanese name; omit it to browse everything. Use this before log_workout when unsure of a name.',
      inputSchema: searchExercisesToolInput,
    },
    async (input) => privateTool('search_exercises', () => searchExercises(db, getUserId(), input)),
  );

  server.registerTool(
    'create_exercise',
    {
      description:
        'Add a custom exercise to the user’s catalog so it can be logged. Call search_exercises first and only create when nothing matches. Classify it accurately — muscleGroup drives the user’s training-volume analytics.',
      inputSchema: createExerciseToolInput,
    },
    async (input) => privateTool('create_exercise', () => createExercise(db, getUserId(), input)),
  );

  server.registerTool(
    'get_recent_workouts',
    {
      description: 'Get recent workout summaries, newest first. limit: 1–20 (default 5).',
      inputSchema: recentWorkoutsToolInput,
    },
    async (input) => privateTool('get_recent_workouts', () => getRecentWorkouts(db, getUserId(), input)),
  );

  server.registerTool(
    'get_trends',
    {
      description:
        'Get trend data. kind: strength (requires exerciseName) | volume | nutrition-body | sleep. days: lookback window (default 84).',
      inputSchema: trendsToolInput,
    },
    async (input) => privateTool('get_trends', () => getTrends(db, getUserId(), input)),
  );

  server.registerTool(
    'get_today',
    {
      description:
        "Get today's summary: nutrition totals vs targets, workout status (active/done/rest), last sleep, and latest weight. Today is computed using the user's stored timezone.",
      inputSchema: todayToolInput,
    },
    async (input) => privateTool('get_today', () => getToday(db, getUserId())),
  );
}
