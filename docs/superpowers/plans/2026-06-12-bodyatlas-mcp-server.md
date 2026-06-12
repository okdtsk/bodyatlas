# BodyAtlas MCP Server Implementation Plan (Phase 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A remote MCP server at `https://bodyatlas.okdtsk.dev/mcp` (streamable HTTP) exposing seven tools — `log_meal`, `log_workout`, `log_weight`, `log_sleep`, `get_recent_workouts`, `get_trends`, `get_today` — authenticated by per-user API bearer tokens managed in Settings.

**Architecture:** Cloudflare `McpAgent` (Durable Object, `agents` SDK + `@modelcontextprotocol/sdk`) mounted on the existing Worker. The Worker's fetch path validates the `Authorization: Bearer ba_…` token against a new `api_tokens` table (SHA-256 hashes only), then injects `ctx.props = { userId }` before delegating to `BodyAtlasMCP.serve('/mcp')` — the same props mechanism the OAuth provider uses, minus OAuth. Tool handlers are PLAIN FUNCTIONS in `worker/src/mcp/tools.ts` taking `(db, userId, input)` so they are testable with the existing pool-workers setup; the McpAgent class is a thin registration shell.

**Conventions:** all established (TDD, envelopes, reset-db, InferResponseType in app, TZ-explicit ISO). Tests at start: 23 shared / 74 worker / 60 app + 3 e2e. CI green on GitHub.

**References consulted:** cloudflare:build-mcp skill + agents-sdk/references/mcp.md (wrangler DO config, registerTool shape, serve pattern). The `ctx.props` injection for non-OAuth auth is the one under-documented seam — Task 3 verifies it against installed types and falls back to the documented `serve(path, { binding })` + props-from-ExecutionContext pattern used by `workers-oauth-provider`.

## Domain decisions

- **Token format:** `ba_` + 43 chars base64url (32 random bytes). Stored as SHA-256 hex hash; plaintext shown EXACTLY ONCE in the create response/UI. `last_used_at` updated on successful MCP auth (throttled: only when >1h stale, to limit writes).
- **Token management API:** `GET /api/tokens` (id, name, createdAt, lastUsedAt — never hashes), `POST /api/tokens {name}` → `{ token: 'ba_…', …meta }` once, `DELETE /api/tokens/:id`. Session-authenticated (Settings UI).
- **/mcp auth:** Bearer token → hash → lookup → 401 envelope on miss. No session cookies accepted on /mcp.
- **Exercise resolution in `log_workout`:** case-insensitive exact match on `name_en` OR `name_ja` over (seed ∪ own, unarchived). Unmatched name → the tool returns an error listing up to 5 close matches (`likeContains`) so the model can self-correct. No silent custom-exercise creation.
- **`log_workout` creates a FINISHED workout** (start defaults now-1h, end now; both overridable via TZ-explicit ISO). The single-active rule applies only to interactively started workouts — MCP logging is retrospective entry, mirroring post-hoc editing.
- **Tool outputs:** compact JSON inside a single text content block (models parse JSON reliably; keep payloads small).
- **get_trends input:** `{ kind: 'strength'|'volume'|'nutrition-body'|'sleep', exerciseName?, days? (default 84) }` — strength requires exerciseName (resolved like log_workout).
- **DO config:** first Durable Object in the project — `durable_objects.bindings: [{ name: 'BODYATLAS_MCP', class_name: 'BodyAtlasMCP' }]` + `migrations: [{ tag: 'v1', new_sqlite_classes: ['BodyAtlasMCP'] }]` in wrangler.jsonc; class exported from `worker/src/index.ts`.

## File structure (new/changed)

```
worker/migrations/0005_api_tokens.sql
worker/src/db/schema.ts              # + apiTokens
worker/src/auth/tokens.ts            # generate/hash/verify + bearer middleware for /mcp
worker/src/routes/tokens.ts          # /api/tokens CRUD
worker/src/mcp/tools.ts              # seven plain-function tool handlers
worker/src/mcp/server.ts             # BodyAtlasMCP McpAgent class (registration shell)
worker/src/index.ts                  # /mcp mount + export BodyAtlasMCP + /api/tokens mount
worker/wrangler.jsonc                # DO binding + migration
worker/test/{tokens,mcp-gate,mcp-tools}.test.ts
app/src/pages/SettingsPage.tsx       # token management section
app/src/lib/tokens.ts                # hooks
docs/mcp-setup.md                    # connector setup guide (Claude Code + claude.ai)
```

