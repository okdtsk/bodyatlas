import { SELF } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeIdToken } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /auth/google?return_to', () => {
  it('stores a same-origin return_to in the oauth cookie', async () => {
    const res = await SELF.fetch(
      'https://example.com/auth/google?return_to=' +
        encodeURIComponent('/authorize?client_id=abc&state=xyz'),
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    const setCookie = res.headers.get('Set-Cookie')!;
    const value = /ba_oauth=([^;]+)/.exec(setCookie)![1]!;
    const payload = JSON.parse(decodeURIComponent(value)) as { returnTo?: string };
    expect(payload.returnTo).toBe('/authorize?client_id=abc&state=xyz');
  });

  it('ignores an off-origin return_to', async () => {
    const res = await SELF.fetch(
      'https://example.com/auth/google?return_to=' +
        encodeURIComponent('https://evil.example/steal'),
      { redirect: 'manual' },
    );
    const value = /ba_oauth=([^;]+)/.exec(res.headers.get('Set-Cookie')!)![1]!;
    const payload = JSON.parse(decodeURIComponent(value)) as { returnTo?: string };
    expect(payload.returnTo).toBeUndefined();
  });

  it('redirects the callback to a stored same-origin return_to', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () =>
      new Response(
        JSON.stringify({
          id_token: fakeIdToken({ sub: 'g-rt', email: 'rt@example.com', name: 'RT' }),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const cookie =
      'ba_oauth=' +
      encodeURIComponent(
        JSON.stringify({ state: 's1', verifier: 'v1', returnTo: '/authorize?x=1' }),
      );
    const res = await SELF.fetch(
      'https://example.com/auth/google/callback?code=c1&state=s1',
      { headers: { Cookie: cookie }, redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://example.com/authorize?x=1');
    expect(res.headers.get('Set-Cookie')).toContain('ba_session=');
  });
});
