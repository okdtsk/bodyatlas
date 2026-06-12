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
 * Compute the UTC timestamp for midnight of `year-month-day` in `timezone`.
 * Uses a reliable approach: start from the rough UTC equivalent and use
 * formatToParts to verify/adjust the local time components.
 */
function localMidnightUtc(timezone: string, year: number, month: number, day: number): Date {
  // IANA tz offsets are always in whole minutes; the closest offset to
  // UTC midnight is within ±14h. We start from a rough UTC estimate.
  const roughUtcMs = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // Format with time parts to find the actual local time at roughUtcMs.
  const timeFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  function localPartsAt(utcMs: number): { date: string; hour: number; minute: number; second: number } {
    const parts = timeFmt.formatToParts(new Date(utcMs));
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      hour: Number(get('hour')),
      minute: Number(get('minute')),
      second: Number(get('second')),
    };
  }

  // At roughUtcMs, get the local offset: local time = rough + offset_seconds
  const localAt = localPartsAt(roughUtcMs);
  // Offset in seconds (roughly): how many seconds to subtract from roughUtcMs to hit midnight
  const offsetSec = localAt.hour * 3600 + localAt.minute * 60 + localAt.second;

  // Candidate: subtract the offset so local time ~= midnight
  // Then handle the case where the date shifts (DST etc.)
  let candidate = roughUtcMs - offsetSec * 1000;

  // Verify candidate is correct; adjust by at most ±1h in 1-second steps if needed.
  // In practice, 1-2 adjustments at most.
  const targetDate = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  // Snap to the nearest second first
  candidate = Math.round(candidate / 1000) * 1000;

  // Check and nudge if needed (DST transitions can cause ±1h jumps)
  for (let attempt = 0; attempt < 10; attempt++) {
    const check = localPartsAt(candidate);
    if (check.date === targetDate && check.hour === 0 && check.minute === 0 && check.second === 0) {
      return new Date(candidate);
    }
    if (check.date < targetDate || (check.date === targetDate && (check.hour > 0 || check.minute > 0 || check.second > 0))) {
      // local time is after midnight → go earlier
      // but first check if going back 1 second keeps the same date
      const back = localPartsAt(candidate - 1000);
      if (back.date < targetDate) {
        // candidate-1000 is already yesterday; candidate is the correct midnight
        // (handle DST spring-forward: 00:00 is skipped, midnight is 01:00)
        // In this rare case, midnight doesn't exist: use 01:00:00 local = next valid time
        candidate += 3600 * 1000; // skip to 01:00
        continue;
      }
      candidate -= 1000;
    } else {
      candidate += 1000;
    }
  }

  // Fallback: binary search to second precision
  return binarySearchMidnight(timezone, targetDate, roughUtcMs);
}

function binarySearchMidnight(timezone: string, targetDate: string, roughUtcMs: number): Date {
  const dateFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const check = (ms: number) => dateFmt.format(new Date(ms));

  let lo = roughUtcMs - 15 * 3600 * 1000;
  let hi = roughUtcMs + 15 * 3600 * 1000;

  // Find the transition from day-before to target day, to second precision
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (check(mid) < targetDate) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return new Date(hi);
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
