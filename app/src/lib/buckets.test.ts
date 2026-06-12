import { describe, expect, it } from 'vitest';
import { bucketSum, localDayKey, rangeFromIso, weekKey } from './buckets';

describe('localDayKey', () => {
  it('keys by the device-local calendar day', () => {
    const key = localDayKey(new Date(2026, 5, 12, 23, 30).toISOString());
    expect(key).toBe('2026-06-12');
  });
});

describe('weekKey', () => {
  it('keys by the local Monday of the week', () => {
    expect(weekKey(new Date(2026, 5, 12).toISOString())).toBe('2026-06-08'); // Fri → Mon
    expect(weekKey(new Date(2026, 5, 8).toISOString())).toBe('2026-06-08'); // Mon → itself
    expect(weekKey(new Date(2026, 5, 14).toISOString())).toBe('2026-06-08'); // Sun → prev Mon
  });
});

describe('bucketSum', () => {
  it('sums values per key in insertion-sorted order', () => {
    const out = bucketSum(
      [
        { iso: new Date(2026, 5, 9).toISOString(), value: 3 },
        { iso: new Date(2026, 5, 12).toISOString(), value: 2 },
        { iso: new Date(2026, 5, 16).toISOString(), value: 4 },
      ],
      weekKey,
    );
    expect(out).toEqual([
      { key: '2026-06-08', value: 5 },
      { key: '2026-06-15', value: 4 },
    ]);
  });
});

describe('rangeFromIso', () => {
  it('maps the selector to a from-instant N days back', () => {
    const from = new Date(rangeFromIso('4w'));
    expect(Math.round((Date.now() - from.getTime()) / 86400000)).toBe(28);
  });
});
