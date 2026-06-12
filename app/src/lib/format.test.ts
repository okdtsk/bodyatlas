import { describe, expect, it } from 'vitest';
import { exerciseName, formatSet, trimNum } from './format';

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
