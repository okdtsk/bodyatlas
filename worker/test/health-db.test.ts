import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import { seedUser } from './helpers';

describe('health tables', () => {
  it('round-trips a meal, a sleep record, and a measurement', async () => {
    await seedUser('user-1');
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({
      id: 'm1',
      userId: 'user-1',
      name: 'チキンサラダ',
      eatenAt: new Date('2026-06-12T12:10:00Z'),
      calories: 480,
      proteinG: 42,
    });
    await db.insert(schema.sleepRecords).values({
      id: 'sl1',
      userId: 'user-1',
      bedAt: new Date('2026-06-11T14:40:00Z'),
      wokeAt: new Date('2026-06-11T22:00:00Z'),
      quality: 4,
    });
    await db.insert(schema.bodyMeasurements).values({
      id: 'bm1',
      userId: 'user-1',
      measuredAt: new Date('2026-06-12T00:00:00Z'),
      weightKg: 72.4,
    });

    const meal = await db.query.meals.findFirst();
    expect(meal?.name).toBe('チキンサラダ');
    expect(meal?.isFavorite).toBe(false);
    expect(meal?.fatG).toBeNull();
    const sleep = await db.query.sleepRecords.findFirst();
    expect(sleep?.quality).toBe(4);
    const bm = await db.query.bodyMeasurements.findFirst();
    expect(bm?.bodyFatPct).toBeNull();
  });
});
