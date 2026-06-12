import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { generateToken, sha256Hex, verifyToken } from '../src/auth/tokens';
import { getDb, schema } from '../src/db';
import { seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('verifyToken (unit)', () => {
  it('round-trip: verifyToken returns userId for a freshly generated token', async () => {
    await seedUser('user-vt');
    const db = getDb(env.DB);
    const token = generateToken();
    const hash = await sha256Hex(token);
    await db.insert(schema.apiTokens).values({
      id: 'tok-vt-1',
      userId: 'user-vt',
      name: 'test-token',
      tokenHash: hash,
    });
    const result = await verifyToken(env.DB, token);
    expect(result).toBe('user-vt');
  });

  it('returns null for garbage input', async () => {
    const result = await verifyToken(env.DB, 'garbage_not_a_token');
    expect(result).toBeNull();
  });

  it('returns null for a ba_ prefixed token not in DB', async () => {
    const result = await verifyToken(env.DB, generateToken());
    expect(result).toBeNull();
  });

  it('returns null for a revoked (deleted) token', async () => {
    await seedUser('user-rv');
    const db = getDb(env.DB);
    const token = generateToken();
    const hash = await sha256Hex(token);
    await db.insert(schema.apiTokens).values({
      id: 'tok-rv-1',
      userId: 'user-rv',
      name: 'revoked',
      tokenHash: hash,
    });
    // Delete the token (simulate revoke)
    await db.delete(schema.apiTokens).where(
      (await import('drizzle-orm').then((m) => m.eq))(schema.apiTokens.id, 'tok-rv-1'),
    );
    const result = await verifyToken(env.DB, token);
    expect(result).toBeNull();
  });
});

describe('GET /api/tokens', () => {
  it('returns list with id/name/createdAt/lastUsedAt but never token or hash', async () => {
    const headers = await authed();
    // Create a token first
    const createRes = await SELF.fetch(
      'https://example.com/api/tokens',
      json(headers, { name: 'My token' }),
    );
    expect(createRes.status).toBe(201);

    const listRes = await SELF.fetch('https://example.com/api/tokens', { headers });
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as Record<string, unknown>[];
    expect(list).toHaveLength(1);
    const item = list[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('name', 'My token');
    expect(item).toHaveProperty('createdAt');
    expect(item).toHaveProperty('lastUsedAt');
    // Must NOT expose token or hash
    expect(item).not.toHaveProperty('token');
    expect(item).not.toHaveProperty('tokenHash');
  });
});

describe('POST /api/tokens', () => {
  it('returns 201 with ba_-prefixed plaintext token exactly once, plus metadata', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/tokens',
      json(headers, { name: 'gym-bot' }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('id');
    expect(body).toHaveProperty('name', 'gym-bot');
    expect(body).toHaveProperty('createdAt');
    expect(typeof body.token).toBe('string');
    expect((body.token as string).startsWith('ba_')).toBe(true);
  });

  it('rejects empty name with 422', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/tokens',
      json(headers, { name: '' }),
    );
    expect(res.status).toBe(422);
  });

  it('rejects name longer than 60 chars with 422', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/tokens',
      json(headers, { name: 'a'.repeat(61) }),
    );
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/tokens/:id', () => {
  it('deletes own token and verifyToken subsequently returns null', async () => {
    const headers = await authed('user-del');
    const createRes = await SELF.fetch(
      'https://example.com/api/tokens',
      json(headers, { name: 'to-delete' }),
    );
    const created = (await createRes.json()) as { id: string; token: string };

    const delRes = await SELF.fetch(`https://example.com/api/tokens/${created.id}`, {
      method: 'DELETE',
      headers,
    });
    expect(delRes.status).toBe(200);

    // Token should now verify to null (revoked)
    const userId = await verifyToken(env.DB, created.token);
    expect(userId).toBeNull();
  });

  it("returns 404 when trying to delete another user's token", async () => {
    // user-2 creates a token
    const headers2 = await authed('user-owner');
    const createRes = await SELF.fetch(
      'https://example.com/api/tokens',
      json(headers2, { name: 'owner-token' }),
    );
    const created = (await createRes.json()) as { id: string };

    // user-3 tries to delete it
    await seedUser('user-thief');
    const headers3 = { Cookie: await sessionCookieFor('user-thief') };
    const delRes = await SELF.fetch(`https://example.com/api/tokens/${created.id}`, {
      method: 'DELETE',
      headers: headers3,
    });
    expect(delRes.status).toBe(404);
  });
});
