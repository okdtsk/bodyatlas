import { z } from 'zod';

export const AI_PROVIDERS = ['claude', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const aiSettingsInputSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().min(1).max(80),
  apiKey: z.string().trim().min(8).max(200).optional(),
});

export type AiSettingsInput = z.infer<typeof aiSettingsInputSchema>;

export const estimateMealInputSchema = z.object({
  description: z.string().trim().min(1).max(300),
});

export type EstimateMealInput = z.infer<typeof estimateMealInputSchema>;

export const estimateResultSchema = z.object({
  calories: z.number().int().min(0).max(10000),
  proteinG: z.number().min(0).max(1000),
  fatG: z.number().min(0).max(1000),
  carbsG: z.number().min(0).max(1000),
  confidence: z.enum(['low', 'medium', 'high']),
  note: z.string().max(150).optional(),
});

export type EstimateResult = z.infer<typeof estimateResultSchema>;
