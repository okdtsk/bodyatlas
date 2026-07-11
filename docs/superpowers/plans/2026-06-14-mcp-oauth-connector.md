# MCP OAuth Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `/mcp` server into an OAuth 2.1 connector so bodyatlas can be added natively inside the Claude and ChatGPT apps, replacing the static `ba_` bearer-token path entirely.

**Architecture:** `@cloudflare/workers-oauth-provider` becomes the Worker entrypoint. It auto-serves OAuth discovery metadata, Dynamic Client Registration (`/register`), `/token`, and PKCE, and validates access tokens on `/mcp` (injecting `ctx.props.userId` into the existing `McpAgent`). The one custom piece is a server-rendered `/authorize` consent page bridged to the existing Google sign-in session. The legacy token UI, `/api/tokens` route, and `api_tokens` table are removed.

**Tech Stack:** Cloudflare Workers, Hono, `agents` (`McpAgent`), `@modelcontextprotocol/sdk`, `@cloudflare/workers-oauth-provider`, Drizzle + D1, KV, Vitest (workers pool), React SPA.

**Spec:** `docs/superpowers/specs/2026-06-14-mcp-oauth-connector-design.md`

---

## File Structure

**Worker — create:**
- `worker/src/mcp/handler.ts` — rate-limited wrapper around `BodyAtlasMCP.serve('/mcp')`, used as the OAuth provider's `apiHandler`.
- `worker/src/auth/oauth-consent.ts` — Hono routes for `GET/POST /authorize` (consent UI + `completeAuthorization`).
- `worker/migrations/0009_drop_api_tokens.sql` — drops the `api_tokens` table.
- `worker/test/mcp-oauth.test.ts` — OAuth discovery, DCR, gate, and full PKCE-flow integration tests.
- `worker/test/oauth-return-to.test.ts` — Google `return_to` redirect tests.

**Worker — modify:**
- `worker/src/index.ts` — replace the default export with `OAuthProvider`; mount consent routes; remove the manual `/mcp` bearer dispatch and the `tokensRoutes` mount.
- `worker/src/auth/google.ts` — accept and honor a same-origin `return_to`.
- `worker/src/types.ts` — add `OAUTH_KV` and `OAUTH_PROVIDER` to `Bindings`.
- `worker/src/db/schema.ts` — remove the `apiTokens` table.
- `worker/wrangler.jsonc` — add `OAUTH_KV`, extend `run_worker_first`.
- `worker/vitest.config.ts` — no change needed (KV comes from wrangler.jsonc); verify.

**Worker — delete:**
- `worker/src/routes/tokens.ts`
- `worker/src/auth/tokens.ts`
- `worker/test/tokens.test.ts`
- `worker/test/mcp-gate.test.ts` (replaced by `mcp-oauth.test.ts`)

**App — modify:**
- `app/src/pages/SettingsPage.tsx` — remove the API-tokens section/handlers/state; add a "Connect to Claude / ChatGPT" help block.
- `app/src/i18n/en.ts`, `app/src/i18n/ja.ts` — drop token keys; add connector keys.

**App — delete:**
- `app/src/lib/tokens.ts`
- `app/src/TokensSettings.test.tsx`

**Docs — modify:**
- `docs/mcp-setup.md` — rewrite for the OAuth connector flow.
- `CLAUDE.md` — update the Phase 2a status line.

---

## Task 1: Dependency, bindings, and wrangler config

**Files:**
- Modify: `worker/package.json`
- Modify: `worker/src/types.ts`
- Modify: `worker/wrangler.jsonc`

- [ ] **Step 1: Add the dependency**

Run:
```bash
npm install @cloudflare/workers-oauth-provider -w worker
```
Expected: `worker/package.json` gains `@cloudflare/workers-oauth-provider` under `dependencies`.

- [ ] **Step 2: Add bindings to `wrangler.jsonc`**

In `worker/wrangler.jsonc`, extend `assets.run_worker_first` and add the `OAUTH_KV` namespace. Replace the `kv_namespaces` array and the `assets` block:

```jsonc
  "assets": {
    "directory": "./public-stub",
    "not_found_handling": "single-page-application",
    "run_worker_first": [
      "/api/*",
      "/auth/*",
      "/mcp",
      "/mcp/*",
      "/authorize",
      "/token",
      "/register",
      "/.well-known/oauth-authorization-server",
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/*",
      "/robots.txt"
    ]
  },
```

