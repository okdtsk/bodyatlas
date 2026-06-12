export const EXERCISE_TYPES = ['strength', 'bodyweight', 'cardio'] as const;
export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'arms',
  'legs',
  'core',
  'full-body',
] as const;
export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
  'bodyweight',
  'band',
  'cardio-machine',
  'other',
] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type Equipment = (typeof EQUIPMENT)[number];
