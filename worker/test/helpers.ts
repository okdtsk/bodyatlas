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
