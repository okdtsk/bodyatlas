import { SELF, env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import { seedTemplate, seedUser, seedWorkout, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

async function startWorkout(headers: Record<string, string>): Promise<WorkoutDetail> {
  const res = await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
  return (await res.json()) as WorkoutDetail;
}

type WorkoutDetail = {
  id: string;
  endedAt: string | null;
  workoutExercises: Array<{ id: string; exercise: { id: string }; sets: unknown[] }>;
};

describe('/api/workouts', () => {
  it('creates an empty active workout and reports it via /active', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    expect(res.status).toBe(201);
    const created = (await res.json()) as WorkoutDetail;
    expect(created.endedAt).toBeNull();

    const active = await SELF.fetch('https://example.com/api/workouts/active', { headers });
    expect(((await active.json()) as { workout: WorkoutDetail | null }).workout?.id).toBe(created.id);
  });

  it('refuses a second active workout with 409', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    const second = await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; details: { workoutId: string } } };
    expect(body.error.code).toBe('active_workout_exists');
    expect(body.error.details.workoutId).toBeTruthy();
  });

  it('pre-fills exercises from a template', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Push A', ['seed-barbell-bench-press', 'seed-overhead-press']);
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, { templateId: 't1' }));
    const created = (await res.json()) as WorkoutDetail;
    expect(created.workoutExercises.map((we) => we.exercise.id)).toEqual([
      'seed-barbell-bench-press',
      'seed-overhead-press',
    ]);
  });

  it('copies the exercise list from a previous workout', async () => {
    const headers = await authed();
    await seedWorkout('w-old', 'user-1', 'seed-deadlift', [{ weightKg: 120, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts',
      json(headers, { copyFromWorkoutId: 'w-old' }),
    );
    const created = (await res.json()) as WorkoutDetail;
    expect(created.workoutExercises.map((we) => we.exercise.id)).toEqual(['seed-deadlift']);
    expect(created.workoutExercises[0]?.sets).toHaveLength(0); // structure copied, sets are not
  });

  it('finishes a workout via PATCH and clears /active', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch('https://example.com/api/workouts', json(headers, {}))
    ).json()) as WorkoutDetail;

    const patched = await SELF.fetch(
      `https://example.com/api/workouts/${created.id}`,
      json(headers, { finish: true, notes: 'good session' }, 'PATCH'),
    );
    const finished = (await patched.json()) as { endedAt: string | null; notes: string };
    expect(finished.endedAt).not.toBeNull();
    expect(finished.notes).toBe('good session');

    const active = await SELF.fetch('https://example.com/api/workouts/active', { headers });
    expect(((await active.json()) as { workout: unknown }).workout).toBeNull();
  });

  it('lists workouts newest-first with set counts and filters by exercise', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
    });
    await seedWorkout('w2', 'user-1', 'seed-back-squat', [{ weightKg: 90, reps: 5 }, { weightKg: 90, reps: 5 }], {
      startedAt: new Date('2026-06-01T10:00:00Z'),
    });

    const res = await SELF.fetch('https://example.com/api/workouts', { headers });
    const list = (await res.json()) as Array<{ id: string; setCount: number; exerciseNames: string[] }>;
    expect(list.map((w) => w.id)).toEqual(['w2', 'w1']);
    expect(list[0]?.setCount).toBe(2);
    expect(list[0]?.exerciseNames).toContain('Back Squat');

    const filtered = await SELF.fetch('https://example.com/api/workouts?exerciseId=seed-deadlift', { headers });
    expect(((await filtered.json()) as Array<{ id: string }>).map((w) => w.id)).toEqual(['w1']);
  });

  it('rejects an invalid from date with 422', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/workouts?from=not-a-date', { headers });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });

  it('filters workouts by a from/to date window', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
    });
    await seedWorkout('w2', 'user-1', 'seed-back-squat', [{ weightKg: 90, reps: 5 }, { weightKg: 90, reps: 5 }], {
      startedAt: new Date('2026-06-01T10:00:00Z'),
    });

    const res = await SELF.fetch(
      'https://example.com/api/workouts?from=2026-05-15T00:00:00Z&to=2026-06-15T00:00:00Z',
      { headers },
    );
    expect(res.status).toBe(200);
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((w) => w.id)).toEqual(['w2']);
  });

  it("refuses to copy another user's workout with 404", async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts',
      json(headers, { copyFromWorkoutId: 'w-theirs' }),
    );
    expect(res.status).toBe(404);
  });

  it('scopes detail to the owner and deletes with cascade', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    expect((await SELF.fetch('https://example.com/api/workouts/w-theirs', { headers })).status).toBe(404);

    await seedWorkout('w-mine', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const del = await SELF.fetch('https://example.com/api/workouts/w-mine', { headers, method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await SELF.fetch('https://example.com/api/workouts/w-mine', { headers })).status).toBe(404);
  });
});

