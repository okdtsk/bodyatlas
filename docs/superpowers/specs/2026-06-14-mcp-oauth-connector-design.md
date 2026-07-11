# MCP OAuth Connector — Design Spec

**Date:** 2026-06-14
**Status:** Approved
**Phase:** 2 (post-v1), extends Phase 2a (MCP server)

## Goal

Make bodyatlas installable as a **native connector inside the Claude and ChatGPT apps**
(the "Connectors" / "Custom MCP" feature), not via pasted API tokens. This means the
existing MCP server at `/mcp` must speak **OAuth 2.1**: discovery metadata, Dynamic
Client Registration (DCR), PKCE, an `/authorize` consent flow, and `/token` issuance —
so the apps can self-register and obtain access tokens automatically.

This is the *inbound* service-integration direction (AI apps call bodyatlas as a tool).
It is distinct from the already-shipped Phase 2b AI coach, which is the *outbound*
BYO-key direction (bodyatlas calls provider APIs) and is unaffected by this work.

## Decisions (locked)

- **OAuth-only**: the existing static `ba_` bearer-token path is removed entirely, not
  kept alongside OAuth. The Settings token-management UI, `/api/tokens` route, and the
  `apiTokens` table all go away.
- **Library**: use `@cloudflare/workers-oauth-provider` to turn the Worker into an
  OAuth 2.1 Authorization Server + Resource Server, paired with the existing
  `McpAgent` (`BodyAtlasMCP`).
- **Identity**: bridge the provider's `/authorize` step to the existing Google sign-in
  session. No Cloudflare Access / Zero Trust dependency.
- **Gemini**: best-effort. The Gemini consumer app cannot add custom MCP connectors;
  document Gemini CLI usage against the same OAuth endpoint. No Gemini-specific code.
- **Consent UI**: server-rendered HTML page at `/authorize` (loads outside the SPA),
  bilingual EN/JA off the user's stored locale.
- **`apiTokens` drop**: confirmed acceptable — tokens are revocable secrets; existing
  users reconnect via OAuth.

## Why not Cloudflare Access

Cloudflare Access is an identity-aware reverse proxy that authenticates end users in
front of an app. It is **not** an OAuth Authorization Server that arbitrary third-party
MCP clients can Dynamic-Client-Register against, and it does not advertise our `/mcp`
resource via the MCP discovery metadata the spec requires. The provider library is
mandatory for the connector to exist; Access could at most serve as an upstream IdP
swap, which we don't need since Google sign-in already works.

## Architecture

### Worker entrypoint

`worker/src/index.ts` currently default-exports a manual `fetch` that special-cases
`/mcp` (bearer verification) and otherwise delegates to the Hono `app`. Replace the
default export with the OAuth provider:

```ts
export default new OAuthProvider({
  apiHandlers: { '/mcp': mcpHandler },   // rate-limited wrapper over BodyAtlasMCP.serve('/mcp')
  defaultHandler: app,                    // Hono: SPA + /api + /auth + /authorize
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['mcp'],
});
```

Responsibilities:

- **Provider auto-serves**: `/token`, `/register`, and discovery metadata
  (`/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource` and `/.well-known/oauth-protected-resource/mcp`).
- **Provider routes `/authorize`** to `defaultHandler` (our Hono app).
- **Provider validates the access token on `/mcp`** and injects `ctx.props` into
  `McpAgent`. `BodyAtlasMCP.init()` already reads `this.props.userId`, so
  `mcp/server.ts` and `mcp/tools.ts` are unchanged.
- `BodyAtlasMCP` remains exported as the Durable Object class; the DO binding and
  migration in `wrangler.jsonc` are unchanged.

### `/authorize` consent flow (the only custom code we own)

A Hono handler mounted on the `app` at `/authorize`:

1. Parse the inbound OAuth request via `c.env.OAUTH_PROVIDER.parseAuthRequest(request)`
   → `{ clientId, redirectUri, scope, state, codeChallenge, codeChallengeMethod, ... }`.
2. Resolve the bodyatlas session from `SESSION_COOKIE`:
   - **No valid session** → 302 to `/auth/google?return_to=<full /authorize URL>`.
   - **Valid session** → render the consent page (GET) showing the client name from
     `c.env.OAUTH_PROVIDER.lookupClient(clientId)` and the scope description.
3. On **Approve** (POST, same-origin, session-gated, CSRF-token-protected): call
   `c.env.OAUTH_PROVIDER.completeAuthorization({ request: parsedReq, userId, scope,
   props: { userId }, metadata: {} })` → redirect the browser to the returned client
   callback URL with the authorization code.
4. On **Deny** → redirect to the client `redirect_uri` with `error=access_denied`.

