import { z } from 'zod';
import { isoDateString } from './datetime';

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

export const setInputSchema = z
  .object({
    weightKg: z.number().positive().max(1000).optional(),
    reps: z.number().int().positive().max(1000).optional(),
    rpe: z.number().min(1).max(10).multipleOf(0.5).optional(),
    durationSec: z.number().int().positive().max(86400).optional(),
    distanceM: z.number().positive().max(1000000).optional(),
    note: z.string().trim().min(1).max(200).optional(),
    clientId: z.string().guid().optional(),
  })
  .refine((v) => v.reps !== undefined || v.durationSec !== undefined || v.distanceM !== undefined, {
    message: 'A set needs reps, duration, or distance',
  });

export const createExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(EXERCISE_TYPES),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
});

export const updateExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  muscleGroup: z.enum(MUSCLE_GROUPS).optional(),
  equipment: z.enum(EQUIPMENT).optional(),
  isArchived: z.boolean().optional(),
});

export const createWorkoutSchema = z
  .object({
    templateId: z.string().optional(),
    copyFromWorkoutId: z.string().optional(),
  })
  .refine((v) => !(v.templateId && v.copyFromWorkoutId), {
    message: 'Provide templateId or copyFromWorkoutId, not both',
  });

export const updateWorkoutSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  finish: z.boolean().optional(),
  startedAt: isoDateString.optional(),
  endedAt: isoDateString.optional(),
});

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string(),
        targetSets: z.number().int().positive().max(20).optional(),
      }),
    )
    .min(1)
    .max(30),
});

export const addWorkoutExerciseSchema = z.object({ exerciseId: z.string() });

export type SetInput = z.infer<typeof setInputSchema>;
export type CreateExercise = z.infer<typeof createExerciseSchema>;
export type UpdateExercise = z.infer<typeof updateExerciseSchema>;
export type CreateWorkout = z.infer<typeof createWorkoutSchema>;
export type UpdateWorkout = z.infer<typeof updateWorkoutSchema>;
export type TemplateInput = z.infer<typeof templateInputSchema>;
