/**
 * Task 4 — MCP tools (plain-function TDD tests)
 *
 * Tests call the PLAIN exported functions with env.DB + seeded user,
 * not through the Durable Object.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import {
  logMeal,
  logWeight,
  logSleep,
  logWorkout,
  getRecentWorkouts,
  getTrends,
  getToday,
  ToolError,
} from '../src/mcp/tools';
import { dayWindowFor } from '../src/lib/stats';
import { seedUser, seedWorkout, seedCustomExercise } from './helpers';

// ---------------------------------------------------------------------------
// dayWindowFor unit test
// ---------------------------------------------------------------------------

describe('dayWindowFor', () => {
  it('JST midnight ≠ UTC midnight for Asia/Tokyo', () => {
    // 2026-06-13T00:00:00+09:00 = 2026-06-12T15:00:00Z
    const { from, to } = dayWindowFor('Asia/Tokyo', new Date('2026-06-12T15:00:00Z'));
    // "today" in JST at that UTC moment = 2026-06-13
    // from = 2026-06-13T00:00:00+09:00 = 2026-06-12T15:00:00Z
    expect(from.toISOString()).toBe('2026-06-12T15:00:00.000Z');
    // to = 2026-06-14T00:00:00+09:00 = 2026-06-13T15:00:00Z
    expect(to.toISOString()).toBe('2026-06-13T15:00:00.000Z');
  });

  it('UTC timezone gives UTC midnight window', () => {
    const { from, to } = dayWindowFor('UTC', new Date('2026-06-12T10:00:00Z'));
    expect(from.toISOString()).toBe('2026-06-12T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-06-13T00:00:00.000Z');
  });

  /** Formats an instant as local wall-clock time with milliseconds in the tz. */
  function localTimeString(timezone: string, d: Date): string {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hourCycle: 'h23',
    }).format(d);
  }

  it('America/New_York winter day: exact-millisecond midnight, 24h window', () => {
    const { from, to } = dayWindowFor('America/New_York', new Date('2026-01-15T12:00:00Z'));
    // EST = UTC-5 → local midnight Jan 15 = 05:00:00.000Z
    expect(from.toISOString()).toBe('2026-01-15T05:00:00.000Z');
    expect(localTimeString('America/New_York', from)).toBe('00:00:00.000');
    expect(to.getTime() - from.getTime()).toBe(24 * 3600 * 1000);
  });

  it('America/New_York DST spring-forward day: exact midnight, 23h window', () => {
    // 2026-03-08 is the spring-forward day (02:00 EST → 03:00 EDT)
    const { from, to } = dayWindowFor('America/New_York', new Date('2026-03-08T12:00:00Z'));
    // Midnight Mar 8 is still EST (UTC-5) → 05:00:00.000Z
    expect(from.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(localTimeString('America/New_York', from)).toBe('00:00:00.000');
    // Midnight Mar 9 is EDT (UTC-4) → 04:00:00.000Z → 23h day
    expect(to.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(to.getTime() - from.getTime()).toBe(23 * 3600 * 1000);
  });
});

// ---------------------------------------------------------------------------
// log_meal happy path
// ---------------------------------------------------------------------------

describe('logMeal', () => {
  it('inserts a meal and returns id/name/eatenAt', async () => {
    await seedUser('user-1');
    const result = await logMeal(env.DB, 'user-1', {
      name: 'Oatmeal',
      eatenAt: '2026-06-12T07:00:00Z',
      calories: 350,
      proteinG: 12,
    });
    expect(result.name).toBe('Oatmeal');
    expect(result.id).toBeTruthy();
    expect(new Date(result.eatenAt).toISOString()).toBe('2026-06-12T07:00:00.000Z');

    // confirm it's in the DB
    const db = getDb(env.DB);
    const row = await db.query.meals.findFirst({ where: (m, { eq }) => eq(m.id, result.id) });
    expect(row?.calories).toBe(350);
  });
});

