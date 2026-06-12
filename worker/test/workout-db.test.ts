import { env } from 'cloudflare:test';
import { asc, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import { seedUser } from './helpers';

describe('workout tables', () => {
  it('round-trips a workout with exercises and sets via relations', async () => {
    await seedUser('user-1');
    const db = getDb(env.DB);
    await db.insert(schema.exercises).values({
      id: 'ex-rt',
      userId: 'user-1',
      nameEn: 'Roundtrip Press',
      type: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    });
    await db.insert(schema.workouts).values({ id: 'w1', userId: 'user-1' });
    await db.insert(schema.workoutExercises).values({
      id: 'we1',
      workoutId: 'w1',
      exerciseId: 'ex-rt',
      position: 1,
    });
    const detail = await db.query.workouts.findFirst({
      where: eq(schema.workouts.id, 'w1'),
      with: {
        workoutExercises: {
          orderBy: asc(schema.workoutExercises.position),
          with: { sets: true },
        },
      },
    });
    expect(detail?.workoutExercises).toHaveLength(1);
    expect(detail?.endedAt).toBeNull();
  });

  it('cascades deletes from workout to sets', async () => {
    await seedUser('user-1');
    const db = getDb(env.DB);
    await db.insert(schema.exercises).values({
      id: 'ex1',
      userId: 'user-1',
      nameEn: 'Test Press',
      type: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    });
    await db.insert(schema.workouts).values({ id: 'w1', userId: 'user-1' });
    await db.insert(schema.workoutExercises).values({
      id: 'we1',
      workoutId: 'w1',
      exerciseId: 'ex1',
      position: 1,
    });
    await db.insert(schema.sets).values({ id: 's1', workoutExerciseId: 'we1', position: 1, weightKg: 80, reps: 8 });

    await db.delete(schema.workouts).where(eq(schema.workouts.id, 'w1'));

    expect(await db.select().from(schema.sets)).toHaveLength(0);
    expect(await db.select().from(schema.workoutExercises)).toHaveLength(0);
  });
});

describe('seed exercise catalog', () => {
  it('ships seed exercises with EN/JA names and survives the per-test reset', async () => {
    const db = getDb(env.DB);
    const seeds = await db.select().from(schema.exercises).where(isNull(schema.exercises.userId));
    expect(seeds.length).toBeGreaterThanOrEqual(35);

    const bench = seeds.find((e) => e.id === 'seed-barbell-bench-press');
    expect(bench).toMatchObject({
      nameEn: 'Barbell Bench Press',
      nameJa: 'ベンチプレス',
      type: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    });
    const hack = seeds.find((e) => e.id === 'seed-machine-hack-squat');
    expect(hack?.nameJa).toBe('ハックスクワット');
  });
});
