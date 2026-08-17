import { describe, expect, it } from 'vitest';
import { updateMeSchema, userPrefsSchema } from './user';

describe('userPrefsSchema', () => {
  it('accepts a valid full preference set', () => {
    const result = userPrefsSchema.safeParse({
      locale: 'ja',
      theme: 'dark',
      unit: 'kg',
      timezone: 'Asia/Tokyo',
      targetKcal: 2400,
      targetProteinG: 150,
      targetFatG: 70,
      targetCarbsG: 250,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown theme', () => {
    const result = userPrefsSchema.safeParse({
      locale: 'en',
      theme: 'neon',
      unit: 'kg',
      timezone: 'Asia/Tokyo',
      targetKcal: null,
      targetProteinG: null,
      targetFatG: null,
      targetCarbsG: null,
    });
    expect(result.success).toBe(false);
  });

  it('accepts null for nutrition targets (clearing a goal)', () => {
    const result = userPrefsSchema.safeParse({
      locale: 'en', theme: 'dark', unit: 'kg', timezone: 'UTC',
      targetKcal: null, targetProteinG: null, targetFatG: null, targetCarbsG: null,
    });
    expect(result.success).toBe(true);
  });
});

describe('updateMeSchema', () => {
  it('accepts a partial patch', () => {
    expect(updateMeSchema.safeParse({ theme: 'light' }).success).toBe(true);
  });

  it('rejects a negative calorie target', () => {
    expect(updateMeSchema.safeParse({ targetKcal: -100 }).success).toBe(false);
  });

  it('allows clearing a target via PATCH (null)', () => {
    expect(updateMeSchema.safeParse({ targetKcal: null }).success).toBe(true);
  });

  it('rejects a non-IANA timezone', () => {
    expect(updateMeSchema.safeParse({ timezone: 'not-a-zone' }).success).toBe(false);
  });

  it('accepts the three theme modes', () => {
    for (const theme of ['dark', 'light', 'system']) {
      expect(updateMeSchema.safeParse({ theme }).success).toBe(true);
    }
  });

  it('rejects the retired mood themes', () => {
    for (const theme of ['gym-dark', 'clinical-light', 'warm-journal']) {
      expect(updateMeSchema.safeParse({ theme }).success).toBe(false);
    }
  });
});
