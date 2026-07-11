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
