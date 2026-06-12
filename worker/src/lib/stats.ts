/** Epley estimated 1RM; null when not meaningfully computable. */
export function epley1rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null || reps < 1 || reps > 15) return null;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}
