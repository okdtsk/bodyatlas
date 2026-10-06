import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { authRoutes } from '../src/auth/google';
import type { AppEnv, Bindings } from '../src/types';
import { fakeIdToken } from './helpers';

afterEach(() => vi.restoreAllMocks());
it('does not create a user or native handoff for a Google account outside the allowlist', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => Response.json({ id_token: fakeIdToken({ sub: 'blocked-login', email: 'outside@example.com' }) }));
  const cookie = `ba_oauth=${encodeURIComponent(JSON.stringify({ state: 'expected', verifier: 'verifier', native: true }))}`;
  const app = new Hono<AppEnv>().route('/auth', authRoutes);
  const res = await app.request('https://example.com/auth/google/callback?code=private-code&state=expected', { headers: { Cookie: cookie } }, { ...env, ALLOWED_EMAILS: 'owner@example.com' } as Bindings);
  expect(res.status).toBe(403);
  expect(res.headers.get('Location')).toBeNull();
  expect(res.headers.get('Set-Cookie') ?? '').not.toContain('ba_session=');
  const result = await env.DB.prepare("SELECT COUNT(*) AS count FROM users WHERE google_sub='blocked-login'").first<{ count: number }>();
  expect(result?.count).toBe(0);
});