// ---------------------------------------------------------------------------
// log_weight happy path
// ---------------------------------------------------------------------------

describe('logWeight', () => {
  it('inserts a body measurement and returns id/weightKg/bodyFatPct/measuredAt', async () => {
    await seedUser('user-1');
    const result = await logWeight(env.DB, 'user-1', {
      weightKg: 72.5,
      bodyFatPct: 18,
      measuredAt: '2026-06-12T08:00:00Z',
    });
    expect(result.weightKg).toBe(72.5);
    expect(result.bodyFatPct).toBe(18);
    expect(result.id).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// log_sleep happy path
// ---------------------------------------------------------------------------

describe('logSleep', () => {
  it('inserts a sleep record and returns id/bedAt/wokeAt/durationMin', async () => {
    await seedUser('user-1');
    const result = await logSleep(env.DB, 'user-1', {
      bedAt: '2026-06-11T22:30:00Z',
      wokeAt: '2026-06-12T06:30:00Z',
      quality: 4,
    });
    expect(result.id).toBeTruthy();
    expect(result.durationMin).toBe(480); // 8 hours
  });
});

// ---------------------------------------------------------------------------
// log_workout happy path
// ---------------------------------------------------------------------------

describe('logWorkout', () => {
  it('inserts a finished workout with exercises and sets via seed exercise name', async () => {
    await seedUser('user-1');
    const result = await logWorkout(env.DB, 'user-1', {
      exercises: [
        {
          exerciseName: 'Barbell Bench Press',
          sets: [
            { weightKg: 80, reps: 8 },
            { weightKg: 82.5, reps: 5 },
          ],
        },
      ],
    });
    expect(result.workoutId).toBeTruthy();
    expect(result.exerciseCount).toBe(1);
    expect(result.setCount).toBe(2);

    // confirm workout has endedAt set (finished)
    const db = getDb(env.DB);
    const row = await db.query.workouts.findFirst({ where: (w, { eq }) => eq(w.id, result.workoutId) });
    expect(row?.endedAt).not.toBeNull();
  });

  it('resolves exercise by Japanese name case-insensitively', async () => {
    await seedUser('user-1');
    const result = await logWorkout(env.DB, 'user-1', {
      exercises: [
        {
          exerciseName: 'ベンチプレス', // Japanese name of Barbell Bench Press
          sets: [{ weightKg: 100, reps: 3 }],
        },
      ],
    });
    expect(result.setCount).toBe(1);
  });

  it('throws ToolError with suggestions for unknown exercise name', async () => {
    await seedUser('user-1');
    let threw: unknown;
    try {
      await logWorkout(env.DB, 'user-1', {
        exercises: [
          {
            exerciseName: 'barbell bench', // partial match — not exact
            sets: [{ reps: 10 }],
          },
        ],
      });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(ToolError);
    expect((threw as ToolError).message).toMatch(/barbell bench/i);
    expect((threw as ToolError).message).toMatch(/Barbell Bench Press/); // suggestion
  });
});

// ---------------------------------------------------------------------------
// get_recent_workouts happy path
// ---------------------------------------------------------------------------

describe('getRecentWorkouts', () => {
  it('returns compact workout summaries ordered newest first', async () => {
    await seedUser('user-1');
    await seedWorkout('w1', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 80, reps: 8 }], {
      startedAt: new Date('2026-06-10T10:00:00Z'),
      endedAt: new Date('2026-06-10T11:00:00Z'),
    });
    await seedWorkout('w2', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 85, reps: 5 }], {
      startedAt: new Date('2026-06-12T10:00:00Z'),
      endedAt: new Date('2026-06-12T11:00:00Z'),
    });

    const result = await getRecentWorkouts(env.DB, 'user-1', { limit: 5 });
    expect(result).toHaveLength(2);
    // newest first
    expect(new Date(result[0]!.startedAt).toISOString()).toBe('2026-06-12T10:00:00.000Z');
    // compact set string
    expect(result[0]!.exercises[0]!.sets[0]).toMatch(/85.*kg.*×.*5/);
  });
});

// ---------------------------------------------------------------------------
// get_trends happy path (strength kind)
// ---------------------------------------------------------------------------

describe('getTrends', () => {
  it('returns strength series for a named exercise', async () => {
    await seedUser('user-1');
    await seedWorkout('w1', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 80, reps: 8 }], {
      startedAt: new Date('2026-06-10T10:00:00Z'),
      endedAt: new Date('2026-06-10T11:00:00Z'),
    });

    const result = await getTrends(env.DB, 'user-1', {
      kind: 'strength',
      exerciseName: 'Barbell Bench Press',
      days: 30,
    }) as Array<{ topWeightKg: number | null; est1rm: number | null }>;
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('topWeightKg');
    expect(result[0]).toHaveProperty('est1rm');
  });

  it('throws ToolError if exerciseName missing for strength', async () => {
    await seedUser('user-1');
    let threw: unknown;
    try {
      await getTrends(env.DB, 'user-1', { kind: 'strength' });
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeInstanceOf(ToolError);
  });
});

