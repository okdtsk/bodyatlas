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
2. Add an MCP server with URL `https://bodyatlas.okdtsk.workers.dev/mcp` — **not** the
   `okdtsk.dev` custom domain. See [Troubleshooting](#chatgpt-dynamic-client-registration-failed-registration-endpoint-returned-403)
   for why.
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

## Troubleshooting

### ChatGPT: "Dynamic client registration failed: registration endpoint returned 403"

This 403 comes from **Cloudflare's edge, not from bodyatlas.** The OAuth provider and
Worker never emit 403 — Cloudflare's bot protection blocks the connector's request
before it reaches the Worker. ChatGPT registers using OpenAI bot user-agents
(`ChatGPT-User/1.0`, `GPTBot`, `OAI-SearchBot`), which Cloudflare's zone-level bot
rules (Bot Fight Mode / "Block AI bots" / Browser Integrity Check) reject.

**Diagnose** — probe `/register` with different user-agents (Cloudflare, not the app,
decides the outcome):

```sh
# a normal client succeeds …
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -H 'content-type: application/json' -d '{"redirect_uris":["https://example.com/cb"]}' \
  https://bodyatlas.okdtsk.dev/register            # → 201

# … while an OpenAI UA is blocked at the edge
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  -A 'ChatGPT-User/1.0' \
  -H 'content-type: application/json' -d '{"redirect_uris":["https://example.com/cb"]}' \
  https://bodyatlas.okdtsk.dev/register            # → 403 when the edge is blocking
```

If the plain request returns 201 and the OpenAI-UA request returns 403, it's the edge.

**Fix (recommended — scoped, not zone-wide):** these bot settings are **zone-level**,
so turning them off applies to *every* hostname and app under `okdtsk.dev`, not just
bodyatlas. Instead of disabling protection zone-wide, keep it on and carve out only the
connector paths with a WAF **Skip** rule:

- Cloudflare dashboard → the `okdtsk.dev` zone → **Security → WAF → Custom rules → Create**.
- Expression (scopes the exception to bodyatlas's OAuth/MCP endpoints only):
  ```
  (http.host eq "bodyatlas.okdtsk.dev" and (
    starts_with(http.request.uri.path, "/mcp") or
    http.request.uri.path in {"/register" "/token" "/authorize"} or
    starts_with(http.request.uri.path, "/.well-known/oauth")
  ))
  ```
- Action: **Skip** → tick **Browser Integrity Check** (add other bot features if they
  also catch it). On the Free plan, Browser Integrity Check is skippable per-rule;
  Bot Fight Mode is not path-scopable (Super Bot Fight Mode / Pro+ is), so if it's the
  blocker you either leave it off zone-wide or upgrade.
- Re-run the probe → expect 201.

Every other app or static page on `okdtsk.dev` then keeps full bot protection; only
bodyatlas's connector endpoints skip the check. Disabling the toggles zone-wide also
works but weakens the edge for the whole domain — prefer the scoped rule.

### Still 403 after the WAF Skip rule: Cloudflare's "AI Bots" feature and Bot Fight Mode

The WAF Skip rule above only exempts the *legacy* bot products (`bic`, `hot`,
`rateLimit`, `securityLevel`, `uaBlock`, `waf`, `zoneLockdown`) — confirmed via
Cloudflare's ruleset schema. Two other zone-level layers sit outside what that rule
can reach, and both were confirmed (via `GET /zones/{zone_id}/bot_management` and via
Worker request logs showing zero `/register` hits despite the request leaving
ChatGPT) to be blocking `bodyatlas.okdtsk.dev/register` even after the WAF Skip rule
was in place:

- **AI Bots** (`ai_bots_protection`) — an ML classifier for AI-crawler-fingerprinted
  traffic. Zone-wide `block` / `disabled` / `only_on_ad_pages` toggle, no path-scoped
  exemption available via the API or dashboard.
- **Bot Fight Mode** (`fight_mode`) — Cloudflare's baseline bot classifier. Also
  zone-wide with **no path-scoped exemption on the Free plan** (Super Bot Fight Mode,
  Pro plan and up, does support scoped exemptions).

Disabling either or both zone-wide works, but weakens bot protection for every host
under `okdtsk.dev` (`pawary`, `workout-log`, the wedding-party site), not just
bodyatlas, and — for `ai_bots_protection` — needs to stay disabled on an ongoing
basis, since ChatGPT's token refresh and tool calls carry the same fingerprint as the
initial `/register` call, not just the once-off registration.

**Fix actually in use: route around the zone entirely.** `bodyatlas.okdtsk.workers.dev`
(the Worker's `workers.dev` subdomain, enabled via `"workers_dev": true` in
`wrangler.jsonc`) is served from Cloudflare's own `workers.dev` zone, not
`okdtsk.dev` — so none of `okdtsk.dev`'s bot/AI-bot settings apply to it. Confirmed
live: `POST https://bodyatlas.okdtsk.workers.dev/register` → `201`, and ChatGPT's
connector now registers successfully end-to-end. This keeps `okdtsk.dev`'s zone-wide
protections (`fight_mode: true`, `ai_bots_protection: block`) fully intact for every
app on the zone — nothing was weakened to fix this.

**Current tradeoff:** because the OAuth endpoint options in `worker/src/index.ts` are
relative paths, ChatGPT's discovery document resolves *every* endpoint — including
`/authorize` — to `bodyatlas.okdtsk.workers.dev`, meaning the whole app (not just the
MCP/OAuth surface) is currently duplicated onto that host. A cleaner follow-up
(tracked separately, not yet built) is a dedicated `bodyatlas-mcp` Worker exposing
only `/register`, `/token`, `/mcp`, and `/.well-known/*` on `workers.dev`, while
`/authorize` stays on `bodyatlas.okdtsk.dev` (it was never blocked — only `/register`
was, since it's the only endpoint hit by ChatGPT's own backend rather than a user's
browser). Until that split lands, do not disable `workers_dev` in `wrangler.jsonc` —
doing so removes `bodyatlas.okdtsk.workers.dev` and breaks the ChatGPT connector.
