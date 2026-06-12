import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import { buildCoachSummary } from '../src/lib/coach';
import { seedUser, seedWorkout, seedCustomExercise } from './helpers';

// Convenience: alias for tests that need direct DB access
function db() {
  return getDb(env.DB);
}

// Reference date: "now" is 2026-06-12T00:00:00Z
// 28-day window: from 2026-05-15T00:00:00Z to 2026-06-12T00:00:00Z
const NOW = new Date('2026-06-12T00:00:00Z');
const WITHIN_WINDOW = new Date('2026-05-20T10:00:00Z');
const OUTSIDE_WINDOW = new Date('2026-05-14T23:59:59Z');

describe('buildCoachSummary', () => {
  it('counts workouts within the 28-day window', async () => {
    await seedUser('coach-1');
    const db = getDb(env.DB);

    await seedCustomExercise('ex-bench', 'coach-1', { muscleGroup: 'chest' });
    await seedWorkout('w1', 'coach-1', 'ex-bench', [{ weightKg: 80, reps: 5 }], {
      startedAt: WITHIN_WINDOW,
      endedAt: new Date(WITHIN_WINDOW.getTime() + 3600_000),
    });
    // This workout is outside the window — should not be counted
    await seedWorkout('w-old', 'coach-1', 'ex-bench', [{ weightKg: 70, reps: 5 }], {
      startedAt: OUTSIDE_WINDOW,
      endedAt: new Date(OUTSIDE_WINDOW.getTime() + 3600_000),
    });

    const summary = await buildCoachSummary(db, 'coach-1', NOW);
    expect(summary.workoutsCount).toBe(1);
  });

  it('sums sets per muscle group in the window', async () => {
    await seedUser('coach-2');

    await seedCustomExercise('ex-chest', 'coach-2', { muscleGroup: 'chest' });
    await seedCustomExercise('ex-back', 'coach-2', { muscleGroup: 'back' });

    // 3 chest sets across 2 workouts
    await seedWorkout('w1', 'coach-2', 'ex-chest', [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 8 },
    ], { startedAt: WITHIN_WINDOW, endedAt: new Date(WITHIN_WINDOW.getTime() + 3600_000) });
    await seedWorkout('w2', 'coach-2', 'ex-chest', [{ weightKg: 85, reps: 5 }], {
      startedAt: new Date('2026-06-01T10:00:00Z'),
      endedAt: new Date('2026-06-01T11:00:00Z'),
    });

    // 2 back sets
    await seedWorkout('w3', 'coach-2', 'ex-back', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ], { startedAt: new Date('2026-06-02T10:00:00Z'), endedAt: new Date('2026-06-02T11:00:00Z') });

    const summary = await buildCoachSummary(db(), 'coach-2', NOW);
    const muscleMap = Object.fromEntries(
      summary.muscleSetTotals.map((m: { muscle: string; sets: number }) => [m.muscle, m.sets]),
    );
    expect(muscleMap['chest']).toBe(3);
    expect(muscleMap['back']).toBe(2);
  });

  it('returns top-3 exercises by set count with first/last est1rm', async () => {
    await seedUser('coach-3');

    // 4 exercises, chest gets most sets
    await seedCustomExercise('ex-a', 'coach-3', { muscleGroup: 'chest' });
    await seedCustomExercise('ex-b', 'coach-3', { muscleGroup: 'back' });
    await seedCustomExercise('ex-c', 'coach-3', { muscleGroup: 'legs' });
    await seedCustomExercise('ex-d', 'coach-3', { muscleGroup: 'shoulders' });

    // ex-a: 4 sets total (1st workout: 80kg x 5 → est1rm=93.3, 2nd workout: 90kg x 3 → est1rm=99)
    await seedWorkout('w1a', 'coach-3', 'ex-a', [
      { weightKg: 80, reps: 5 },
      { weightKg: 80, reps: 5 },
    ], { startedAt: new Date('2026-05-20T10:00:00Z'), endedAt: new Date('2026-05-20T11:00:00Z') });
    await seedWorkout('w2a', 'coach-3', 'ex-a', [
      { weightKg: 90, reps: 3 },
      { weightKg: 90, reps: 3 },
    ], { startedAt: new Date('2026-06-05T10:00:00Z'), endedAt: new Date('2026-06-05T11:00:00Z') });

    // ex-b: 3 sets
    await seedWorkout('w1b', 'coach-3', 'ex-b', [
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
      { weightKg: 100, reps: 5 },
    ], { startedAt: new Date('2026-05-25T10:00:00Z'), endedAt: new Date('2026-05-25T11:00:00Z') });

    // ex-c: 2 sets
    await seedWorkout('w1c', 'coach-3', 'ex-c', [
      { weightKg: 120, reps: 5 },
      { weightKg: 120, reps: 5 },
    ], { startedAt: new Date('2026-05-28T10:00:00Z'), endedAt: new Date('2026-05-28T11:00:00Z') });

    // ex-d: 1 set (should NOT be in top-3)
    await seedWorkout('w1d', 'coach-3', 'ex-d', [{ weightKg: 60, reps: 10 }], {
      startedAt: new Date('2026-05-30T10:00:00Z'), endedAt: new Date('2026-05-30T11:00:00Z'),
    });

    const summary = await buildCoachSummary(db(), 'coach-3', NOW);
    expect(summary.topExercises).toHaveLength(3);

    // Top exercise should be ex-a with 4 sets
    const top = summary.topExercises[0] as { exerciseId: string; setCount: number; firstEst1rm: number | null; lastEst1rm: number | null };
    expect(top.exerciseId).toBe('ex-a');
    expect(top.setCount).toBe(4);
    // First workout est1rm: epley(80, 5) = 80*(1+5/30) = 93.3
    expect(top.firstEst1rm).toBeCloseTo(93.3, 1);
    // Last workout est1rm: epley(90, 3) = 90*(1+3/30) = 99.0
    expect(top.lastEst1rm).toBeCloseTo(99.0, 1);
  });

  it('computes meal daily averages (sum/28) and includes targets', async () => {
    await seedUser('coach-4', {
      targetKcal: 2500,
      targetProteinG: 180,
    });
    const db = getDb(env.DB);

    // Insert 2 meals in window
    await db.insert(schema.meals).values([
      {
        id: 'm1',
        userId: 'coach-4',
        name: 'Breakfast',
        eatenAt: new Date('2026-05-20T08:00:00Z'),
        calories: 600,
        proteinG: 40,
      },
      {
        id: 'm2',
        userId: 'coach-4',
        name: 'Lunch',
        eatenAt: new Date('2026-06-01T12:00:00Z'),
        calories: 800,
        proteinG: 60,
      },
    ]);
    // Outside window — should not count
    await db.insert(schema.meals).values({
      id: 'm-old',
      userId: 'coach-4',
      name: 'Old meal',
      eatenAt: OUTSIDE_WINDOW,
      calories: 999,
      proteinG: 99,
    });

    const summary = await buildCoachSummary(db, 'coach-4', NOW);
    // Total 1400 kcal / 28 days = 50 kcal/day avg
    expect(summary.mealAvgKcal).toBeCloseTo(50.0, 1);
    // Total 100g protein / 28 = 3.6g/day avg
    expect(summary.mealAvgProteinG).toBeCloseTo(3.6, 1);
    expect(summary.targetKcal).toBe(2500);
    expect(summary.targetProteinG).toBe(180);
  });

  it('computes sleep averages (durationMin and quality)', async () => {
    await seedUser('coach-5');
    const db = getDb(env.DB);

    // Sleep 1: 8h = 480 min, quality 4 (within window)
    await db.insert(schema.sleepRecords).values({
      id: 'sl1',
      userId: 'coach-5',
      bedAt: new Date('2026-05-20T22:00:00Z'),
      wokeAt: new Date('2026-05-21T06:00:00Z'),
      quality: 4,
    });
    // Sleep 2: 6h = 360 min, quality 2 (within window)
    await db.insert(schema.sleepRecords).values({
      id: 'sl2',
      userId: 'coach-5',
      bedAt: new Date('2026-06-01T23:00:00Z'),
      wokeAt: new Date('2026-06-02T05:00:00Z'),
      quality: 2,
    });
    // Outside window: both bed and woke are well before the 28-day window
    await db.insert(schema.sleepRecords).values({
      id: 'sl-old',
      userId: 'coach-5',
      bedAt: new Date('2026-05-01T22:00:00Z'),
      wokeAt: new Date('2026-05-02T06:00:00Z'),
      quality: 5,
    });

    const summary = await buildCoachSummary(db, 'coach-5', NOW);
    // avg duration: (480+360)/2 = 420 min
    expect(summary.sleepAvgDurationMin).toBeCloseTo(420, 0);
    // avg quality: (4+2)/2 = 3
    expect(summary.sleepAvgQuality).toBeCloseTo(3, 1);
  });
});
