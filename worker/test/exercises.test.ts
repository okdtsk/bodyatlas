import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedCustomExercise, seedUser, seedWorkout, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

describe('/api/exercises', () => {
  it("lists seed + own custom exercises, not other users' customs", async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedCustomExercise('mine', 'user-1', { nameEn: 'My Special Press' });
    await seedCustomExercise('theirs', 'user-2', { nameEn: 'Their Press' });

    const res = await SELF.fetch('https://example.com/api/exercises', { headers });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === 'mine')).toBe(true);
    expect(list.some((e) => e.id === 'theirs')).toBe(false);
    expect(list.some((e) => e.id === 'seed-barbell-bench-press')).toBe(true);
  });

  it('searches by Japanese name', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/exercises?q=ベンチ', { headers });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((e) => e.id)).toContain('seed-barbell-bench-press');
    expect(list.every((e) => e.id !== 'seed-back-squat')).toBe(true);
  });

  it('creates a custom exercise', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/exercises', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zercher Squat', type: 'strength', muscleGroup: 'legs', equipment: 'barbell' }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; nameEn: string; userId: string };
    expect(created.nameEn).toBe('Zercher Squat');
    expect(created.userId).toBe('user-1');
  });

  it('archives own custom exercise but rejects patching seed rows', async () => {
    const headers = await authed();
    await seedCustomExercise('mine', 'user-1');
    const ok = await SELF.fetch('https://example.com/api/exercises/mine', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: true }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { isArchived: boolean }).isArchived).toBe(true);

    const seed = await SELF.fetch('https://example.com/api/exercises/seed-barbell-bench-press', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: true }),
    });
    expect(seed.status).toBe(404);
  });

  it('returns the most recent sets for an exercise via last-sets', async () => {
    const headers = await authed();
    await seedWorkout('w-old', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 75, reps: 8 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
      endedAt: new Date('2026-05-01T11:00:00Z'),
    });
    await seedWorkout('w-new', 'user-1', 'seed-barbell-bench-press', [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 7 },
    ]);

    const res = await SELF.fetch(
      'https://example.com/api/exercises/seed-barbell-bench-press/last-sets',
      { headers },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workoutId: string; sets: Array<{ weightKg: number }> } | null;
    expect(body?.workoutId).toBe('w-new');
    expect(body?.sets).toHaveLength(2);
  });

  it('last-sets excludes a given workout (the active one)', async () => {
    const headers = await authed();
    await seedWorkout('w-prev', 'user-1', 'seed-deadlift', [{ weightKg: 120, reps: 5 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
    });
    await seedWorkout('w-active', 'user-1', 'seed-deadlift', [], { endedAt: null });

    const res = await SELF.fetch(
      'https://example.com/api/exercises/seed-deadlift/last-sets?excludeWorkoutId=w-active',
      { headers },
    );
    const body = (await res.json()) as { workoutId: string } | null;
    expect(body?.workoutId).toBe('w-prev');
  });

  it("last-sets never returns another user's workout data", async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-barbell-bench-press', [{ weightKg: 200, reps: 1 }]);

    const res = await SELF.fetch(
      'https://example.com/api/exercises/seed-barbell-bench-press/last-sets',
      { headers },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull(); // user-1 has never performed it
  });

  it('last-sets returns null when never performed', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/exercises/seed-dip/last-sets', { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
