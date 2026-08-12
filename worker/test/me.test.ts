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
    await seedUser('user-1', { theme: 'light' });
    const res = await SELF.fetch('https://example.com/api/me', {
      headers: { Cookie: await sessionCookieFor('user-1') },
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as Record<string, unknown>;
    expect(me).toMatchObject({
      id: 'user-1',
      email: 'user-1@example.com',
      theme: 'light',
      locale: 'en',
    });
    expect(me).not.toHaveProperty('googleSub');
    expect(me).not.toHaveProperty('createdAt');
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

  it('rejects an invalid IANA timezone with 422', async () => {
    await seedUser('user-1');
    const res = await SELF.fetch('https://example.com/api/me', {
      method: 'PATCH',
      headers: {
        Cookie: await sessionCookieFor('user-1'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ timezone: 'Not/A/Zone' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('validation');
  });

  it('clears a nutrition target by patching it to null', async () => {
    await seedUser('user-1', { targetKcal: 2000 });
    const res = await SELF.fetch('https://example.com/api/me', {
      method: 'PATCH',
      headers: {
        Cookie: await sessionCookieFor('user-1'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ targetKcal: null }),
    });
    expect(res.status).toBe(200);
    const me = (await res.json()) as { targetKcal: number | null };
    expect(me.targetKcal).toBeNull();
  });

  it('PATCH onboarded:true stamps onboardedAt server-side', async () => {
    await seedUser('user-ob');
    const before = await SELF.fetch('https://example.com/api/me', { headers: { Cookie: await sessionCookieFor('user-ob') } });
    expect((await before.json() as any).onboardedAt).toBeNull();

    const res = await SELF.fetch('https://example.com/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: await sessionCookieFor('user-ob') },
      body: JSON.stringify({ onboarded: true }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).onboardedAt).not.toBeNull();
  });

  it('PATCH rejects a client-supplied onboardedAt timestamp', async () => {
    await seedUser('user-ob2');
    const res = await SELF.fetch('https://example.com/api/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: await sessionCookieFor('user-ob2') },
      body: JSON.stringify({ onboardedAt: '2000-01-01T00:00:00Z' }),
    });
    // onboardedAt is not an accepted field; updateMeSchema strips unknown keys (zod default),
    // so this is a no-op patch that leaves onboardedAt null. Accept 200 with onboardedAt still null.
    expect(res.status).toBe(200);
    expect((await res.json() as any).onboardedAt).toBeNull();
  });
});