The parsed auth request is carried across the GET→POST as a signed/serialized hidden
form field (exact serialization per the library's helper); user identity comes from the
session cookie, never from the form.

### Google sign-in `return_to` addition

`worker/src/auth/google.ts` currently always redirects to `/` after callback. Add:

- `/auth/google` accepts an optional `return_to` query param, stored in the existing
  `ba_oauth` cookie alongside `state`/`verifier`.
- `/auth/google/callback` redirects to `return_to` when present, **only if** it passes
  same-origin path validation (must be a path on the bodyatlas host; reject absolute
  URLs to other origins — open-redirect guard). Otherwise fall back to `/`.
- The native (`native: true`) branch is unaffected.

### Rate limiting

Preserve `RL_MCP` by wrapping the `/mcp` apiHandler: before delegating to
`BodyAtlasMCP.serve('/mcp').fetch`, apply the limiter keyed by the bearer token (or the
resolved `userId` once the provider has validated it). Return 429 with `Retry-After: 60`
on limit, matching today's behavior.

## Removals (OAuth-only)

- **`worker/src/routes/tokens.ts`** — delete; remove `.route('/tokens', tokensRoutes)`
  and the import from `index.ts`.
- **`worker/src/auth/tokens.ts`** — remove `generateToken`, `verifyToken`. Remove
  `sha256Hex` only if no other caller remains (verify with grep; keep if shared).
- **Manual `/mcp` dispatch** in `index.ts` — removed (replaced by the provider).
- **DB migration** — new migration dropping the `apiTokens` table. ⚠️ Destructive;
  approved above.
- **App** — delete `app/src/lib/tokens.ts`, the `TokensSettings` component and
  `app/src/TokensSettings.test.tsx`; remove its mount in `app/src/pages/SettingsPage.tsx`;
  remove token i18n keys from `i18n/en.ts` and `i18n/ja.ts`. Replace with a small
  **"Connect to Claude / ChatGPT"** help block (connector URL + link to setup doc).
- **`worker/test/mcp-gate.test.ts`** — rewrite for the OAuth gate (see Testing).
  `worker/test/mcp-tools.test.ts` is unchanged (it drives `registerTools` directly).

## Config / bindings / deps

- **Dependency**: add `@cloudflare/workers-oauth-provider` to `worker/package.json`.
- **KV namespace**: new `OAUTH_KV` binding (provider stores clients, grants, tokens),
  separate from `SESSIONS`. Create via wrangler; add to `wrangler.jsonc`.
- **`wrangler.jsonc` `assets.run_worker_first`**: add `/authorize`, `/token`,
  `/register`, `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource*` so the SPA asset layer does not swallow them.
- **`worker/src/types.ts` `Bindings`**: add `OAUTH_KV: KVNamespace` and the provider's
  injected `OAUTH_PROVIDER` helper type.

## Client compatibility

- **Claude (web + desktop)**: Settings → Connectors → Add custom connector →
  `https://bodyatlas.okdtsk.dev/mcp`. OAuth flow runs. Primary target.
- **ChatGPT**: Settings → Connectors (developer mode) → add the same URL. Caveat:
  ChatGPT *deep-research* connectors expect `search`/`fetch` tools; our action tools
  work in the general/developer connector path. Documented, no code change.
- **Gemini**: consumer app cannot add custom MCP connectors. Document Gemini CLI
  (`gemini mcp add`) against the same OAuth endpoint. No code.

## Testing (vitest, workers pool)

End-to-end OAuth dance plus gates, replacing `mcp-gate.test.ts`:

1. **Discovery**: `GET /.well-known/oauth-protected-resource` and
   `/.well-known/oauth-authorization-server` return 200 with correct `resource`,
   `authorization_servers`, `registration_endpoint`, `authorization_endpoint`,
   `token_endpoint`, and `code_challenge_methods_supported: ["S256"]`.
2. **DCR**: `POST /register` → 201 with a `client_id`.
3. **Unauthorized `/mcp`**: no token → 401 with a `WWW-Authenticate` header pointing at
   the protected-resource metadata.
4. **`/authorize` unauthenticated** → 302 to `/auth/google?return_to=…`.
5. **`/authorize` authenticated** (mocked session cookie) → consent page renders;
   **Approve** POST → 302 to the client `redirect_uri` with a `code`.
6. **Token exchange**: `POST /token` with code + PKCE verifier → `access_token`; a
   subsequent `/mcp` tool call with that token succeeds and operates on the correct
   `userId` (props wired end-to-end).
7. **Security**: `return_to` open-redirect rejection; `RL_MCP` still enforced (429).

## Security considerations

- `return_to` restricted to same-origin paths on the bodyatlas host.
- CSRF token on the consent POST; the POST is same-origin and session-gated.
- Token props minimal (`userId` only).
- Short access-token TTL with refresh tokens (provider defaults).
- Consent screen names the requesting client from registered metadata so the user sees
  who they're authorizing.

## Docs

- Rewrite `docs/mcp-setup.md`: replace token-paste instructions with the OAuth
  connector walkthrough for Claude, ChatGPT, and Gemini CLI.
- Update CLAUDE.md Phase 2a status line to reflect OAuth connector auth.

## Out of scope

- `search`/`fetch` tools for ChatGPT deep-research connectors.
- Gemini consumer-app integration (not supported by the platform).
- Any change to the Phase 2b outbound AI coach.
- Per-scope granularity beyond a single `mcp` scope.
