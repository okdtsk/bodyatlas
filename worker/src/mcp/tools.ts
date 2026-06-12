/**
 * MCP tool handlers — plain functions testable without the Durable Object.
 *
 * Each handler takes (d1, userId, input) and returns a JSON-serializable result.
 * Thrown ToolError(message) is a user-facing error (shown as isError content).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { and, asc, desc, eq, gte, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb, schema } from '../db';
import { likeContains } from '../lib/sql';
import { dayWindowFor, strengthSeries } from '../lib/stats';

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
    .describe('Exact name (case-insensitive) in English or Japanese. Use get_recent_workouts to find names.'),
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

/** Resolve exercise by exact case-insensitive name match in seed ∪ user custom. */
async function resolveExercise(
  db: ReturnType<typeof getDb>,
  userId: string,
  exerciseName: string,
): Promise<string> {
  // Exact case-insensitive match via SQL LOWER
  const [found] = await db
    .select({ id: schema.exercises.id, nameEn: schema.exercises.nameEn })
    .from(schema.exercises)
    .where(
      and(
        or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
        eq(schema.exercises.isArchived, false),
        or(
          sql`LOWER(${schema.exercises.nameEn}) = LOWER(${exerciseName})`,
          sql`LOWER(${schema.exercises.nameJa}) = LOWER(${exerciseName})`,
        ),
      ),
    )
    .limit(1);

  if (found) return found.id;

  // Not found — find up to 5 suggestions via likeContains
  const suggestions = await db
    .select({ nameEn: schema.exercises.nameEn })
    .from(schema.exercises)
    .where(
      and(
        or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
        eq(schema.exercises.isArchived, false),
        or(
          likeContains(schema.exercises.nameEn, exerciseName),
          likeContains(schema.exercises.nameJa, exerciseName),
        ),
      ),
    )
    .limit(5);

  const suggestionList =
    suggestions.length > 0
      ? `\nDid you mean: ${suggestions.map((s) => s.nameEn).join(', ')}?`
      : '\nNo similar exercises found.';

  throw new ToolError(
    `Exercise not found: "${exerciseName}".${suggestionList}`,
  );
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
  const resolvedExercises: Array<{ exerciseId: string; sets: z.infer<typeof setToolInput>[] }> = [];
  for (const ex of input.exercises) {
    const exerciseId = await resolveExercise(db, userId, ex.exerciseName);
    resolvedExercises.push({ exerciseId, sets: ex.sets });
  }

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

  const kcal = todayMeals.reduce((sum, m) => sum + (m.calories ?? 0), 0);
  const proteinG = todayMeals.reduce((sum, m) => sum + (m.proteinG ?? 0), 0);

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
): void {
  server.registerTool(
    'log_meal',
    {
      description:
        'Log a meal. Provide name and optionally eatenAt (ISO datetime with timezone), calories (kcal), proteinG/fatG/carbsG (grams).',
      inputSchema: mealToolInput,
    },
    async (input) => runTool(() => logMeal(db, getUserId(), input)),
  );

  server.registerTool(
    'log_weight',
    {
      description:
        'Log a body measurement. Provide weightKg (kg) and/or bodyFatPct (%). measuredAt is optional ISO datetime with timezone.',
      inputSchema: weightToolInput,
    },
    async (input) => runTool(() => logWeight(db, getUserId(), input)),
  );

  server.registerTool(
    'log_sleep',
    {
      description:
        'Log a sleep record. bedAt and wokeAt are ISO datetimes with timezone. quality is 1 (worst)–5 (best).',
      inputSchema: sleepToolInput,
    },
    async (input) => runTool(() => logSleep(db, getUserId(), input)),
  );

  server.registerTool(
    'log_workout',
    {
      description:
        'Log a completed workout with exercises and sets. Exercise names are matched case-insensitively against the catalog (English or Japanese). Sets need at least reps, durationSec, or distanceM. weightKg in kg; RPE 1–10 in 0.5 steps.',
      inputSchema: workoutToolInput,
    },
    async (input) => runTool(() => logWorkout(db, getUserId(), input)),
  );

  server.registerTool(
    'get_recent_workouts',
    {
      description: 'Get recent workout summaries, newest first. limit: 1–20 (default 5).',
      inputSchema: recentWorkoutsToolInput,
    },
    async (input) => runTool(() => getRecentWorkouts(db, getUserId(), input)),
  );

  server.registerTool(
    'get_trends',
    {
      description:
        'Get trend data. kind: strength (requires exerciseName) | volume | nutrition-body | sleep. days: lookback window (default 84).',
      inputSchema: trendsToolInput,
    },
    async (input) => runTool(() => getTrends(db, getUserId(), input)),
  );

  server.registerTool(
    'get_today',
    {
      description:
        "Get today's summary: nutrition totals vs targets, workout status (active/done/rest), last sleep, and latest weight. Today is computed using the user's stored timezone.",
      inputSchema: todayToolInput,
    },
    async (input) => runTool(() => getToday(db, getUserId())),
  );
}
