# BodyAtlas Public Hardening — Design (Phase 2)

**Status:** Approved. Implements Phase 2 outlook item 5 of the v1 design spec
(`docs/superpowers/specs/2026-06-12-bodyatlas-design.md`): onboarding, rate
limiting, data export, account deletion, privacy policy.

**Goal:** Make BodyAtlas "responsible personal/invite"-ready — give the owner
real data rights (export + clean delete) and protect the shared Worker / D1 /
paid AI keys from abuse and accidents — without building stranger-facing polish
beyond a light first-run flow and a privacy page. No open registration, no
marketing.

## Scope

Five independent subsystems, all in the existing Worker + SPA. One schema change
(`users.onboardedAt`, migration `0008`); everything else is routes, middleware,
and UI.

| Piece | Surface |
|---|---|
| Data export | `GET /api/account/export` + Settings button |
| Account deletion | `DELETE /api/account` + Settings danger zone (typed confirm) |
| Rate limiting | Native Workers `ratelimit` bindings as middleware |
| Privacy policy | Public `/privacy` SPA route, drafted text |
| Onboarding | First-run wizard gated on `users.onboardedAt` + empty-state hints |

## Architecture

### Data model

- **Migration `0008`**: add `users.onboarded_at` (`integer` timestamp, nullable).
  NULL = not yet onboarded. No other schema changes.

### 1. Data export

New protected route group `accountRoutes` (mounted at `/api/account`, after
`requireAuth`). `GET /export`:

- Queries every table the user owns, scoped by `userId`:
  workouts (+ workout_exercises + sets), templates (+ template_exercises),
  meals, sleep_records, body_measurements, custom exercises (`user_id = me`),
  and the user's own profile/targets (the `toMe`-style projection — no
  `googleSub`).
- **Secrets are excluded:** `api_tokens` export `name`, `createdAt`,
  `lastUsedAt` only (never `tokenHash`); `ai_settings` export `provider` +
  `model` only (never `encryptedKey` / `keyIv` / `lastReview`).
- Returns `application/json` with
  `Content-Disposition: attachment; filename="bodyatlas-export-<YYYY-MM-DD>.json"`
  and a top-level shape `{ exportedAt, user, workouts, templates, meals, sleep,
  measurements, exercises, apiTokens, aiSettings }`.
- Synchronous — personal-scale data fits one response.

Client: Settings → "Export my data" button calls the endpoint and triggers a
browser download (fetch → blob → anchor click).

### 2. Account deletion

`DELETE /api/account` (protected). Because no user-referencing table has an
`ON DELETE CASCADE` to `users`, delete children explicitly in FK-safe order
inside one logical operation:

1. `workouts` (cascades `workout_exercises` → `sets`)
2. `templates` (cascades `template_exercises`)
3. `meals`, `sleep_records`, `body_measurements`
4. `api_tokens`, `ai_settings`
5. custom `exercises` where `user_id = me`
6. the `users` row

Then revoke the current session (delete the session key from KV) and clear the
session cookie. Respond `{ ok: true }`.

**Known limitation (accepted):** other active sessions for the user become
orphaned — their token→userId still resolves in KV, but the `users` row is gone,
so any `requireAuth`-downstream lookup (`/api/me`) returns not-found and the app
is unusable for them; they fully expire at the session TTL. A per-user session
index for immediate full revocation is noted as a future improvement, not built.

Client: Settings "danger zone" → "Delete account" opens a modal requiring the
user to type a confirmation phrase (e.g. their email or the word `DELETE`) before
the destructive button enables. On success, redirect to the login screen.

### 3. Rate limiting