describe('/api/workouts nested exercises and sets', () => {
  it('adds an exercise, logs sets with incrementing positions, edits and deletes a set', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);

    const weRes = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises`,
      json(headers, { exerciseId: 'seed-barbell-bench-press' }),
    );
    expect(weRes.status).toBe(201);
    const we = (await weRes.json()) as { id: string; position: number };
    expect(we.position).toBe(1);

    const s1 = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
        json(headers, { weightKg: 80, reps: 8, rpe: 8 }),
      )
    ).json()) as { id: string; position: number };
    const s2 = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
        json(headers, { weightKg: 80, reps: 7 }),
      )
    ).json()) as { id: string; position: number };
    expect([s1.position, s2.position]).toEqual([1, 2]);

    const patched = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets/${s2.id}`,
      json(headers, { weightKg: 82.5, reps: 6 }, 'PATCH'),
    );
    expect(((await patched.json()) as { weightKg: number }).weightKg).toBe(82.5);

    const del = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets/${s1.id}`,
      { headers, method: 'DELETE' },
    );
    expect(del.status).toBe(200);

    const detail = (await (
      await SELF.fetch(`https://example.com/api/workouts/${w.id}`, { headers })
    ).json()) as WorkoutDetail;
    expect(detail.workoutExercises[0]?.sets).toHaveLength(1);
  });

  it('rejects an invalid set payload with 422', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises`,
        json(headers, { exerciseId: 'seed-deadlift' }),
      )
    ).json()) as { id: string };
    const res = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
      json(headers, { weightKg: 80 }), // no reps/duration/distance
    );
    expect(res.status).toBe(422);
  });

  it("cannot touch another user's workout via nested routes", async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', []);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w-theirs/exercises',
      json(headers, { exerciseId: 'seed-deadlift' }),
    );
    expect(res.status).toBe(404);
  });

  it('removes a workout exercise together with its sets', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises`,
        json(headers, { exerciseId: 'seed-dip' }),
      )
    ).json()) as { id: string };
    await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
      json(headers, { reps: 10 }),
    );
    const del = await SELF.fetch(`https://example.com/api/workouts/${w.id}/exercises/${we.id}`, {
      headers,
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const detail = (await (
      await SELF.fetch(`https://example.com/api/workouts/${w.id}`, { headers })
    ).json()) as WorkoutDetail;
    expect(detail.workoutExercises).toHaveLength(0);
  });

  it('allows editing a finished workout (post-hoc history fixes are a feature)', async () => {
    const headers = await authed();
    await seedWorkout('w-done', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w-done/exercises/w-done-we1/sets',
      json(headers, { weightKg: 102.5, reps: 5 }),
    );
    expect(res.status).toBe(201);
    const detail = (await (
      await SELF.fetch('https://example.com/api/workouts/w-done', { headers })
    ).json()) as WorkoutDetail;
    expect(detail.workoutExercises[0]?.sets).toHaveLength(2);
  });
});

describe('plan 2c API extensions', () => {
  it('persists a note on a set and returns it in detail', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises`,
        json(headers, { exerciseId: 'seed-barbell-bench-press' }),
      )
    ).json()) as { id: string };
    const set = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
        json(headers, { weightKg: 80, reps: 8, note: '最後だけフォームが崩れた' }),
      )
    ).json()) as { note: string | null };
    expect(set.note).toBe('最後だけフォームが崩れた');
  });

  it('copies targetSets from the template onto workout exercises', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Push A', ['seed-barbell-bench-press']);
    const db = getDb(env.DB);
    await db
      .update(schema.templateExercises)
      .set({ targetSets: 3 })
      .where(eq(schema.templateExercises.templateId, 't1'));
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, { templateId: 't1' }));
    const created = (await res.json()) as { workoutExercises: Array<{ targetSets: number | null }> };
    expect(created.workoutExercises[0]?.targetSets).toBe(3);
  });

  it('updates startedAt and endedAt via PATCH', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w1',
      json(headers, { startedAt: '2026-06-01T09:30:00.000Z', endedAt: '2026-06-01T10:45:00.000Z' }, 'PATCH'),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { startedAt: string; endedAt: string };
    expect(new Date(updated.startedAt).toISOString()).toBe('2026-06-01T09:30:00.000Z');
    expect(new Date(updated.endedAt).toISOString()).toBe('2026-06-01T10:45:00.000Z');
  });

  it('rejects endedAt before startedAt with 422', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w1',
      json(headers, { endedAt: '2026-05-01T09:00:00.000Z' }, 'PATCH'), // before existing startedAt 2026-06-01
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_time_range');
  });
});
