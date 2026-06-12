// NOTE: fetchMock is NOT exported from cloudflare:test in @cloudflare/vitest-pool-workers@0.16.13.
// The plan assumed an older API. We use vi.spyOn(globalThis, 'fetch') instead,
// which works because tests run in the same isolate as the Worker under this pool.
import { env, SELF } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb, schema } from '../src/db';
import { fakeIdToken } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /auth/google', () => {
  it('redirects to Google with PKCE params and sets the oauth cookie', async () => {
    const res = await SELF.fetch('https://example.com/auth/google', {
      redirect: 'manual',
    });
    expect(res.status).toBe(302);

    const location = new URL(res.headers.get('Location')!);
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('test-client-id');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'https://example.com/auth/google/callback',
    );
    expect(res.headers.get('Set-Cookie')).toContain('ba_oauth=');
  });
});

describe('GET /auth/google/callback', () => {
  it('rejects a state mismatch', async () => {
    const cookie = `ba_oauth=${encodeURIComponent(
      JSON.stringify({ state: 'expected', verifier: 'v' }),
    )}`;
    const res = await SELF.fetch(
      'https://example.com/auth/google/callback?code=c&state=wrong',
      { headers: { Cookie: cookie } },
    );
    expect(res.status).toBe(400);
  });

  it('exchanges the code, upserts the user, and sets a session cookie', async () => {
    const idToken = fakeIdToken({
      sub: 'g-123',
      email: 'a@example.com',
      name: 'Alice',
    });

    // Each call to the mock must construct a fresh Response so the body stream
    // is created inside the Worker's request context, avoiding the Cloudflare
    // Workers cross-request I/O restriction.
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
      return new Response(JSON.stringify({ id_token: idToken }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const cookie = `ba_oauth=${encodeURIComponent(
      JSON.stringify({ state: 's1', verifier: 'v1' }),
    )}`;
    const res = await SELF.fetch(
      'https://example.com/auth/google/callback?code=c1&state=s1',
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/');
    expect(res.headers.get('Set-Cookie')).toContain('ba_session=');

    const db = getDb(env.DB);
    const user = await db.query.users.findFirst({
      where: eq(schema.users.googleSub, 'g-123'),
    });
    expect(user?.email).toBe('a@example.com');
  });
});
