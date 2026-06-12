import { describe, expect, it } from 'vitest';
import { mergeSleepSamples, pickNewDays } from './native';

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
