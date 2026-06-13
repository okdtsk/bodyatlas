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

/** Mocks Google's token endpoint for the next fetch made by the Worker. */
function mockGoogleTokenEndpoint(idToken: string) {
  // Each call to the mock must construct a fresh Response so the body stream
  // is created inside the Worker's request context (see note at the top).
  vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => {
    return new Response(JSON.stringify({ id_token: idToken }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
}

/** Starts the native OAuth flow and returns the oauth cookie + state. */
async function startNativeFlow(): Promise<{ cookie: string; state: string }> {
  const res = await SELF.fetch('https://example.com/auth/google?native=1', {
    redirect: 'manual',
  });
  expect(res.status).toBe(302);
  const setCookie = res.headers.get('Set-Cookie')!;
  const match = /ba_oauth=([^;]+)/.exec(setCookie);
  expect(match).not.toBeNull();
  const cookieValue = match![1]!;
  const payload = JSON.parse(decodeURIComponent(cookieValue)) as {
    state: string;
    verifier: string;
    native?: boolean;
  };
  expect(payload.native).toBe(true);
  return { cookie: `ba_oauth=${cookieValue}`, state: payload.state };
}

/** Drives the full native callback and returns the one-time exchange code. */
async function driveNativeCallback(sub = 'g-native'): Promise<string> {
  const { cookie, state } = await startNativeFlow();
  mockGoogleTokenEndpoint(
    fakeIdToken({ sub, email: `${sub}@example.com`, name: 'Native User' }),
  );
  const res = await SELF.fetch(
    `https://example.com/auth/google/callback?code=c1&state=${state}`,
    { headers: { Cookie: cookie }, redirect: 'manual' },
  );
  expect(res.status).toBe(302);
  const location = res.headers.get('Location')!;
  expect(location.startsWith('com.okdtsk.bodyatlas://auth?code=')).toBe(true);
  return new URL(location).searchParams.get('code')!;
}

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

describe('native OAuth flow', () => {
  it('redirects the native callback to the app scheme with a one-time code and no session cookie', async () => {
    const { cookie, state } = await startNativeFlow();
    mockGoogleTokenEndpoint(
      fakeIdToken({ sub: 'g-native-1', email: 'n1@example.com', name: 'Nat' }),
    );

    const res = await SELF.fetch(
      `https://example.com/auth/google/callback?code=c1&state=${state}`,
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );

    expect(res.status).toBe(302);
    const location = res.headers.get('Location')!;
    expect(location.startsWith('com.okdtsk.bodyatlas://auth?code=')).toBe(true);
    expect(new URL(location).searchParams.get('code')).toBeTruthy();
    expect(res.headers.get('Set-Cookie') ?? '').not.toContain('ba_session=');
  });

  it('exchanges the one-time code for a session cookie that authenticates', async () => {
    const code = await driveNativeCallback('g-native-2');

    const res = await SELF.fetch('https://example.com/auth/native/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const setCookie = res.headers.get('Set-Cookie')!;
    expect(setCookie).toContain('ba_session=');
    const sessionCookie = /ba_session=[^;]+/.exec(setCookie)![0];

    const me = await SELF.fetch('https://example.com/api/me', {
      headers: { Cookie: sessionCookie },
    });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { email: string };
    expect(body.email).toBe('g-native-2@example.com');
  });

  it('rejects a code on second use (single-use)', async () => {
    const code = await driveNativeCallback('g-native-3');

    const first = await SELF.fetch('https://example.com/auth/native/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch('https://example.com/auth/native/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(second.status).toBe(400);
  });

  it('rejects an unknown code', async () => {
    const res = await SELF.fetch('https://example.com/auth/native/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: crypto.randomUUID() }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed body and a missing code', async () => {
    const notJson = await SELF.fetch('https://example.com/auth/native/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(notJson.status).toBe(400);

    const missingCode = await SELF.fetch('https://example.com/auth/native/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(missingCode.status).toBe(400);
  });
});
