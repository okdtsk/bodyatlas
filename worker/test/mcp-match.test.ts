/**
 * Pure exercise-name matcher — no D1, no fetch.
 *
 * The MCP client (ChatGPT/Claude) guesses exercise names from natural language,
 * so resolution has to tolerate case, spacing, hyphens and half-width kana
 * without ever silently picking the wrong exercise.
 */
import { describe, expect, it } from 'vitest';
import { matchExercise, normalizeExerciseName, type ExerciseCandidate } from '../src/mcp/match';

const catalog: ExerciseCandidate[] = [
  { id: 'e-bench', nameEn: 'Barbell Bench Press', nameJa: 'ベンチプレス' },
  { id: 'e-incline', nameEn: 'Incline Dumbbell Press', nameJa: 'インクラインダンベルプレス' },
  { id: 'e-pushup', nameEn: 'Push-Up', nameJa: '腕立て伏せ' },
  { id: 'e-back-squat', nameEn: 'Back Squat', nameJa: 'バックスクワット' },
  { id: 'e-front-squat', nameEn: 'Front Squat', nameJa: 'フロントスクワット' },
  { id: 'e-hack-squat', nameEn: 'Machine Hack Squat', nameJa: 'ハックスクワット' },
  { id: 'e-leg-press', nameEn: 'Leg Press', nameJa: 'レッグプレス' },
];

describe('normalizeExerciseName', () => {
  it('lowercases and strips spaces, hyphens and underscores', () => {
    expect(normalizeExerciseName('  Push-Up ')).toBe('pushup');
    expect(normalizeExerciseName('push up')).toBe('pushup');
    expect(normalizeExerciseName('PUSH_UP')).toBe('pushup');
  });

  it('folds half-width katakana to full-width via NFKC', () => {
    expect(normalizeExerciseName('ﾍﾞﾝﾁﾌﾟﾚｽ')).toBe(normalizeExerciseName('ベンチプレス'));
  });

  it('folds full-width latin and the ideographic space', () => {
    expect(normalizeExerciseName('Ｌｅｇ　Ｐｒｅｓｓ')).toBe('legpress');
  });

  it('keeps the katakana prolonged sound mark, which is not a hyphen', () => {
    expect(normalizeExerciseName('カール')).toBe('カール');
  });
});

describe('matchExercise', () => {
  it('matches an exact English name case-insensitively', () => {
    const result = matchExercise(catalog, 'barbell bench press');
    expect(result).toEqual({ kind: 'match', exercise: catalog[0] });
  });

  it('matches an exact Japanese name', () => {
    const result = matchExercise(catalog, 'ハックスクワット');
    expect(result).toEqual({ kind: 'match', exercise: catalog[5] });
  });

  it('matches across spacing and hyphen differences', () => {
    const result = matchExercise(catalog, 'push up');
    expect(result).toEqual({ kind: 'match', exercise: catalog[2] });
  });

  it('matches half-width katakana against the Japanese name', () => {
    const result = matchExercise(catalog, 'ﾍﾞﾝﾁﾌﾟﾚｽ');
    expect(result).toEqual({ kind: 'match', exercise: catalog[0] });
  });

  it('accepts a substring that hits exactly one exercise', () => {
    const result = matchExercise(catalog, 'hack squat');
    expect(result).toEqual({ kind: 'match', exercise: catalog[5] });
  });

  it('accepts a Japanese substring that hits exactly one exercise', () => {
    const result = matchExercise(catalog, 'インクライン');
    expect(result).toEqual({ kind: 'match', exercise: catalog[1] });
  });

  it('refuses a substring that hits several exercises', () => {
    const result = matchExercise(catalog, 'squat');
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') throw new Error('unreachable');
    expect(result.suggestions.map((e) => e.nameEn)).toEqual([
      'Back Squat',
      'Front Squat',
      'Machine Hack Squat',
    ]);
  });

  it('suggests near names when nothing matches', () => {
    const result = matchExercise(catalog, 'Incline DB Press');
    expect(result.kind).toBe('none');
    if (result.kind !== 'none') throw new Error('unreachable');
    expect(result.suggestions[0]!.nameEn).toBe('Incline Dumbbell Press');
  });

  it('returns no suggestions when nothing is even close', () => {
    const result = matchExercise(catalog, 'Zercher Carry');
    expect(result).toEqual({ kind: 'none', suggestions: [] });
  });

  it('caps suggestions at five', () => {
    const many: ExerciseCandidate[] = Array.from({ length: 12 }, (_, i) => ({
      id: `e-${i}`,
      nameEn: `Cable Press ${i}`,
      nameJa: null,
    }));
    const result = matchExercise(many, 'cable press');
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') throw new Error('unreachable');
    expect(result.suggestions).toHaveLength(5);
  });
});
