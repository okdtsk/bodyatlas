import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { Bindings } from '../types';

/** Missing production configuration fails closed. Local tests opt into development. */
export function isAllowedEmail(env: Pick<Bindings, 'ALLOWED_EMAILS' | 'ENVIRONMENT'>, email: string): boolean {
  const allowed = (env.ALLOWED_EMAILS ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return env.ENVIRONMENT === 'development';
  return allowed.includes(email.trim().toLowerCase());
}

export async function isAllowedUser(env: Bindings, userId: string): Promise<boolean> {
  const user = await getDb(env.DB).query.users.findFirst({ where: eq(schema.users.id, userId) });
  return !!user && isAllowedEmail(env, user.email);
}
