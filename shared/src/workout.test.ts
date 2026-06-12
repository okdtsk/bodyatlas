import { describe, expect, it } from 'vitest';
import {
  createExerciseSchema,
  createWorkoutSchema,
  setInputSchema,
  templateInputSchema,
  updateWorkoutSchema,
} from './workout';

describe('setInputSchema', () => {
  it('accepts a strength set', () => {
    expect(setInputSchema.safeParse({ weightKg: 80, reps: 8, rpe: 8.5 }).success).toBe(true);
  });
  it('accepts a cardio set with duration only', () => {
    expect(setInputSchema.safeParse({ durationSec: 1200 }).success).toBe(true);
  });
  it('rejects an empty set', () => {
    expect(setInputSchema.safeParse({ weightKg: 80 }).success).toBe(false);
  });
  it('rejects rpe off the 0.5 grid', () => {
    expect(setInputSchema.safeParse({ reps: 8, rpe: 8.3 }).success).toBe(false);
  });
});

describe('createWorkoutSchema', () => {
  it('accepts empty, templateId, or copyFromWorkoutId — but not both sources', () => {
    expect(createWorkoutSchema.safeParse({}).success).toBe(true);
    expect(createWorkoutSchema.safeParse({ templateId: 't1' }).success).toBe(true);
    expect(createWorkoutSchema.safeParse({ copyFromWorkoutId: 'w1' }).success).toBe(true);
    expect(
      createWorkoutSchema.safeParse({ templateId: 't1', copyFromWorkoutId: 'w1' }).success,
    ).toBe(false);
  });
});

describe('templateInputSchema', () => {
  it('requires a name and at least one exercise', () => {
    expect(templateInputSchema.safeParse({ name: 'Push A', exercises: [] }).success).toBe(false);
    expect(
      templateInputSchema.safeParse({
        name: 'Push A',
        exercises: [{ exerciseId: 'seed-barbell-bench-press', targetSets: 3 }],
      }).success,
    ).toBe(true);
  });
});

describe('createExerciseSchema', () => {
  it('trims and bounds the name', () => {
    expect(createExerciseSchema.safeParse({ name: '  ', type: 'strength', muscleGroup: 'chest', equipment: 'barbell' }).success).toBe(false);
  });
});

describe('updateWorkoutSchema', () => {
  it('accepts finish and notes', () => {
    expect(updateWorkoutSchema.safeParse({ finish: true, notes: 'felt strong' }).success).toBe(true);
  });
});

describe('plan 2c schema extensions', () => {
  it('accepts a note on a set and trims it', () => {
    const r = setInputSchema.safeParse({ reps: 8, note: ' フォーム良し ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBe('フォーム良し');
  });
  it('accepts ISO datetimes with explicit timezone and rejects local or garbage strings', () => {
    expect(updateWorkoutSchema.safeParse({ startedAt: '2026-06-01T09:30:00.000Z' }).success).toBe(true);
    expect(updateWorkoutSchema.safeParse({ startedAt: '2026-06-01T18:30:00+09:00' }).success).toBe(true);
    expect(updateWorkoutSchema.safeParse({ startedAt: '2026-06-01T09:30' }).success).toBe(false);
    expect(updateWorkoutSchema.safeParse({ endedAt: 'not-a-date' }).success).toBe(false);
  });
});
