import { describe, expect, it } from 'vitest';
import { exerciseName, formatSet, toLocalInputValue, trimNum, weightDelta } from './format';

describe('trimNum', () => {
  it('drops trailing zeros', () => {
    expect(trimNum(80)).toBe('80');
    expect(trimNum(82.5)).toBe('82.5');
    expect(trimNum(82.25)).toBe('82.25');
  });
});

describe('formatSet', () => {
  it('formats a strength set', () => {
    expect(formatSet({ weightKg: 80, reps: 8, rpe: 8.5, durationSec: null, distanceM: null })).toBe(
      '80kg × 8 @8.5',
    );
  });
  it('formats a bodyweight set', () => {
    expect(formatSet({ weightKg: null, reps: 12, rpe: null, durationSec: null, distanceM: null })).toBe(
      '× 12',
    );
  });
  it('formats cardio duration + distance', () => {
    expect(
      formatSet({ weightKg: null, reps: null, rpe: null, durationSec: 1500, distanceM: 5000 }),
    ).toBe('25:00 · 5km');
  });
});

describe('exerciseName', () => {
  const ex = { nameEn: 'Bench Press', nameJa: 'ベンチプレス' };
  it('prefers Japanese in ja locale with EN fallback', () => {
    expect(exerciseName(ex, 'ja')).toBe('ベンチプレス');
    expect(exerciseName({ nameEn: 'Custom', nameJa: null }, 'ja')).toBe('Custom');
    expect(exerciseName(ex, 'en')).toBe('Bench Press');
  });
});

describe('weightDelta', () => {
  const s = (weightKg: number | null) => ({ weightKg, reps: 5, rpe: null, durationSec: null, distanceM: null });
  it('compares top weights', () => {
    expect(weightDelta([s(82.5), s(80)], [s(80), s(80)])).toBe(2.5);
  });
  it('returns null when either side has no weight', () => {
    expect(weightDelta([s(null)], [s(80)])).toBeNull();
    expect(weightDelta([], [s(80)])).toBeNull();
  });
});

describe('toLocalInputValue', () => {
  it('formats an ISO string for datetime-local inputs', () => {
    const v = toLocalInputValue('2026-06-01T09:30:00.000Z');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(v).getMinutes()).toBe(new Date('2026-06-01T09:30:00.000Z').getMinutes());
  });
});