```jsonc
  "kv_namespaces": [
    { "binding": "SESSIONS", "id": "e25c68f7159e4ebaa11c04c3df74721f" },
    { "binding": "OAUTH_KV", "id": "PLACEHOLDER_CREATE_BEFORE_DEPLOY" }
  ],
```

> Note for deploy (not needed for tests — miniflare keys KV by binding name): run
> `npx wrangler kv namespace create OAUTH_KV` and paste the returned id over `PLACEHOLDER_CREATE_BEFORE_DEPLOY`.

- [ ] **Step 3: Add binding types**

In `worker/src/types.ts`, add the import at the top and two fields to the `Bindings` interface:

```ts
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
```

Inside `interface Bindings { ... }` add:

```ts
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
```

- [ ] **Step 4: Verify the worker still typechecks**

Run: `npm run typecheck -w worker`
Expected: PASS (no usages yet; the new bindings are additive).

- [ ] **Step 5: Commit**

```bash
git add worker/package.json package-lock.json worker/wrangler.jsonc worker/src/types.ts
git commit -m "chore: add workers-oauth-provider dep, OAUTH_KV binding, run_worker_first paths

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Google `return_to` support

The OAuth consent flow bounces unauthenticated users through Google sign-in and must return them to `/authorize`. Add a same-origin-validated `return_to`.

**Files:**
- Modify: `worker/src/auth/google.ts`
- Test: `worker/test/oauth-return-to.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `worker/test/oauth-return-to.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w worker -- oauth-return-to`
Expected: FAIL (returnTo not stored / callback ignores it).

- [ ] **Step 3: Implement `return_to` in `google.ts`**

In `worker/src/auth/google.ts`, add a same-origin validator near the other helpers:

```ts
/** Accepts only same-origin absolute paths (e.g. "/authorize?..."), rejecting
 *  protocol-relative ("//evil") and absolute URLs to other origins. */
function safeReturnTo(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  return value;
}
```

In the `.get('/google')` handler, after `const native = ...`, read and store it:

```ts
    const returnTo = safeReturnTo(c.req.query('return_to'));

    setCookie(
      c,
      OAUTH_COOKIE,
      JSON.stringify({
        state,
        verifier,
        ...(native ? { native: true } : {}),
        ...(returnTo ? { returnTo } : {}),
      }),
      {
        httpOnly: true,
        secure: isHttps(c.req.url),
        sameSite: 'Lax',
        path: '/auth',
        maxAge: 600,
      },
    );
```

Update the `stored` type in `.get('/google/callback')`:

```ts
    let stored: { state: string; verifier: string; native?: boolean; returnTo?: string };
    try {
      stored = JSON.parse(raw) as {
        state: string;
        verifier: string;
        native?: boolean;
        returnTo?: string;
      };
    } catch {
      return c.json(badRequest('Malformed OAuth cookie'), 400);
    }
```

In the same handler, replace the final web (non-native) redirect block so it honors `returnTo`:

```ts
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c.req.url),
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    const dest = safeReturnTo(stored.returnTo) ?? '/';
    return c.redirect(new URL(dest, c.req.url).toString());
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w worker -- oauth-return-to`
Expected: PASS. Also run `npm run test -w worker -- auth` — existing auth tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/auth/google.ts worker/test/oauth-return-to.test.ts
git commit -m "feat: honor same-origin return_to in Google sign-in flow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Rate-limited MCP apiHandler wrapper

**Files:**
- Create: `worker/src/mcp/handler.ts`

- [ ] **Step 1: Write the wrapper**

Create `worker/src/mcp/handler.ts`:

