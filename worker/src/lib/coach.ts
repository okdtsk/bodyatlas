import { and, avg, count, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { schema } from '../db';
import { strengthSeries } from './stats';

const WINDOW_DAYS = 28;

export type MuscleSetTotal = {
  muscle: string;
  sets: number;
};

export type TopExercise = {
  exerciseId: string;
  setCount: number;
  firstEst1rm: number | null;
  lastEst1rm: number | null;
};

export type CoachSummary = {
  windowDays: number;
  workoutsCount: number;
  muscleSetTotals: MuscleSetTotal[];
  topExercises: TopExercise[];
  mealAvgKcal: number;
  mealAvgProteinG: number;
  targetKcal: number | null;
  targetProteinG: number | null;
  sleepAvgDurationMin: number | null;
  sleepAvgQuality: number | null;
};

/**
 * Builds a compact 28-day summary for the AI coach prompt.
 * @param now - the reference "now" timestamp (defaults to new Date())
 */
export async function buildCoachSummary(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<CoachSummary> {
  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // --- workouts count ---
  const workoutRows = await db
    .select({ id: schema.workouts.id })
    .from(schema.workouts)
    .where(
      and(
        eq(schema.workouts.userId, userId),
        gte(schema.workouts.startedAt, windowStart),
      ),
    );
  const workoutsCount = workoutRows.length;

  // --- per-muscle set totals ---
  const muscleRows = await db
    .select({
      muscleGroup: schema.exercises.muscleGroup,
      setCount: count(schema.sets.id),
    })
    .from(schema.sets)
    .innerJoin(schema.workoutExercises, eq(schema.sets.workoutExerciseId, schema.workoutExercises.id))
    .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
    .innerJoin(schema.exercises, eq(schema.workoutExercises.exerciseId, schema.exercises.id))
    .where(
      and(
        eq(schema.workouts.userId, userId),
        gte(schema.workouts.startedAt, windowStart),
      ),
    )
    .groupBy(schema.exercises.muscleGroup);

  const muscleSetTotals: MuscleSetTotal[] = muscleRows.map((r) => ({
    muscle: r.muscleGroup,
    sets: r.setCount,
  }));

  // --- top-3 exercises by set count ---
  // First get per-exercise set counts
  const exerciseSetRows = await db
    .select({
      exerciseId: schema.workoutExercises.exerciseId,
      setCount: count(schema.sets.id),
    })
    .from(schema.sets)
    .innerJoin(schema.workoutExercises, eq(schema.sets.workoutExerciseId, schema.workoutExercises.id))
    .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
    .where(
      and(
        eq(schema.workouts.userId, userId),
        gte(schema.workouts.startedAt, windowStart),
      ),
    )
    .groupBy(schema.workoutExercises.exerciseId)
    .orderBy(sql`count(${schema.sets.id}) desc`)
    .limit(3);

  // For each top exercise, get first/last est1rm via strengthSeries
  const topExercises: TopExercise[] = await Promise.all(
    exerciseSetRows.map(async (row) => {
      const series = await strengthSeries(db, userId, row.exerciseId, windowStart);
      const withEst1rm = series.filter((p) => p.est1rm !== null);
      const firstEst1rm = withEst1rm.length > 0 ? (withEst1rm[0]?.est1rm ?? null) : null;
      const lastEst1rm = withEst1rm.length > 0 ? (withEst1rm[withEst1rm.length - 1]?.est1rm ?? null) : null;
      return {
        exerciseId: row.exerciseId,
        setCount: row.setCount,
        firstEst1rm,
        lastEst1rm,
      };
    }),
  );

  // --- meal daily averages (sum/28) ---
  const mealRows = await db
    .select({
      totalKcal: sql<number>`coalesce(sum(${schema.meals.calories}), 0)`,
      totalProteinG: sql<number>`coalesce(sum(${schema.meals.proteinG}), 0)`,
    })
    .from(schema.meals)
    .where(
      and(
        eq(schema.meals.userId, userId),
        gte(schema.meals.eatenAt, windowStart),
      ),
    );

  const mealAvgKcal = Math.round((mealRows[0]?.totalKcal ?? 0) / WINDOW_DAYS * 10) / 10;
  const mealAvgProteinG = Math.round((mealRows[0]?.totalProteinG ?? 0) / WINDOW_DAYS * 10) / 10;

  // --- user targets ---
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
  });
  const targetKcal = user?.targetKcal ?? null;
  const targetProteinG = user?.targetProteinG ?? null;

  // --- sleep averages ---
  const sleepRows = await db
    .select({
      bedAt: schema.sleepRecords.bedAt,
      wokeAt: schema.sleepRecords.wokeAt,
      quality: schema.sleepRecords.quality,
    })
    .from(schema.sleepRecords)
    .where(
      and(
        eq(schema.sleepRecords.userId, userId),
        gte(schema.sleepRecords.wokeAt, windowStart),
      ),
    );

  let sleepAvgDurationMin: number | null = null;
  let sleepAvgQuality: number | null = null;

  if (sleepRows.length > 0) {
    const totalDurationMin = sleepRows.reduce((sum, r) => {
      return sum + (r.wokeAt.getTime() - r.bedAt.getTime()) / 60_000;
    }, 0);
    sleepAvgDurationMin = Math.round(totalDurationMin / sleepRows.length);

    const rowsWithQuality = sleepRows.filter((r) => r.quality !== null);
    if (rowsWithQuality.length > 0) {
      const totalQuality = rowsWithQuality.reduce((sum, r) => sum + (r.quality ?? 0), 0);
      sleepAvgQuality = Math.round((totalQuality / rowsWithQuality.length) * 10) / 10;
    }
  }

  return {
    windowDays: WINDOW_DAYS,
    workoutsCount,
    muscleSetTotals,
    topExercises,
    mealAvgKcal,
    mealAvgProteinG,
    targetKcal,
    targetProteinG,
    sleepAvgDurationMin,
    sleepAvgQuality,
  };
}
