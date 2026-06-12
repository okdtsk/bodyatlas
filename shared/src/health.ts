import { z } from 'zod';
import { isoDateString } from './datetime';

export const mealInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eatenAt: isoDateString.optional(),
  calories: z.number().int().min(0).max(10000).optional(),
  proteinG: z.number().min(0).max(1000).optional(),
  fatG: z.number().min(0).max(1000).optional(),
  carbsG: z.number().min(0).max(1000).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const mealFavoriteSchema = z.object({ isFavorite: z.boolean() });

export const sleepInputSchema = z
  .object({
    bedAt: isoDateString,
    wokeAt: isoDateString,
    quality: z.number().int().min(1).max(5).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => new Date(v.wokeAt) > new Date(v.bedAt), { message: 'wokeAt must be after bedAt' })
  .refine(
    (v) => new Date(v.wokeAt).getTime() - new Date(v.bedAt).getTime() <= 24 * 3600 * 1000,
    { message: 'Sleep duration cannot exceed 24 hours' },
  );

export const measurementInputSchema = z
  .object({
    measuredAt: isoDateString.optional(),
    weightKg: z.number().positive().max(500).optional(),
    bodyFatPct: z.number().min(1).max(75).optional(),
  })
  .refine((v) => v.weightKg !== undefined || v.bodyFatPct !== undefined, {
    message: 'Provide weight or body fat',
  });

export type MealInput = z.infer<typeof mealInputSchema>;
export type SleepInput = z.infer<typeof sleepInputSchema>;
export type MeasurementInput = z.infer<typeof measurementInputSchema>;