```ts
import { BodyAtlasMCP } from './server';
import type { Bindings } from '../types';

const base = BodyAtlasMCP.serve('/mcp', { binding: 'BODYATLAS_MCP' });

/**
 * apiHandler for the OAuth provider. The provider validates the access token and
 * sets `ctx.props` (our McpProps) BEFORE calling this handler, so we can rate-limit
 * per user. CORS preflights carry no token and mutate nothing — pass them straight
 * through so browser-based connectors work.
 */
export const mcpHandler = {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'OPTIONS') {
      const limiter = env.RL_MCP;
      if (limiter) {
        const props = (ctx as ExecutionContext & { props?: { userId?: string } }).props;
        const key = props?.userId ?? request.headers.get('Authorization') ?? 'anon';
        const { success } = await limiter.limit({ key });
        if (!success) {
          return Response.json(
            { error: { code: 'rate_limited', message: 'Too many requests.' } },
            { status: 429, headers: { 'Retry-After': '60' } },
          );
        }
      }
    }
    return base.fetch(request, env as unknown as Cloudflare.Env, ctx);
  },
};
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck -w worker`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add worker/src/mcp/handler.ts
git commit -m "feat: rate-limited MCP apiHandler wrapper for OAuth provider

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `/authorize` consent handler

**Files:**
- Create: `worker/src/auth/oauth-consent.ts`

This task only creates the module; it is wired into the provider in Task 5 (tested end-to-end there).

- [ ] **Step 1: Write the consent module**

Create `worker/src/auth/oauth-consent.ts`:

