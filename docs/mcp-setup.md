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