---

### Task 1: API tokens — table, service, routes

**Files:** schema + migration 0005, `worker/src/auth/tokens.ts`, `worker/src/routes/tokens.ts`, mount, `worker/test/tokens.test.ts`, reset-db (+ `api_tokens`).

- [ ] **Failing tests** (`worker/test/tokens.test.ts`): create returns `ba_`-prefixed plaintext once + metadata; list shows name/createdAt/lastUsedAt but NEVER token or hash; delete revokes; owner-scoped (user-2's token id → 404); `verifyToken` round-trip (unit: `await verifyToken(env.DB, plaintext)` → userId; garbage → null; revoked → null).
- [ ] **Schema:** `apiTokens` table — `id` text pk, `userId` notNull ref users, `name` text notNull, `tokenHash` text notNull unique, `createdAt` timestamp default now, `lastUsedAt` timestamp nullable. Index on `tokenHash`. Migration `api_tokens` (additive). reset-db: add `api_tokens` before `users`.
- [ ] **Service** (`worker/src/auth/tokens.ts`):

```ts
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';

const encoder = new TextEncoder();

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
  return `ba_${b64}`;
}

const LAST_USED_THROTTLE_MS = 60 * 60 * 1000;

/** Returns the owning userId for a valid token, else null. Touches lastUsedAt (throttled). */
export async function verifyToken(d1: D1Database, token: string): Promise<string | null> {
  if (!token.startsWith('ba_')) return null;
  const db = getDb(d1);
  const hash = await sha256Hex(token);
  const row = await db.query.apiTokens.findFirst({ where: eq(schema.apiTokens.tokenHash, hash) });
  if (!row) return null;
  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await db.update(schema.apiTokens).set({ lastUsedAt: new Date(now) }).where(eq(schema.apiTokens.id, row.id));
  }
  return row.userId;
}
```

- [ ] **Routes** (`/api/tokens`, session-authed via the existing chain): GET list (project name/createdAt/lastUsedAt/id, order createdAt desc), POST `{name: z.string().trim().min(1).max(60)}` → generate, store hash, return `{ id, name, createdAt, token }` 201, DELETE /:id owner-scoped. Mount after `/trends`.
- [ ] Gate (worker ~80 tests) + commit `feat: add per-user API tokens`

---

### Task 2: Settings token UI

**Files:** `app/src/lib/tokens.ts` (hooks: useTokens/useCreateToken/useRevokeToken — InferResponseType), SettingsPage section, i18n keys, test.

- [ ] i18n (both catalogs): `settings.tokens` 'API tokens' / 'APIトークン', `settings.tokenName` 'Token name' / 'トークン名', `settings.createToken` 'Create token' / 'トークンを作成', `settings.tokenCreated` 'Copy this token now — it will not be shown again.' / 'このトークンを今すぐコピーしてください — 再表示されません。', `settings.revoke` 'Revoke' / '失効', `settings.lastUsed` 'Last used' / '最終使用', `settings.neverUsed` 'Never used' / '未使用', `settings.mcpHint` 'Use with the MCP server — see docs/mcp-setup.md' / 'MCPサーバーで使用 — docs/mcp-setup.md 参照'.
- [ ] UI under the targets section: name input + create button; on success show the plaintext token in a `glow-card is-active` with a copy button (`navigator.clipboard.writeText`, guarded) + the copy-now warning; list existing tokens (name, created, last used or never) each with revoke (confirm).
- [ ] Test: create flow fires POST and renders the returned `ba_…` once; revoke fires DELETE after confirm.
- [ ] Gate (app ~62) + commit `feat: add API token management to settings`

---

### Task 3: MCP mount — deps, DO config, bearer gate, agent shell

**Files:** package install, `worker/wrangler.jsonc`, `worker/src/mcp/server.ts`, `worker/src/index.ts`, `worker/src/types.ts`, `worker/test/mcp-gate.test.ts`.

- [ ] **Install:** `npm install agents @modelcontextprotocol/sdk -w worker` (zod present).
- [ ] **wrangler.jsonc:** add

```jsonc
  "durable_objects": { "bindings": [{ "name": "BODYATLAS_MCP", "class_name": "BodyAtlasMCP" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["BodyAtlasMCP"] }],
```

- [ ] **Agent shell** (`worker/src/mcp/server.ts`):

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { Bindings } from '../types';
import { registerTools } from './tools';

export type McpProps = { userId: string };

export class BodyAtlasMCP extends McpAgent<Bindings, Record<string, never>, McpProps> {
  server = new McpServer({ name: 'bodyatlas', version: '1.0.0' });

  async init() {
    registerTools(this.server, this.env.DB, () => this.props.userId);
  }
}
```

(`registerTools` arrives in Task 4 — for THIS task create `worker/src/mcp/tools.ts` exporting a `registerTools` that registers only a `ping` tool returning `{ ok: true, userId }`, proving props flow end-to-end.)

- [ ] **Mount + gate** in `worker/src/index.ts` — BEFORE the Hono app handles the request, intercept `/mcp` in the default export:

```ts
import { BodyAtlasMCP } from './mcp/server';
import { verifyToken } from './auth/tokens';

export { BodyAtlasMCP };

const mcpHandler = BodyAtlasMCP.serve('/mcp', { binding: 'BODYATLAS_MCP' });

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const auth = request.headers.get('Authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const userId = token ? await verifyToken(env.DB, token) : null;
      if (!userId) {
        return Response.json(
          { error: { code: 'unauthorized', message: 'Valid bearer token required' } },
          { status: 401 },
        );
      }
      (ctx as ExecutionContext & { props: { userId: string } }).props = { userId };
      return mcpHandler.fetch(request, env, ctx);
    }
    return app.fetch(request, env, ctx);
  },
};
```

This replaces `export default app` — the Hono app keeps handling everything else. NOTE: `ctx.props` is the props-injection seam used by `workers-oauth-provider`; verify against the installed `agents` types (`McpAgent.serve` reads `ctx.props` into `this.props`). If the installed version exposes a different injection point (e.g., a `props` option or header-based), adapt minimally and report with evidence from node_modules. ALSO: `run_worker_first` in wrangler.jsonc assets must gain `"/mcp"` and `"/mcp/*"` so asset serving never swallows it.
- [ ] **Tests** (`worker/test/mcp-gate.test.ts`): `/mcp` without Authorization → 401 envelope; with garbage bearer → 401; with a real token (seed user + insert hashed token directly) → NOT 401 (the MCP transport will likely reject the non-initialized request with a different status/body — assert only `status !== 401`, plus that the unauthorized case never reaches the DO). If the DO transport cannot run under vitest-pool-workers, keep the 401 tests (they don't touch the DO) and report; the authorized path then gets covered by Task 5's live inspector check.
- [ ] Gate (`npm test -w worker` — all prior + new gate tests; root typecheck; `npm run build` must still produce a deployable output config including the DO migration) + commit `feat: mount MCP server with bearer-token gate`

---

### Task 4: The seven tools

**Files:** `worker/src/mcp/tools.ts` (replace ping), `worker/test/mcp-tools.test.ts`.

Structure: each tool = exported plain async function `(d1: D1Database, userId: string, input: <zod-inferred>) => Promise<object>` returning a JSON-serializable result (thrown `ToolError(message)` for user-facing errors); `registerTools` wraps each in `server.registerTool(name, { description, inputSchema }, handler)` converting results to `{ content: [{ type: 'text', text: JSON.stringify(result) }] }` and ToolErrors to `{ isError: true, content: [...] }`. Input schemas REUSE shared zod where possible (`mealInputSchema.shape`, `sleepInputSchema` innards — note refined schemas can't spread `.shape`; reuse the base object shapes or re-declare minimally and validate with the shared schema inside the handler).

Tool signatures (descriptions must tell the model about units — kg, ISO datetimes with timezone, RPE 1–10):

1. `log_meal` — input per mealInputSchema → creates meal → returns `{ id, name, eatenAt }`.
2. `log_weight` — measurementInputSchema → `{ id, weightKg, bodyFatPct, measuredAt }`.
3. `log_sleep` — sleepInputSchema → `{ id, bedAt, wokeAt, durationMin }`.
4. `log_workout` — `{ startedAt?, endedAt?, notes?, exercises: [{ exerciseName, sets: [setInput…] }] }`; resolves names (exact case-insensitive on nameEn/nameJa, seed∪own unarchived; on miss → ToolError listing ≤5 likeContains suggestions); inserts workout (default window now−1h→now) + exercises + sets via batch → `{ workoutId, exerciseCount, setCount }`.
5. `get_recent_workouts` — `{ limit? (1–20, default 5) }` → array of `{ startedAt, exercises: [{ name, sets: ['80kg × 8 @8', …] }], notes }` (reuse formatSet-style compaction server-side — simple template literal).
6. `get_trends` — `{ kind, exerciseName?, days? }` → for strength: the per-workout series (reuse the trends route logic by extracting its aggregation into `worker/src/lib/stats.ts` as `strengthSeries(db, userId, exerciseId, from)` and having BOTH the route and the tool call it); volume: per-workout muscle rows; nutrition-body: daily kcal/protein sums (server-side UTC-day bucketing is fine for the tool — note the caveat in the description) + measurement points; sleep: nightly `{ wokeAt, durationMin, quality }`.
7. `get_today` — `{}` → `{ nutrition: { kcal, targetKcal, proteinG, targetProteinG, … }, workout: 'active'|'done'|'rest' (+ exercise names), lastSleep: { durationMin, quality } | null, latestWeightKg }` — TODAY = UTC day window with the user's stored `timezone` preference applied (use the `users.timezone` column — format `Intl` boundaries server-side; this is the one place server-side day-bucketing is needed; implement `dayWindowFor(timezone)` helper with a unit test: Asia/Tokyo midnight ≠ UTC midnight).

- [ ] **Tests** (pool-workers, against env.DB + helpers): one happy-path per tool + log_workout unknown-exercise suggestion error + get_today JST window correctness (seed a meal at 2026-06-12T20:00:00Z = June 13 in JST; user timezone Asia/Tokyo; assert it lands in June 13's window, not June 12's).
- [ ] Gate (worker ~95) + commit `feat: implement the seven MCP tools`

---

### Task 5: Verify live, deploy, document

- [ ] **Local inspector check:** `npm run dev` + `npx @modelcontextprotocol/inspector@latest` → connect `http://localhost:5173/mcp` with a real token created via the UI → list tools (7) → call `get_today` and `log_meal`. Fix anything that surfaces (transport/props issues appear HERE if the ctx.props seam differed). Report transcript summary.
- [ ] **Migration + deploy:** `npx wrangler d1 migrations apply bodyatlas --remote --config worker/wrangler.jsonc` (0005) → `npm run deploy` (DO migration applies with the deploy).
- [ ] **docs/mcp-setup.md:** short guide — create token in Settings; Claude Code: `claude mcp add --transport http bodyatlas https://bodyatlas.okdtsk.dev/mcp --header "Authorization: Bearer ba_…"`; claude.ai custom connector equivalent; tool list with one-line descriptions; security notes (token = full account access; revoke in Settings).
- [ ] CLAUDE.md status (+ MCP shipped) — commit `docs: mcp server shipped`.
- [ ] User acceptance: connect from Claude Code and log a real meal by prompt.

---

## Plan self-review (authoring time)

- Spec Phase-2 MCP scope covered: streamable HTTP /mcp on the same Worker ✓, per-user tokens ✓, tools wrap existing domain logic ✓ (log_* + get_recent_workouts + get_trends, plus agreed log_sleep + get_today).
- Riskiest seam (ctx.props injection without OAuth) explicitly flagged with verification + fallback step in Task 3 and a live-inspector gate in Task 5 before deploy.
- Tool handlers as plain functions keep the DO shell thin and the logic testable in the existing pool; strength aggregation deduped into stats.ts rather than copy-pasted.
- get_today is the only server-side tz computation — uses the stored user timezone (finally exercising that column) with an explicit JST unit test.
- Token security: hash-only storage, show-once UX, revocation, last-used visibility, no token logging anywhere.
