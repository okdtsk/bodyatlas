import { and, asc, eq, gte } from 'drizzle-orm';
import type { Db } from '../db';
import { schema } from '../db';
import { epley1rm } from './stats-math';

export { epley1rm };

/** Returns { from, to } UTC Date boundaries for the calendar day containing
 *  `now` in the given IANA timezone. */
export function dayWindowFor(timezone: string, now: Date = new Date()): { from: Date; to: Date } {
  // Use Intl to find the local calendar date (YYYY-MM-DD) for `now` in the tz.
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  // e.g. "2026-06-13"
  const localDate = dateFmt.format(now);
  const [year, month, day] = localDate.split('-').map(Number) as [number, number, number];

  return {
    from: localMidnightUtc(timezone, year, month, day),
    to: localMidnightUtc(timezone, year, month, day + 1),
  };
}

/**
 * UTC offset of `timezone` at the instant `utcMs`, in milliseconds.
 * Positive east of UTC (Asia/Tokyo = +9h), negative west (America/New_York = -5h).
 * Derived analytically: format the instant's wall clock in the tz, re-encode it
 * as a UTC timestamp, and diff. IANA offsets are whole minutes, so this is exact.
 */
function tzOffsetMs(timezone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const wallAsUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  // utcMs may carry sub-second millis the formatter drops; compare whole seconds.
  return wallAsUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Compute the exact UTC instant of midnight `year-month-day` in `timezone`.
 * Analytical: express local midnight as a UTC-encoded wall clock, then subtract
 * the timezone's offset AT THAT INSTANT. One extra iteration handles the case
 * where the offset changes across the boundary (DST transitions).
 */
function localMidnightUtc(timezone: string, year: number, month: number, day: number): Date {
  // Local midnight encoded as if it were UTC. Date.UTC normalises overflow
  // (e.g. day = 32 rolls into the next month).
  const wallMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // First guess: offset sampled at the wall-clock instant.
  let offset = tzOffsetMs(timezone, wallMs);
  let candidate = wallMs - offset;

  // The offset at the candidate instant may differ (DST boundary nearby).
  const offsetAtCandidate = tzOffsetMs(timezone, candidate);
  if (offsetAtCandidate !== offset) {
    candidate = wallMs - offsetAtCandidate;
    // If midnight falls inside a spring-forward gap, the wall time 00:00 does
    // not exist; wallMs - offsetAtCandidate then maps to the first valid
    // instant after the transition, which is the correct day boundary.
  }
  return new Date(candidate);
}

export type StrengthPoint = {
  workoutId: string;
  startedAt: Date;
  topWeightKg: number | null;
  est1rm: number | null;
  setCount: number;
};

/** Aggregates strength data per workout for a given exercise and user. */
export async function strengthSeries(
  db: Db,
  userId: string,
  exerciseId: string,
  from: Date,
): Promise<StrengthPoint[]> {
  const rows = await db
    .select({
      workoutId: schema.workouts.id,
      startedAt: schema.workouts.startedAt,
      weightKg: schema.sets.weightKg,
      reps: schema.sets.reps,
    })
    .from(schema.sets)
    .innerJoin(schema.workoutExercises, eq(schema.sets.workoutExerciseId, schema.workoutExercises.id))
    .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
    .where(
      and(
        eq(schema.workouts.userId, userId),
        eq(schema.workoutExercises.exerciseId, exerciseId),
        gte(schema.workouts.startedAt, from),
      ),
    )
    .orderBy(asc(schema.workouts.startedAt));

  const byWorkout = new Map<string, StrengthPoint>();
  for (const row of rows) {
    const entry = byWorkout.get(row.workoutId) ?? {
      workoutId: row.workoutId,
      startedAt: row.startedAt,
      topWeightKg: null,
      est1rm: null,
      setCount: 0,
    };
    entry.setCount += 1;
    if (row.weightKg !== null && (entry.topWeightKg === null || row.weightKg > entry.topWeightKg)) {
      entry.topWeightKg = row.weightKg;
    }
    const oneRm = epley1rm(row.weightKg, row.reps);
    if (oneRm !== null && (entry.est1rm === null || oneRm > entry.est1rm)) entry.est1rm = oneRm;
    byWorkout.set(row.workoutId, entry);
  }
  return [...byWorkout.values()];
}
