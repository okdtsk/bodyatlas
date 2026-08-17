/**
 * Exercise catalog access shared by the REST routes and the MCP tools.
 *
 * Both entry points create exercises, so both must apply the same duplicate
 * rule — otherwise one path can create the near-duplicate rows the other path
 * then has to resolve between, splitting a movement's history in two.
 */
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { getDb } from '../db';
import { schema } from '../db';
import { matchExercise, type ExerciseCandidate } from '../mcp/match';

/** Exercises a user may log against: the seed catalog plus their own, unarchived. */
export const visibleExercises = (userId: string) =>
  and(
    or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
    eq(schema.exercises.isArchived, false),
  );

/** Load the whole visible catalog once, so matching can be done in memory. */
export async function loadExerciseCatalog(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<ExerciseCandidate[]> {
  return db
    .select({
      id: schema.exercises.id,
      nameEn: schema.exercises.nameEn,
      nameJa: schema.exercises.nameJa,
    })
    .from(schema.exercises)
    .where(visibleExercises(userId))
    .orderBy(asc(schema.exercises.nameEn));
}

/**
 * The exercise a proposed new one would collide with, or null if it is genuinely new.
 *
 * Every supplied name is checked, since a collision on either language is
 * enough to make the new row a duplicate. A name that is merely *ambiguous*
 * does not collide — it resolves to nothing today, so creating it is what
 * makes the user's intent unambiguous.
 */
export function findExerciseConflict(
  catalog: ExerciseCandidate[],
  names: Array<string | null | undefined>,
): ExerciseCandidate | null {
  for (const name of names) {
    if (!name) continue;
    const result = matchExercise(catalog, name);
    if (result.kind === 'match') return result.exercise;
  }
  return null;
}
