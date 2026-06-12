import { z } from 'zod';

export const LOCALES = ['en', 'ja'] as const;
export const THEMES = ['gym-dark', 'clinical-light', 'warm-journal'] as const;
export const UNITS = ['kg'] as const;

export type Locale = (typeof LOCALES)[number];
export type Theme = (typeof THEMES)[number];
export type Unit = (typeof UNITS)[number];

export const userPrefsSchema = z.object({
  locale: z.enum(LOCALES),
  theme: z.enum(THEMES),
  unit: z.enum(UNITS),
  timezone: z.string().refine(
    (v) => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: v });
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Invalid IANA timezone' },
  ),
  targetKcal: z.number().int().positive().nullable(),
  targetProteinG: z.number().int().positive().nullable(),
  targetFatG: z.number().int().positive().nullable(),
  targetCarbsG: z.number().int().positive().nullable(),
});

export const updateMeSchema = userPrefsSchema.partial();

export type UserPrefs = z.infer<typeof userPrefsSchema>;
export type UpdateMe = z.infer<typeof updateMeSchema>;
