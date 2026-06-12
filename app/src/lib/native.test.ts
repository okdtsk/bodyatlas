import { describe, expect, it } from 'vitest';
import { mergeMeasurementSamples, mergeSleepSamples, pickNewDays } from './native';

// Helper to build a sample with a value defaulting to 'asleep'
function s(start: string, end: string, value: 'asleep' | 'inBed' = 'asleep') {
  return { start, end, value };
}

describe('mergeSleepSamples', () => {
  it('merges a fragmented night into one record', () => {
    // Three asleep segments within <2h gaps — one continuous night
    const samples = [
      s('2026-06-12T22:00:00Z', '2026-06-13T00:30:00Z'),
      s('2026-06-13T00:45:00Z', '2026-06-13T02:00:00Z'), // 15 min gap → merge
      s('2026-06-13T02:10:00Z', '2026-06-13T06:30:00Z'), // 10 min gap → merge
    ];
    const result = mergeSleepSamples(samples);
    expect(result).toHaveLength(1);
    expect(result[0]!.bedAt).toBe('2026-06-12T22:00:00.000Z');
    expect(result[0]!.wokeAt).toBe('2026-06-13T06:30:00.000Z');
  });

  it('splits two distinct nights separated by >2h gap', () => {
    const samples = [
      s('2026-06-12T22:00:00Z', '2026-06-13T03:00:00Z'),
      // 5h gap — new night
      s('2026-06-13T08:00:00Z', '2026-06-13T10:00:00Z'),
    ];
    const result = mergeSleepSamples(samples);
    expect(result).toHaveLength(2);
    expect(result[0]!.bedAt).toBe('2026-06-12T22:00:00.000Z');
    expect(result[0]!.wokeAt).toBe('2026-06-13T03:00:00.000Z');
    expect(result[1]!.bedAt).toBe('2026-06-13T08:00:00.000Z');
    expect(result[1]!.wokeAt).toBe('2026-06-13T10:00:00.000Z');
  });

  it('splits on a gap exactly equal to 2h (not strictly less than)', () => {
    // gap = exactly 2h → NOT merged (condition is gap < 2h)
    const samples = [
      s('2026-06-12T22:00:00Z', '2026-06-13T01:00:00Z'),
      s('2026-06-13T03:00:00Z', '2026-06-13T07:00:00Z'), // 2h gap
    ];
    const result = mergeSleepSamples(samples);
    expect(result).toHaveLength(2);
  });

  it('drops a merged group that exceeds 24 hours', () => {
    const samples = [
      s('2026-06-12T00:00:00Z', '2026-06-12T10:00:00Z'),
      s('2026-06-12T10:30:00Z', '2026-06-13T10:00:00Z'), // total ~34h after merge
    ];
    const result = mergeSleepSamples(samples);
    expect(result).toHaveLength(0);
  });

  it('ignores inBed samples (uses only asleep)', () => {
    const samples = [
      s('2026-06-12T22:00:00Z', '2026-06-12T22:30:00Z', 'inBed'),
      s('2026-06-12T22:30:00Z', '2026-06-13T06:00:00Z', 'asleep'),
    ];
    const result = mergeSleepSamples(samples);
    expect(result).toHaveLength(1);
    expect(result[0]!.bedAt).toBe('2026-06-12T22:30:00.000Z');
  });
});

describe('pickNewDays', () => {
  it('returns all items when no existing day keys', () => {
    const items = [
      { day: '2026-06-10' },
      { day: '2026-06-11' },
    ];
    const result = pickNewDays(items, new Set(), (t) => t.day);
    expect(result).toHaveLength(2);
  });

  it('skips items whose day key already exists', () => {
    const items = [
      { day: '2026-06-10' },
      { day: '2026-06-11' },
      { day: '2026-06-12' },
    ];
    const existing = new Set(['2026-06-11']);
    const result = pickNewDays(items, existing, (t) => t.day);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.day)).toEqual(['2026-06-10', '2026-06-12']);
  });

  it('returns empty when all days are already present', () => {
    const items = [{ day: '2026-06-10' }];
    const result = pickNewDays(items, new Set(['2026-06-10']), (t) => t.day);
    expect(result).toHaveLength(0);
  });
});

describe('mergeMeasurementSamples', () => {
  // Build local-time ISO instants so localDayKey is stable across test machine timezones.
  const iso = (day: number, hour: number) => new Date(2026, 5, day, hour, 0).toISOString();

  it('carries measuredAt from the source sample (no import-time stamping)', () => {
    const weightIso = iso(10, 8);
    const result = mergeMeasurementSamples([{ date: weightIso, kg: 72.4 }], []);
    expect(result).toHaveLength(1);
    expect(result[0]!.measuredAt).toBe(weightIso);
    expect(result[0]!.kg).toBe(72.4);
    expect(result[0]!.pct).toBeUndefined();
  });

  it('collapses same-day weight and bodyFat into one entry', () => {
    const wIso = iso(10, 8);
    const bfIso = iso(10, 9);
    const result = mergeMeasurementSamples(
      [{ date: wIso, kg: 72.4 }],
      [{ date: bfIso, pct: 18.5 }],
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.kg).toBe(72.4);
    expect(result[0]!.pct).toBe(18.5);
    // Deterministic timestamp: the later sample of the day wins
    expect(result[0]!.measuredAt).toBe(bfIso);
  });

  it('keeps samples on different days as separate entries, sorted by day', () => {
    const result = mergeMeasurementSamples(
      [{ date: iso(11, 8), kg: 72.0 }],
      [{ date: iso(10, 9), pct: 19.0 }],
    );
    expect(result).toHaveLength(2);
    expect(result[0]!.day).toBe('2026-06-10');
    expect(result[0]!.pct).toBe(19.0);
    expect(result[0]!.kg).toBeUndefined();
    expect(result[1]!.day).toBe('2026-06-11');
    expect(result[1]!.kg).toBe(72.0);
  });

  it('produces a bodyFat-only entry with its own measuredAt', () => {
    const bfIso = iso(12, 7);
    const result = mergeMeasurementSamples([], [{ date: bfIso, pct: 17.9 }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.measuredAt).toBe(bfIso);
    expect(result[0]!.kg).toBeUndefined();
    expect(result[0]!.pct).toBe(17.9);
  });
});
