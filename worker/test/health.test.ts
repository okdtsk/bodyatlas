import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('unknown API route', () => {
  it('returns 401 without a session (auth is default-on for /api)', async () => {
    const res = await SELF.fetch('https://example.com/api/nope');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns the JSON 404 envelope when authenticated', async () => {
    await seedUser('user-1');
    const res = await SELF.fetch('https://example.com/api/nope', {
      headers: { Cookie: await sessionCookieFor('user-1') },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('not_found');
  });
});
