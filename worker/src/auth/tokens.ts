import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';

const encoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return `ba_${b64}`;
}

const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

/** Returns the owning userId for a valid token, else null. Touches lastUsedAt (throttled). */
export async function verifyToken(d1: D1Database, token: string): Promise<string | null> {
  if (!token.startsWith('ba_')) return null;
  const db = getDb(d1);
  const hash = await sha256Hex(token);
  const row = await db.query.apiTokens.findFirst({ where: eq(schema.apiTokens.tokenHash, hash) });
  if (!row) return null;
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await db.update(schema.apiTokens).set({ lastUsedAt: new Date(now) }).where(eq(schema.apiTokens.id, row.id));
  }
  return row.userId;
}
