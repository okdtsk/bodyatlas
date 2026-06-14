import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

async function registerClient(redirectUri: string): Promise<string> {
  const res = await SELF.fetch('https://example.com/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Test Connector',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }),
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { client_id: string };
  expect(body.client_id).toBeTruthy();
  return body.client_id;
}

describe('OAuth discovery', () => {
  it('serves authorization-server metadata', async () => {
    const res = await SELF.fetch('https://example.com/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.authorization_endpoint).toContain('/authorize');
    expect(meta.token_endpoint).toContain('/token');
    expect(meta.registration_endpoint).toContain('/register');
    expect(meta.code_challenge_methods_supported).toContain('S256');
  });

  it('serves protected-resource metadata', async () => {
    const res = await SELF.fetch('https://example.com/.well-known/oauth-protected-resource');
    expect(res.status).toBe(200);
  });
});

describe('MCP OAuth gate', () => {
  it('returns 401 with no token', async () => {
    const res = await SELF.fetch('https://example.com/mcp', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a garbage token', async () => {
    const res = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer garbage' },
    });
    expect(res.status).toBe(401);
  });

  it('lets an OPTIONS preflight through', async () => {
    const res = await SELF.fetch('https://example.com/mcp', {
      method: 'OPTIONS',
      headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST' },
    });
    expect(res.status).not.toBe(401);
  });
});

describe('DCR + authorize redirect', () => {
  it('registers a client via DCR', async () => {
    const id = await registerClient('https://client.example/cb');
    expect(id).toBeTruthy();
  });

  it('redirects an unauthenticated /authorize to Google sign-in', async () => {
    const clientId = await registerClient('https://client.example/cb');
    const res = await SELF.fetch(
      `https://example.com/authorize?response_type=code&client_id=${clientId}` +
        `&redirect_uri=${encodeURIComponent('https://client.example/cb')}` +
        `&scope=mcp&state=st&code_challenge=abc&code_challenge_method=S256`,
      { redirect: 'manual' },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')!).toContain('/auth/google?return_to=');
  });
});

describe('full PKCE flow → authenticated /mcp call', () => {
  it('completes consent, exchanges a code, and reaches the MCP transport', async () => {
    await seedUser('oauth-user-1');
    const cookie = await sessionCookieFor('oauth-user-1');
    const redirectUri = 'https://client.example/cb';
    const clientId = await registerClient(redirectUri);
    const { verifier, challenge } = await pkce();

    const authUrl =
      `https://example.com/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=mcp&state=st123&code_challenge=${challenge}&code_challenge_method=S256`;
    const consent = await SELF.fetch(authUrl, { headers: { Cookie: cookie } });
    expect(consent.status).toBe(200);
    const html = await consent.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;

    // The parsed request is stored server-side under the CSRF key; the form
    // carries only csrf + decision (no client-supplied request data).
    const form = new URLSearchParams({ csrf, decision: 'approve' });
    const approved = await SELF.fetch('https://example.com/authorize', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(approved.status).toBe(302);
    const code = new URL(approved.headers.get('Location')!).searchParams.get('code')!;
    expect(code).toBeTruthy();

    const tokenRes = await SELF.fetch('https://example.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
      }).toString(),
    });
    expect(tokenRes.status).toBe(200);
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    expect(access_token).toBeTruthy();

    const mcp = await SELF.fetch('https://example.com/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    });
    expect(mcp.status).not.toBe(401);
  });
});