Use Cloudflare's **GA `ratelimit` binding** (`env.<LIMITER>.limit({ key }) ->
{ success }`). Configure separate limiters in `worker/wrangler.jsonc` (the native
binding supports a `period` of 10 or 60 seconds):

| Binding | Applies to | Key | Limit (per 60s) |
|---|---|---|---|
| `RL_API` | `/api/*` (default) | `userId` | 120 |
| `RL_AI` | `/api/ai/*` | `userId` | 10 |
| `RL_AUTH` | `/auth/*` | client IP (`CF-Connecting-IP`) | 20 |
| `RL_MCP` | `/mcp` | bearer token (or its hash) | 60 |

Implemented as Hono middleware:
- Derive the key (the authenticated `userId` for `/api`; `CF-Connecting-IP` for
  `/auth`; the bearer token for `/mcp`). If no key is derivable (e.g. missing IP),
  fail open (allow) rather than block legitimate traffic.
- Call `env.<LIMITER>.limit({ key })`; on `!success` return `429` with
  `{ error: { code: 'rate_limited', message } }` and a `Retry-After: 60` header.
- The AI middleware runs in addition to the default API limiter (AI requests count
  against both the strict AI bucket and the general bucket).

**Local/testing note:** the binding is enforced only on deployed Cloudflare, not
in `wrangler dev` or the vitest pool. Tests therefore inject a fake limiter
(`{ limit: async () => ({ success: <bool> }) }`) into the env and assert the
middleware returns 429 when `success: false`, passes through when `success: true`,
and derives the right key per route class.

### 4. Privacy policy

A public SPA route `/privacy` (rendered without auth, reachable from the login
page footer and Settings). Plain-language content (EN + JA), drafted in this
project and owned/edited by the user — explicitly **not legal advice**. Covers:
what data is stored (workouts, meals, sleep, body measurements, and basic Google
profile: name + email), where (Cloudflare D1 + KV), that AI provider keys are
bring-your-own and encrypted at rest, that data export and account deletion are
available in Settings, that data is not sold/shared with third parties and there
is no advertising/tracking, and a contact line. Add a `/privacy` route in the
SPA router that renders outside the authenticated `AppLayout`.

### 5. Onboarding

Gated on `users.onboardedAt`. When a logged-in user has `onboardedAt === null`,
the app shows a first-run wizard instead of the normal shell:

1. **Welcome** — one-line intro.
2. **Preferences** — confirm units / locale / theme (prefilled from current
   values; reuses the existing `PATCH /api/me` fields).
3. **Targets** — set nutrition targets (kcal + protein/fat/carbs), optional.
4. **Timezone** — confirm the detected timezone.

Finishing persists the chosen settings via `PATCH /api/me` and stamps
`onboardedAt`. **Skippable** at any step — skipping stamps `onboardedAt` without
changing targets. Stamping is done by extending `updateMeSchema` to accept an
`onboarded: boolean` flag that the `me` PATCH handler maps to
`onboardedAt = now` (kept server-controlled; the client never sends a raw
timestamp).

Plus **empty-state hints**: each primary tab (Today, Train, Health, Trends), when
the user has no data for it, shows a friendly prompt ("Log your first workout",
etc.) instead of a bare empty list. (Several tabs already have partial empty
states — extend/standardize, don't duplicate.)

## Data flow highlights

- **Export:** Settings button → `GET /api/account/export` → JSON blob →
  client-side download. Read-only; no state change.
- **Delete:** typed-confirm modal → `DELETE /api/account` → cascade deletes →
  session revoked → client redirects to login.
- **Rate limit:** every matched request → middleware → `limit({key})` →
  pass or `429`.
- **Onboarding:** login → `me.onboardedAt === null` → wizard → `PATCH /api/me`
  (settings + `onboarded: true`) → normal shell.

## Testing

- **Export:** returns the user's rows; excludes `tokenHash`, `encryptedKey`,
  `keyIv`, `googleSub`; `Content-Disposition` attachment header present; scoped
  to the authenticated user (another user's rows never appear).
- **Deletion:** after `DELETE /api/account`, every owned row across all tables is
  gone and the user cannot authenticate (session revoked); FK-safe order does not
  error; a second delete is a clean no-op/404.
- **Rate limiting:** middleware returns 429 with `Retry-After` when the injected
  limiter reports `success: false`; passes through on `success: true`; correct key
  derivation per route class (user vs IP vs token); AI route consults the strict
  limiter.
- **Privacy:** `/privacy` renders without a session.
- **Onboarding:** wizard shows when `onboardedAt` is null and not otherwise;
  finishing/skip both stamp `onboardedAt`; `PATCH /api/me { onboarded: true }`
  sets the timestamp server-side and rejects a client-supplied timestamp.
- **i18n parity** for every new EN/JA string (enforced by the existing parity
  test).

## File map (new / changed)

- `worker/migrations/0008_user_onboarded_at.sql` — add `users.onboarded_at`.
- `worker/src/db/schema.ts` — `onboardedAt` column on `users`.
- `worker/src/routes/account.ts` — `GET /export`, `DELETE /` (new group).
- `worker/src/index.ts` — mount `accountRoutes` at `/api/account`; wire rate-limit
  middleware (default on `/api`, strict on `/api/ai`, IP on `/auth`, token on
  `/mcp`).
- `worker/src/lib/rate-limit.ts` — key-deriving middleware factory over a limiter
  binding.
- `worker/wrangler.jsonc` — `ratelimit` bindings `RL_API` / `RL_AI` / `RL_AUTH` /
  `RL_MCP`.
- `shared/src/user.ts` — `onboarded: z.boolean().optional()` on `updateMeSchema`;
  `onboardedAt` on the user type/projection.
- `worker/src/routes/me.ts` — map `onboarded: true` → `onboardedAt = now`.
- `app/src/pages/PrivacyPage.tsx` + router wiring (public route).
- `app/src/pages/OnboardingWizard.tsx` (or `components/`) + first-run gating in
  `App.tsx`.
- `app/src/pages/SettingsPage.tsx` — Export button, Delete-account danger zone,
  privacy link.
- `app/src/lib/account.ts` — export/delete hooks (raw fetch where the download
  needs a blob).
- Empty-state hints in the Today/Train/Health/Trends pages.
- `app/src/i18n/{en,ja}.ts` — privacy, onboarding, export/delete, rate-limit, and
  empty-state strings.

## Implementation order (one plan, five clusters)

1. **Data export** (read-only, lowest risk; establishes `accountRoutes`).
2. **Account deletion** (destructive; build on `accountRoutes`).
3. **Rate limiting** (middleware + wrangler bindings).
4. **Privacy policy** (static public page).
5. **Onboarding** (schema `0008` + wizard + empty states).

## Out of scope

Open self-serve registration, soft-delete/grace-period restore, per-user session
index for instant multi-session revocation, GDPR/CCPA formal compliance tooling,
emailed export/deletion receipts, full feature tour, and CAPTCHA/bot defense
beyond the rate limiter (Cloudflare edge handles DDoS).
