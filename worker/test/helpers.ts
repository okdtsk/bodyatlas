import { env } from 'cloudflare:test';
import { getDb, schema } from '../src/db';
import { SESSION_TTL_SECONDS } from '../src/auth/session';


export async function seedUser(
  id: string,
  overrides: Partial<typeof schema.users.$inferInsert> = {},
) {
  const db = getDb(env.DB);
  await db.insert(schema.users).values({
    id,
    googleSub: `google-${id}`,
    email: `${id}@example.com`,
    name: id,
    ...overrides,
  });
}

export async function sessionCookieFor(userId: string): Promise<string> {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, userId, {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return `ba_session=${token}`;
}

/** Unsigned JWT good enough for decoding tests (we never verify signatures on
 *  id_tokens fetched directly from Google's token endpoint over TLS). */
export function fakeIdToken(claims: Record<string, unknown>): string {
  const b64url = (s: string) =>
    btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(claims))}.sig`;
}

export async function seedCustomExercise(
  id: string,
  userId: string,
  overrides: Partial<typeof schema.exercises.$inferInsert> = {},
) {
  const db = getDb(env.DB);
  await db.insert(schema.exercises).values({
    id,
    userId,
    nameEn: `Exercise ${id}`,
    type: 'strength',
    muscleGroup: 'chest',
    equipment: 'barbell',
    ...overrides,
  });
}

/** Creates a finished workout with one exercise and the given sets. */
export async function seedWorkout(
  id: string,
  userId: string,
  exerciseId: string,
  setValues: Array<Partial<typeof schema.sets.$inferInsert>>,
  overrides: Partial<typeof schema.workouts.$inferInsert> = {},
) {
  const db = getDb(env.DB);
  await db.insert(schema.workouts).values({
    id,
    userId,
    startedAt: new Date('2026-06-01T10:00:00Z'),
    endedAt: new Date('2026-06-01T11:00:00Z'),
    ...overrides,
  });
  await db.insert(schema.workoutExercises).values({
    id: `${id}-we1`,
    workoutId: id,
    exerciseId,
    position: 1,
  });
  if (setValues.length > 0) {
    await db.insert(schema.sets).values(
      setValues.map((v, i) => ({
        id: `${id}-s${i + 1}`,
        workoutExerciseId: `${id}-we1`,
        position: i + 1,
        ...v,
      })),
    );
  }
}

export async function seedTemplate(
  id: string,
  userId: string,
  name: string,
  exerciseIds: string[],
) {
  const db = getDb(env.DB);
  await db.insert(schema.templates).values({ id, userId, name });
  if (exerciseIds.length > 0) {
    await db.insert(schema.templateExercises).values(
      exerciseIds.map((exerciseId, i) => ({
        id: `${id}-te${i + 1}`,
        templateId: id,
        exerciseId,
        position: i + 1,
      })),
    );
  }
}