```ts
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { SESSION_COOKIE } from './middleware';
import { getSessionUserId } from './session';
import type { AppEnv } from '../types';

const CONSENT_TTL_SECONDS = 600;

type ParsedAuthReq = {
  clientId: string;
  redirectUri: string;
  scope: string[];
  state?: string;
};

const b64urlEncode = (s: string) =>
  btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const b64urlDecode = (s: string) =>
  atob(s.replaceAll('-', '+').replaceAll('_', '/'));

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

function consentHtml(opts: {
  clientName: string;
  reqB64: string;
  csrf: string;
  locale: string;
}): string {
  const ja = opts.locale === 'ja';
  const title = ja ? 'アクセスを許可' : 'Authorize access';
  const body = ja
    ? `<strong>${escapeHtml(opts.clientName)}</strong> が bodyatlas のデータ（食事・ワークアウト・体重・睡眠の記録と参照）へのアクセスを求めています。`
    : `<strong>${escapeHtml(opts.clientName)}</strong> wants to access your bodyatlas data: log meals, workouts, weight, and sleep, and read your recent workouts and trends.`;
  const approve = ja ? '許可する' : 'Approve';
  const deny = ja ? '拒否' : 'Deny';
  return `<!doctype html><html lang="${ja ? 'ja' : 'en'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · bodyatlas</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#e7e9ee;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
  .card{max-width:420px;width:100%;background:#171a21;border:1px solid #262b36;
    border-radius:14px;padding:28px}
  h1{font-size:1.15rem;margin:0 0 16px} p{line-height:1.55;color:#c4c8d2}
  .row{display:flex;gap:12px;margin-top:24px}
  button{flex:1;padding:12px;border-radius:10px;border:1px solid #2c3340;font-size:1rem;cursor:pointer}
  .approve{background:#3b82f6;border-color:#3b82f6;color:#fff} .deny{background:transparent;color:#e7e9ee}
</style></head><body><div class="card">
<h1>${title}</h1><p>${body}</p>
<form method="post" action="/authorize">
  <input type="hidden" name="req" value="${opts.reqB64}">
  <input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}">
  <div class="row">
    <button class="deny" name="decision" value="deny" type="submit">${deny}</button>
    <button class="approve" name="decision" value="approve" type="submit">${approve}</button>
  </div>
</form></div></body></html>`;
}

export const oauthConsentRoutes = new Hono<AppEnv>()
  .get('/authorize', async (c) => {
    const oauthReq = (await c.env.OAUTH_PROVIDER.parseAuthRequest(
      c.req.raw,
    )) as ParsedAuthReq;

    const token = getCookie(c, SESSION_COOKIE);
    const userId = token ? await getSessionUserId(c.env.SESSIONS, token) : null;
    if (!userId) {
      const returnTo = '/authorize' + new URL(c.req.url).search;
      return c.redirect(`/auth/google?return_to=${encodeURIComponent(returnTo)}`);
    }

    const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
    const clientName =
      (client as { client_name?: string } | null)?.client_name ?? oauthReq.clientId;

    const csrf = crypto.randomUUID();
    await c.env.SESSIONS.put(`consent:${csrf}`, userId, {
      expirationTtl: CONSENT_TTL_SECONDS,
    });

    const user = await getDb(c.env.DB).query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    const reqB64 = b64urlEncode(JSON.stringify(oauthReq));
    return c.html(
      consentHtml({ clientName, reqB64, csrf, locale: user?.locale ?? 'en' }),
    );
  })
  .post('/authorize', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const userId = token ? await getSessionUserId(c.env.SESSIONS, token) : null;
    if (!userId) return c.text('Sign in required', 401);

    const form = await c.req.parseBody();
    const csrf = typeof form.csrf === 'string' ? form.csrf : '';
    const reqRaw = typeof form.req === 'string' ? form.req : '';
    const decision = typeof form.decision === 'string' ? form.decision : 'deny';

    // One-time CSRF token bound to this user.
    const csrfUser = csrf ? await c.env.SESSIONS.get(`consent:${csrf}`) : null;
    if (!csrfUser || csrfUser !== userId) return c.text('Invalid request', 403);
    await c.env.SESSIONS.delete(`consent:${csrf}`);

    let oauthReq: ParsedAuthReq;
    try {
      oauthReq = JSON.parse(b64urlDecode(reqRaw)) as ParsedAuthReq;
    } catch {
      return c.text('Invalid request', 400);
    }

    if (decision !== 'approve') {
      const url = new URL(oauthReq.redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (oauthReq.state) url.searchParams.set('state', oauthReq.state);
      return c.redirect(url.toString());
    }

    const scope = oauthReq.scope?.length ? oauthReq.scope : ['mcp'];
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId,
      scope,
      metadata: {},
      props: { userId },
    });
    return c.redirect(redirectTo);
  });
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck -w worker`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add worker/src/auth/oauth-consent.ts
git commit -m "feat: server-rendered /authorize consent handler

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Wire the OAuth provider as the Worker entrypoint

Replace the default export and remove the manual `/mcp` bearer dispatch. Keep the `tokensRoutes` mount for now (removed in Task 7) so the app's `AppType` stays stable until the app is updated in Task 6.

**Files:**
- Modify: `worker/src/index.ts`
- Create: `worker/test/mcp-oauth.test.ts`
- Delete: `worker/test/mcp-gate.test.ts`

- [ ] **Step 1: Write the failing integration tests**

Create `worker/test/mcp-oauth.test.ts`:

```ts
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
    const res = await SELF.fetch(
      'https://example.com/.well-known/oauth-authorization-server',
    );
    expect(res.status).toBe(200);
    const meta = (await res.json()) as Record<string, unknown>;
    expect(meta.authorization_endpoint).toContain('/authorize');
    expect(meta.token_endpoint).toContain('/token');
    expect(meta.registration_endpoint).toContain('/register');
    expect(meta.code_challenge_methods_supported).toContain('S256');
  });

  it('serves protected-resource metadata', async () => {
    const res = await SELF.fetch(
      'https://example.com/.well-known/oauth-protected-resource',
    );
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
      headers: {
        Origin: 'https://claude.ai',
        'Access-Control-Request-Method': 'POST',
      },
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

    // 1. GET /authorize (authenticated) → consent HTML with hidden fields.
    const authUrl =
      `https://example.com/authorize?response_type=code&client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=mcp&state=st123&code_challenge=${challenge}&code_challenge_method=S256`;
    const consent = await SELF.fetch(authUrl, { headers: { Cookie: cookie } });
    expect(consent.status).toBe(200);
    const html = await consent.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1]!;

    // 2. POST /authorize approve → 302 to client redirect with ?code=.
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

    // 3. POST /token → access_token.
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

    // 4. /mcp with the access token → gate passes (not 401).
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
```

Delete the old gate test:
```bash
git rm worker/test/mcp-gate.test.ts
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w worker -- mcp-oauth`
Expected: FAIL (no OAuth provider wired yet; discovery 404, /mcp not 401-gated by provider).

- [ ] **Step 3: Rewrite the default export in `index.ts`**

In `worker/src/index.ts`:

Replace the imports block additions — remove the bearer/MCP-dispatch imports and add the provider + new modules. Delete these lines:
```ts
import { BodyAtlasMCP } from './mcp/server';
import { verifyToken } from './auth/tokens';
```
Add:
```ts
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { BodyAtlasMCP } from './mcp/server';
import { mcpHandler } from './mcp/handler';
import { oauthConsentRoutes } from './auth/oauth-consent';
```
Keep `export { BodyAtlasMCP };`.

Mount the consent routes on `app` (add after `app.route('/auth', testLoginRoutes);`):
```ts
app.route('/', oauthConsentRoutes);
```

Replace the entire `default export` block (the manual `fetch` with the `/mcp` dispatch) and the `const mcpHandler = BodyAtlasMCP.serve(...)` line with:

```ts
export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: mcpHandler,
  // Hono app handles the SPA, /api, /auth, and the /authorize consent UI.
  defaultHandler: app,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['mcp'],
});
```

> The provider injects `env.OAUTH_PROVIDER` before delegating to `defaultHandler`/`apiHandler`, validates the access token on `/mcp` (setting `ctx.props`), and auto-serves the discovery metadata, `/token`, and `/register`.

- [ ] **Step 4: Run to verify pass**

Run: `npm run test -w worker -- mcp-oauth`
Expected: PASS (all describe blocks green).

> If the full-flow `/token` step returns a non-200, inspect the provider's expected token-request fields (OAuth 2.1 authorization_code + PKCE for a public client) and adjust the test body; the structure above matches the standard contract. If the OPTIONS preflight returns 401, confirm the provider's CORS handling for `apiRoute` — the wrapper already passes OPTIONS through.

- [ ] **Step 5: Run the full worker suite**

Run: `npm run test -w worker`
Expected: PASS except `tokens.test.ts` (still references the soon-removed route — it is deleted in Task 7) — note any failures there and proceed; they are addressed in Task 7. All other suites must pass.

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/test/mcp-oauth.test.ts
git rm worker/test/mcp-gate.test.ts
git commit -m "feat: wire OAuth 2.1 provider as the MCP connector entrypoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: App — remove token UI, add connector help block

Done before the worker route removal so the app stops referencing `api.tokens` while `AppType` still has it (keeps both workspaces green).

**Files:**
- Modify: `app/src/pages/SettingsPage.tsx`
- Modify: `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Delete: `app/src/lib/tokens.ts`, `app/src/TokensSettings.test.tsx`

