import { SELF } from 'cloudflare:test';
import { hc } from 'hono/client';
import { describe, expect, it } from 'vitest';
import type { AppType } from '../src';
import { seedUser, sessionCookieFor } from './helpers';

// Type-level guard: AppType must expose the /me RPC surface for the app (Task 10).
// If the composition in src/index.ts ever erases the route schema (e.g. via a
// bare `as Hono<AppEnv>` cast), this stops compiling.
const _typecheckOnly = () => {
  const client = hc<AppType>('/api');
  void client.me.$get;
  void client.me.$patch;
};
void _typecheckOnly;

describe('/api/me', () => {
  it('returns 401 without a session', async () => {
    const res = await SELF.fetch('https://example.com/api/me');
    expect(res.status).toBe(401);
  });

  it('returns the signed-in user with preferences', async () => {
    await seedUser('user-1', { theme: 'warm-journal' });
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { Cookie: await sessionCookieFor('user-1') },
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as Record<string, unknown>;
    expect(me).toMatchObject({
      id: 'user-1',
      email: 'user-1@example.com',
      theme: 'warm-journal',
      locale: 'en',
    });
    expect(me).not.toHaveProperty('googleSub');
  });

  it('only ever returns the session user, not others', async () => {
    await seedUser('user-1');
    await seedUser('user-2');
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { Cookie: await sessionCookieFor('user-2') },
    });
    expect(((await res.json()) as { id: string }).id).toBe('user-2');
  });

  it('updates preferences via PATCH', async () => {
    await seedUser('user-1');
    const cookie = await sessionCookieFor('user-1');
    const res = await SELF.fetch('https://example.com/api/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'ja', targetKcal: 2400 }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ locale: 'ja', targetKcal: 2400 });
  });

  it('rejects invalid patches with 422 and details', async () => {
    await seedUser('user-1');
    const res = await SELF.fetch('https://example.com/api/me', {
      method: 'PATCH',
      headers: {
        Cookie: await sessionCookieFor('user-1'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ theme: 'neon' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: unknown } };
    expect(body.error.code).toBe('validation');
    expect(body.error.details).toBeTruthy();
  });
});