// ---------------------------------------------------------------------------
// get_today happy path + JST window correctness
// ---------------------------------------------------------------------------

describe('getToday', () => {
  it('returns today nutrition, workout status, lastSleep, latestWeightKg', async () => {
    await seedUser('user-1', { timezone: 'UTC', targetKcal: 2000, targetProteinG: 150 });
    const db = getDb(env.DB);

    // Seed a meal in today's UTC window (use a recent timestamp)
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const mealAt = new Date(todayStart.getTime() + 3 * 3600 * 1000); // today+3h UTC

    await db.insert(schema.meals).values({
      id: 'meal-today',
      userId: 'user-1',
      name: 'Breakfast',
      eatenAt: mealAt,
      calories: 500,
      proteinG: 30,
    });

    const result = await getToday(env.DB, 'user-1');
    expect(result.nutrition.kcal).toBe(500);
    expect(result.nutrition.targetKcal).toBe(2000);
    expect(result.nutrition.proteinG).toBe(30);
    expect(['active', 'done', 'rest']).toContain(result.workout);
  });

  it('JST window: meal at 2026-06-12T20:00:00Z lands in June 13 JST window, not June 12', async () => {
    // 2026-06-12T20:00:00Z = 2026-06-13T05:00:00+09:00 → in JST that is June 13
    await seedUser('user-1', { timezone: 'Asia/Tokyo' });
    const db = getDb(env.DB);

    await db.insert(schema.meals).values({
      id: 'meal-jst',
      userId: 'user-1',
      name: 'Late meal',
      eatenAt: new Date('2026-06-12T20:00:00Z'),
      calories: 700,
      proteinG: 40,
    });

    // Simulate "now" being 2026-06-12T20:30:00Z (which is June 13 in JST)
    const nowInJune13JST = new Date('2026-06-12T20:30:00Z');
    const { from: jstFrom, to: jstTo } = dayWindowFor('Asia/Tokyo', nowInJune13JST);

    // The meal at T20:00:00Z is within the JST June 13 window
    const mealTime = new Date('2026-06-12T20:00:00Z');
    expect(mealTime >= jstFrom && mealTime < jstTo).toBe(true);

    // It should NOT be in the June 12 JST window
    const june12JSTNoon = new Date('2026-06-12T03:00:00Z'); // noon JST June 12
    const { from: jstFrom12, to: jstTo12 } = dayWindowFor('Asia/Tokyo', june12JSTNoon);
    expect(mealTime >= jstFrom12 && mealTime < jstTo12).toBe(false);

    // Full getToday call with the JST-now override
    const result = await getToday(env.DB, 'user-1', nowInJune13JST);
    expect(result.nutrition.kcal).toBe(700);
  });
});