- [ ] **Step 1: Replace `TokensSettings.test.tsx` with a connector-block test**

Replace the body of `app/src/TokensSettings.test.tsx` with a focused test (rename mentally; keep the filename or `git mv` to `ConnectorSettings.test.tsx`). Use `git mv`:
```bash
git mv app/src/TokensSettings.test.tsx app/src/ConnectorSettings.test.tsx
```
Then set its contents to:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SettingsPage } from './pages/SettingsPage';
import { I18nProvider } from './i18n';

vi.mock('./lib/api', () => ({
  api: {},
  expectOk: vi.fn(async () => ({})),
}));

vi.mock('./lib/me', () => ({
  useMe: () => ({
    data: {
      id: 'u1', email: 'a@example.com', name: 'Alice', locale: 'en',
      theme: 'gym-dark', unit: 'kg', timezone: 'Asia/Tokyo',
      targetKcal: null, targetProteinG: null, targetFatG: null, targetCarbsG: null,
    },
  }),
  useUpdateMe: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('./lib/ai', () => ({
  useAiSettings: () => ({ data: { provider: null, hasKey: false } }),
  useSaveAiSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTestAi: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAiSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderSettings() {
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsPage connector block', () => {
  it('shows the Claude/ChatGPT connector URL and no token UI', () => {
    renderSettings();
    expect(screen.getByText(/connect to claude/i)).toBeInTheDocument();
    expect(screen.getByText('https://bodyatlas.okdtsk.dev/mcp')).toBeInTheDocument();
    expect(screen.queryByText(/api tokens/i)).not.toBeInTheDocument();
  });
});
```

> Adjust the `vi.mock` paths/hook names to match the real imports in `SettingsPage.tsx` (verify `useMe`, `useAiSettings`, etc. before running). The point of the test: the connector block renders and the token UI is gone.

- [ ] **Step 2: Run to verify failure**

Run: `npm run test -w app -- ConnectorSettings`
Expected: FAIL (token UI still present / connector block missing).

- [ ] **Step 3: Delete the tokens hook module**

```bash
git rm app/src/lib/tokens.ts
```

- [ ] **Step 4: Strip tokens from `SettingsPage.tsx`**

Remove:
- The import: `import { useCreateToken, useRevokeToken, useTokens, type CreatedToken } from '../lib/tokens';`
- The hook calls and state (lines ~39–44): `useTokens()`, `useCreateToken()`, `useRevokeToken()`, `newTokenName`, `createdToken`.
- The handlers `handleCreateToken`, `handleCopyToken`, `handleRevokeToken` (lines ~258–283).
- The entire `<section>` API-tokens block (the `{t('settings.tokens')}` section, lines ~356–465, ending at its `</section>`).

Replace that removed section with a connector help block:

```tsx
      <section style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{t('settings.connect')}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: 8, lineHeight: 1.5 }}>
          {t('settings.connectHint')}
        </p>
        <code
          style={{
            display: 'block',
            wordBreak: 'break-all',
            padding: 8,
            background: 'var(--surface-2)',
            borderRadius: 'var(--radius)',
          }}
        >
          https://bodyatlas.okdtsk.dev/mcp
        </code>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: 8 }}>
          {t('settings.connectDocs')}
        </p>
      </section>
```

- [ ] **Step 5: Update i18n**

In `app/src/i18n/en.ts`, remove the keys `settings.tokens`, `settings.tokenName`, `settings.createToken`, `settings.tokenCreated`, `settings.revoke`, `settings.lastUsed`, `settings.neverUsed`, `settings.mcpHint`. Add:

```ts
  'settings.connect': 'Connect to Claude / ChatGPT',
  'settings.connectHint':
    'Add bodyatlas as a custom connector in Claude (Settings → Connectors) or ChatGPT (Settings → Connectors, developer mode) using this URL. You will be asked to sign in and approve access.',
  'settings.connectDocs': 'See docs/mcp-setup.md for step-by-step instructions.',
```

In `app/src/i18n/ja.ts`, remove the same keys and add:

```ts
  'settings.connect': 'Claude / ChatGPT と連携',
  'settings.connectHint':
    'このURLを使って、Claude（設定 → コネクタ）または ChatGPT（設定 → コネクタ、開発者モード）にカスタムコネクタとして bodyatlas を追加します。サインインとアクセス許可を求められます。',
  'settings.connectDocs': '手順は docs/mcp-setup.md を参照してください。',
```

- [ ] **Step 6: Run to verify pass + full app suite**

Run: `npm run test -w app -- ConnectorSettings`
Expected: PASS.
Run: `npm run test -w app && npm run typecheck -w app`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/SettingsPage.tsx app/src/i18n/en.ts app/src/i18n/ja.ts app/src/ConnectorSettings.test.tsx
git rm app/src/lib/tokens.ts
git commit -m "feat: replace API-token settings with Claude/ChatGPT connector help

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Remove the static-token backend

**Files:**
- Modify: `worker/src/index.ts`
- Modify: `worker/src/db/schema.ts`
- Create: `worker/migrations/0009_drop_api_tokens.sql`
- Delete: `worker/src/routes/tokens.ts`, `worker/src/auth/tokens.ts`, `worker/test/tokens.test.ts`

- [ ] **Step 1: Delete the route, token lib, and its test**

```bash
git rm worker/src/routes/tokens.ts worker/src/auth/tokens.ts worker/test/tokens.test.ts
```

- [ ] **Step 2: Unmount the route in `index.ts`**

Remove the import `import { tokensRoutes } from './routes/tokens';` and the line `.route('/tokens', tokensRoutes)` from the `apiApp` chain.

- [ ] **Step 3: Remove the schema table**

In `worker/src/db/schema.ts`, delete the entire `export const apiTokens = sqliteTable('api_tokens', { ... });` block (lines ~192–207) and the now-unused `index` import only if no other table uses it (grep first: `grep -n "index(" worker/src/db/schema.ts`).

- [ ] **Step 4: Add the drop migration**

Create `worker/migrations/0009_drop_api_tokens.sql`:

```sql
-- OAuth 2.1 connector replaces static bearer tokens; the table is no longer used.
DROP TABLE IF EXISTS api_tokens;
```

- [ ] **Step 5: Run the full worker suite + typecheck**

Run: `npm run test -w worker && npm run typecheck -w worker`
Expected: PASS — `mcp-oauth.test.ts`, `oauth-return-to.test.ts`, and all existing suites green; no references to the deleted `tokens` symbols remain.

- [ ] **Step 6: Run the whole repo**

Run: `npm test && npm run typecheck`
Expected: PASS across both workspaces.

- [ ] **Step 7: Commit**

```bash
git add worker/src/index.ts worker/src/db/schema.ts worker/migrations/0009_drop_api_tokens.sql
git rm worker/src/routes/tokens.ts worker/src/auth/tokens.ts worker/test/tokens.test.ts
git commit -m "feat: remove static MCP bearer tokens (OAuth-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Docs

**Files:**
- Modify: `docs/mcp-setup.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Rewrite `docs/mcp-setup.md`**

Replace the token-paste instructions with the OAuth connector walkthrough. Cover:

```markdown
# MCP Connector Setup

bodyatlas is a remote MCP server with OAuth 2.1. Add it as a connector and sign in
with your existing bodyatlas (Google) account — no API token to copy.

**Endpoint:** `https://bodyatlas.okdtsk.dev/mcp`

## Claude (web & desktop)
1. Settings → Connectors → **Add custom connector**.
2. Name it "bodyatlas", URL `https://bodyatlas.okdtsk.dev/mcp`.
3. Click connect → a bodyatlas page opens → sign in with Google if needed →
   **Approve**. Claude can now call the tools.

## ChatGPT
1. Enable **Developer mode / Connectors** (Settings → Connectors).
2. Add an MCP server with URL `https://bodyatlas.okdtsk.dev/mcp`.
3. Complete the OAuth sign-in + approval.
   Note: ChatGPT *deep-research* connectors expect `search`/`fetch` tools; bodyatlas
   exposes action tools (log_*, get_*) for the general/developer connector path.

## Gemini
The Gemini consumer app does not support custom MCP connectors yet. Use the **Gemini
CLI**: `gemini mcp add bodyatlas https://bodyatlas.okdtsk.dev/mcp` (the CLI runs the
same OAuth flow).

## Tools
log_meal, log_workout, log_weight, log_sleep, get_recent_workouts, get_trends, get_today.

## Revoking access
Re-authorizing replaces the prior grant. (A grant-management UI is future work.)
```

- [ ] **Step 2: Update `CLAUDE.md` Phase 2a line**

Change the MCP server status line to reflect OAuth: replace the "per-user `ba_` bearer tokens (hash-only storage, managed in Settings)" phrasing with: "OAuth 2.1 connector (DCR + PKCE via `@cloudflare/workers-oauth-provider`, bridged to Google sign-in; consent at `/authorize`, tokens in `OAUTH_KV`) — add as a custom connector in the Claude/ChatGPT apps. Static `ba_` tokens removed."

- [ ] **Step 3: Commit**

```bash
git add docs/mcp-setup.md CLAUDE.md
git commit -m "docs: MCP OAuth connector setup for Claude, ChatGPT, Gemini CLI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification

- [ ] **Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS across `worker` and `app`.

- [ ] **Manual smoke (optional, requires deploy)**

After `npx wrangler kv namespace create OAUTH_KV` + pasting the id and `npm run deploy`:
add `https://bodyatlas.okdtsk.dev/mcp` as a custom connector in Claude, complete the
Google sign-in + consent, and confirm a tool call (e.g. `get_today`) returns data.

---

## Notes for the implementer

- **Props type:** `McpProps = { userId: string }` is unchanged; the provider delivers
  `props: { userId }` from `completeAuthorization` to `ctx.props`, which `McpAgent`
  exposes as `this.props`. `mcp/server.ts` and `mcp/tools.ts` need no changes.
- **CSRF:** the consent POST is protected by a one-time token stored in `SESSIONS`
  (`consent:<uuid>`) bound to the user, plus the `SameSite=Lax` session cookie.
- **Discovery paths:** if a client requests `/.well-known/oauth-protected-resource/mcp`
  (resource-suffixed form), it is covered by the `run_worker_first` wildcard and the
  provider answers it.
- **Token-request shape (Task 5 full-flow test):** standard OAuth 2.1 public-client
  authorization_code + PKCE. If the provider expects different field names, the red
  test will show it — adjust the test body, not the production wiring.
```
