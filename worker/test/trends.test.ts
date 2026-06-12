import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, seedWorkout, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

describe('/api/trends/strength/:exerciseId', () => {
  it('returns per-workout top weight and Epley 1RM ascending', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-barbell-bench-press', [
      { weightKg: 80, reps: 8 },
      { weightKg: 82.5, reps: 5 },
    ], { startedAt: new Date('2026-05-01T10:00:00Z'), endedAt: new Date('2026-05-01T11:00:00Z') });
    await seedWorkout('w2', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 85, reps: 5 }], {
      startedAt: new Date('2026-06-01T10:00:00Z'), endedAt: new Date('2026-06-01T11:00:00Z'),
    });

    const res = await SELF.fetch(
      'https://example.com/api/trends/strength/seed-barbell-bench-press?from=2026-04-01T00:00:00.000Z',
      { headers },
    );
    expect(res.status).toBe(200);
    const points = (await res.json()) as Array<{ workoutId: string; topWeightKg: number; est1rm: number; setCount: number }>;
    expect(points.map((p) => p.workoutId)).toEqual(['w1', 'w2']);
    expect(points[0]?.topWeightKg).toBe(82.5);
    // Epley: max(80*(1+8/30)=101.33, 82.5*(1+5/30)=96.25) → 101.3 (1dp)
    expect(points[0]?.est1rm).toBeCloseTo(101.3, 1);
    expect(points[1]?.setCount).toBe(1);
  });

  it('excludes other users and respects from', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', [{ weightKg: 200, reps: 1 }]);
    await seedWorkout('w-old', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }], {
      startedAt: new Date('2026-01-01T10:00:00Z'),
    });
    const res = await SELF.fetch(
      'https://example.com/api/trends/strength/seed-deadlift?from=2026-04-01T00:00:00.000Z',
      { headers },
    );
    expect(await res.json()).toEqual([]);
  });
});

describe('/api/trends/volume', () => {
  it('returns set counts per workout and muscle group', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-barbell-bench-press', [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 8 },
    ]);
    const res = await SELF.fetch(
      'https://example.com/api/trends/volume?from=2026-04-01T00:00:00.000Z',
      { headers },
    );
    const rows = (await res.json()) as Array<{ muscleGroup: string; setCount: number }>;
    expect(rows).toEqual([expect.objectContaining({ muscleGroup: 'chest', setCount: 2 })]);
  });
});

describe('/api/trends/nutrition-body', () => {
  it('returns meal and measurement projections in range', async () => {
    const headers = await authed();
    const json = (body: unknown) => ({
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await SELF.fetch('https://example.com/api/meals', json({ name: 'Lunch', calories: 700, proteinG: 40, eatenAt: '2026-06-01T03:00:00.000Z' }));
    await SELF.fetch('https://example.com/api/measurements', json({ weightKg: 72.4, measuredAt: '2026-06-01T00:00:00.000Z' }));

    const res = await SELF.fetch(
      'https://example.com/api/trends/nutrition-body?from=2026-05-01T00:00:00.000Z',
      { headers },
    );
    const body = (await res.json()) as { meals: Array<{ calories: number | null }>; measurements: Array<{ weightKg: number | null }> };
    expect(body.meals).toHaveLength(1);
    expect(body.measurements[0]?.weightKg).toBe(72.4);
  });
});
