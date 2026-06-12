import { z } from 'zod';

/** Parseable datetime WITH explicit timezone (Z or ±HH:MM) — bare local strings shift in the UTC worker runtime. */
export const isoDateString = z
  .string()
  .refine(
    (v) => !Number.isNaN(new Date(v).getTime()) && /(?:Z|[+-]\d{2}:\d{2})$/.test(v),
    { message: 'Datetime must include an explicit timezone (Z or ±HH:MM)' },
  );
