import { describe, expect, it } from 'vitest';
import { addDays, dayRangeIso, exerciseName, formatSet, sleepDurationLabel, toLocalInputValue, trimNum, weightDelta } from './format';

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

describe('dayRangeIso', () => {
  it('returns local midnight to next midnight as TZ-explicit ISO', () => {
    const d = new Date(2026, 5, 12, 15, 30); // local June 12
    const { fromIso, toIso } = dayRangeIso(d);
    expect(new Date(fromIso).getHours()).toBe(0);
    expect(new Date(toIso).getTime() - new Date(fromIso).getTime()).toBe(86400000);
    expect(fromIso.endsWith('Z')).toBe(true);
  });
});

describe('addDays', () => {
  it('moves whole days', () => {
    expect(addDays(new Date(2026, 5, 12), -1).getDate()).toBe(11);
  });
});

describe('sleepDurationLabel', () => {
  it('formats h:mm', () => {
    expect(sleepDurationLabel('2026-06-11T14:40:00.000Z', '2026-06-11T22:00:00.000Z')).toBe('7h 20m');
  });
});
