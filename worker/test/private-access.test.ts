import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requireAuth } from '../src/auth/middleware';
import type { AppEnv, Bindings } from '../src/types';
import { seedUser, sessionCookieFor } from './helpers';

const app = new Hono<AppEnv>().use(requireAuth).get('/', c => c.json({ userId: c.get('userId') }));
describe('private access for existing sessions', () => {
  it('denies a valid session whose user is outside the configured allowlist', async () => {
    await seedUser('outside');
    const cookie = await sessionCookieFor('outside');
    const res = await app.request('https://example.com/', { headers: { Cookie: cookie } }, { ...env, ALLOWED_EMAILS: 'owner@example.com' } as Bindings);
    expect(res.status).toBe(403);
  });
  it('allows the owner without changing the session cookie protocol', async () => {
    await seedUser('owner');
    const cookie = await sessionCookieFor('owner');
    const res = await app.request('https://example.com/', { headers: { Cookie: cookie } }, { ...env, ALLOWED_EMAILS: 'owner@example.com' } as Bindings);
    expect(res.status).toBe(200);
  });
  it('denies authenticated users when the production allowlist is missing', async () => {
    await seedUser('owner');
    const res = await app.request('https://example.com/', { headers: { Cookie: await sessionCookieFor('owner') } }, { ...env, ENVIRONMENT: 'production', ALLOWED_EMAILS: undefined } as Bindings);
    expect(res.status).toBe(403);
  });
});
