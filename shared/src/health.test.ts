import { describe, expect, it } from 'vitest';
import { mealInputSchema, measurementInputSchema, sleepInputSchema } from './health';

describe('mealInputSchema', () => {
  it('accepts name-only quick logging', () => {
    expect(mealInputSchema.safeParse({ name: 'プロテイン' }).success).toBe(true);
  });
  it('rejects negative calories and blank names', () => {
    expect(mealInputSchema.safeParse({ name: 'x', calories: -10 }).success).toBe(false);
    expect(mealInputSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
  it('accepts a uuid clientId', () => {
    const r = mealInputSchema.safeParse({ name: 'Eggs', clientId: '11111111-1111-1111-1111-111111111111' });
    expect(r.success).toBe(true);
  });
  it('rejects a non-uuid clientId', () => {
    const r = mealInputSchema.safeParse({ name: 'Eggs', clientId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });
  it('still accepts no clientId', () => {
    expect(mealInputSchema.safeParse({ name: 'Eggs' }).success).toBe(true);
  });
});

describe('sleepInputSchema', () => {
  const base = { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:00:00.000Z' };
  it('accepts a normal night with quality', () => {
    expect(sleepInputSchema.safeParse({ ...base, quality: 4 }).success).toBe(true);
  });
  it('rejects wokeAt before bedAt and >24h sleeps', () => {
    expect(sleepInputSchema.safeParse({ bedAt: base.wokeAt, wokeAt: base.bedAt }).success).toBe(false);
    expect(
      sleepInputSchema.safeParse({ bedAt: '2026-06-10T00:00:00.000Z', wokeAt: '2026-06-11T01:00:00.000Z' }).success,
    ).toBe(false);
  });
  it('rejects quality outside 1-5', () => {
    expect(sleepInputSchema.safeParse({ ...base, quality: 6 }).success).toBe(false);
  });
});

describe('measurementInputSchema', () => {
  it('requires at least one value', () => {
    expect(measurementInputSchema.safeParse({}).success).toBe(false);
    expect(measurementInputSchema.safeParse({ weightKg: 72.4 }).success).toBe(true);
    expect(measurementInputSchema.safeParse({ bodyFatPct: 18.5 }).success).toBe(true);
  });
});
