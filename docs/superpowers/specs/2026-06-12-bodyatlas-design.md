# BodyAtlas — v1 Design Spec

Date: 2026-06-12
Status: Approved (brainstorming session with okdtsk)

## Product summary

BodyAtlas is a personal health and training tracker: workouts, meals, sleep, and body
measurements, with trend analytics over all of them. Phase 1 is a single-user tool for
the owner; the architecture is multi-user-ready so it can become a public product later
without a rewrite.

Primary use is mobile (logging at the gym or a restaurant); desktop is for reviewing
trends. v1 is a responsive web app; an iOS native shell comes in phase 2.

## Decisions made

| Topic | Decision |
|---|---|
| Audience | Personal first; multi-user-ready data model and real auth from day one |
| iOS strategy | Web app + thin native shell (Capacitor) in phase 2 for HealthKit |
| Platform | Cloudflare Workers + D1 (Drizzle ORM), KV for sessions |
| v1 scope | Workout logging, meals + nutrition, sleep, body measurements, trend analytics |
| Phase 2 | MCP server, AI coach, iOS shell + Apple Health, offline queue, public hardening |
| Set record | weight × reps + RPE (RPE optional) |
| Exercise types | strength, bodyweight (weight optional), cardio (duration/distance) |
| Exercise catalog | Seeded catalog (EN/JA names, muscle group, equipment) + user-defined custom |
| Routines | Templates + one-tap "repeat last workout" with previous numbers shown while logging |
| Meal entry | Manual entry + implicit library (autocomplete over past meals, favorites pinned) |
| Nutrition fields | Calories, protein, fat, carbs — all optional per meal |
| Body measurements | Weight + body fat %, each optional per entry |
| Sleep | Bed time + wake time + optional quality (1–5); duration derived |
| Analytics | Strength progression, volume/frequency, nutrition vs body trend, sleep consistency |
| Auth | Google OAuth → KV session, HTTP-only cookie |
| Theme | Token-based theming; default Gym Dark, plus Clinical Light and Warm Journal |
| Navigation | 4 tabs (Today / Train / Health / Trends) + global quick-log FAB |
| i18n | EN + JA from day one (typed message catalog); kg units (per-user preference) |
| Offline | Online-only v1 with retry-safe mutation UX; offline write queue is phase 2 |
| Stack | React SPA (Vite) + Hono API on one Worker; shared Zod schemas; Hono RPC client |

## Architecture

One Cloudflare Worker is the entire backend:

- Serves the React SPA static assets.
- Exposes a Hono REST API under `/api/*`.
- D1 (SQLite) via Drizzle ORM with versioned, committed migrations.
- KV for sessions.
- Google OAuth (PKCE) → HTTP-only session cookie.

Repository layout (npm workspaces monorepo):

```
app/      React SPA (Vite, TanStack Query, Hono RPC client)
worker/   Hono API + static asset serving, Drizzle schema + migrations
shared/   Zod schemas + TS types used by both sides
```

Every data table carries `user_id`; every query is scoped by it. Phase 2 components
(Capacitor iOS shell, MCP endpoint, AI coach routes) attach to the same API — nothing
is rearchitected.

### Rejected alternatives

- **SSR framework (React Router v7 / Next.js on Workers):** SSR buys nothing for an
  auth-gated personalized app; Capacitor wrapping and MCP would still need a separate
  API path, duplicating data access.
- **SvelteKit:** smaller ecosystem for charts/Capacitor; same SSR duplication concern.
- **Native SwiftUI app:** two codebases; too slow for a solo project.
- **Supabase/Firebase:** deeper lock-in; MCP server would need separate hosting.

## Data model

Ten D1 tables. All timestamps stored UTC; "day" boundaries computed from the user's
IANA timezone preference (default `Asia/Tokyo`).

### Workout domain

- `exercises` — `id`, `user_id` (NULL = seed catalog row), `name_en`, `name_ja`,
  `type` (`strength` | `bodyweight` | `cardio`), `muscle_group`, `equipment`,
  `is_archived`. Search matches both names.
- `workouts` — `id`, `user_id`, `started_at`, `ended_at`, `template_id` (nullable),
  `notes`.
- `workout_exercises` — `id`, `workout_id`, `exercise_id`, `position`, `notes`.
- `sets` — `id`, `workout_exercise_id`, `position`, `weight_kg` (nullable for
  bodyweight), `reps`, `rpe` (nullable), `duration_sec`, `distance_m` (cardio).
  One table; the exercise `type` decides which fields the UI shows.
- `templates` — `id`, `user_id`, `name`. `template_exercises` — `template_id`,
  `exercise_id`, `position`, `target_sets`.

"Repeat last" reads the user's previous workout for a template and pre-fills it;
previous session numbers are shown inline while logging. No extra table.

### Health domain

- `meals` — `id`, `user_id`, `eaten_at`, `name`, `calories`, `protein_g`, `fat_g`,
  `carbs_g` (all nutrition optional), `notes`, `is_favorite`. The meal library is
  implicit: autocomplete searches past meals by name and pre-fills the latest
  nutrition values; favorites pin to the top.
- `sleep_records` — `id`, `user_id`, `bed_at`, `woke_at`, `quality` (1–5, optional),
  `notes`. Duration derived.
- `body_measurements` — `id`, `user_id`, `measured_at`, `weight_kg`, `body_fat_pct`
  (each optional).

### Users

- `users` — `id`, `google_sub`, `email`, `name`, plus preferences: `locale`,
  `theme`, `unit`, `timezone`, nutrition targets (kcal, P/F/C).

Analytics are computed at request time (SQL + code); no precomputed tables at
personal scale. Caching can be added later if needed.

## Screens & UX

Navigation: bottom tab bar (mobile) / left sidebar (desktop) with **Today / Train /
Health / Trends**, plus a floating **quick-log FAB** on every screen opening a sheet
with Set / Meal / Weight / Sleep. Meal and weight logging complete in under ~5 seconds
from anywhere.

- **Today** — daily glance: nutrition progress vs targets (kcal + P/F/C), today's
  workout status, latest weight with mini trend, last night's sleep. Cards tap
  through to their tabs.
- **Train** — start a session from a template, "repeat last", or empty. Active
  session screen: current exercise, fast set entry (weight/reps/RPE), previous
  session's numbers ghosted next to each set. History browsable by date or by
  exercise; template and catalog management.
- **Health** — day-by-day view: meals by time with daily totals bar, sleep and body
  measurement entries, one-tap add for each. Meal add uses autocomplete over past
  meals.
- **Trends** — four views with a shared time-range selector (4w / 12w / 6m / 1y):
  1. Strength progression per exercise (top set weight + estimated 1RM).
  2. Weekly training volume (sets per muscle group) and frequency.
  3. Nutrition vs body trend (calories/protein bars against weight/body-fat line).
  4. Sleep consistency (duration + bedtime regularity).

## API & auth

Auth: `/auth/google` → Google OAuth (PKCE) → upsert user by Google `sub` → KV session
(30-day rolling) → HTTP-only `Secure` `SameSite=Lax` cookie. Middleware resolves
session → `user_id` for all `/api/*` routes. No tokens client-side.

```
/api/workouts        GET (filters: date range, exercise)  POST
/api/workouts/:id    GET  PATCH  DELETE   (sets via sub-routes)
/api/templates       CRUD
/api/exercises       GET (seed + user, searchable)  POST  PATCH
/api/meals           CRUD + GET /search?q=  (autocomplete with latest nutrition)
/api/sleep           CRUD
/api/measurements    CRUD
/api/trends/*        GET — strength/:exerciseId, volume, nutrition-body, sleep
/api/me              GET  PATCH (locale, theme, unit, timezone, nutrition targets)
```

All request bodies validated with shared Zod schemas; the same schemas type the Hono
RPC client. Errors use a consistent `{ error: { code, message } }` envelope: 401
triggers client re-auth, 422 carries field-level validation details.

## Theming & i18n

- All colors/radii/type styles are CSS custom properties (design tokens). Three
  token sets: **Gym Dark** (default), **Clinical Light**, **Warm Journal**. Theme
  switch via `data-theme` on the root; preference stored per user. Components and
  charts reference tokens only, never raw colors.
- EN + JA via a typed message catalog (`en.ts` / `ja.ts` sharing one key type —
  missing translations are compile errors). Locale per user, defaulting from the
  browser. Dates/numbers via native `Intl`. Seed exercises carry `name_en`/`name_ja`.

## Error handling

- Client: mutations via TanStack Query with a global handler; failures show a
  retryable toast and forms keep state — a logged set is never silently lost.
- Server: Zod rejects bad input (422); auth middleware (401/403); outermost Hono
  error handler logs structured detail to Workers observability and returns the
  generic envelope. No stack traces or D1 errors leak to clients.
- Multi-table writes (workout + sets) use D1 `batch` so partial writes cannot occur.

## Testing

CI on GitHub Actions, three layers:

1. **Unit (Vitest):** trend math (1RM estimation, volume aggregation, trend lines),
   Zod schemas, date/timezone logic (UTC storage vs JST day boundaries).
2. **API integration (Vitest + @cloudflare/vitest-pool-workers):** routes against a
   real local D1 with migrations; auth scoping (user A cannot read user B), CRUD,
   validation errors.
3. **E2E smoke (Playwright):** stubbed-OAuth login → start workout from template →
   log sets → appears in history; log meal via autocomplete → totals update.

## Phase 2 outlook (designed-for, not built in v1)

In rough priority order:

1. **MCP server** — `/mcp` endpoint on the same Worker (streamable HTTP), per-user
   API tokens. Tools wrap the existing API: `log_meal`, `log_workout`, `log_weight`,
   `get_recent_workouts`, `get_trends`.
2. **AI coach** — BYO API key (Claude / OpenAI / Gemini) stored encrypted
   server-side. First feature: meal nutrition estimation from text; then weekly
   coach review over trends data.
3. **iOS shell** — Capacitor wrapping the same SPA bundle; native plugin syncs
   HealthKit (sleep, weight, workouts) to the API. TestFlight distribution first.
4. **Offline write queue** — quick-logs queue in IndexedDB, flush on reconnect.
5. **Public hardening** — onboarding, rate limiting, data export, account deletion,
   privacy policy.

## Out of scope for v1

Apple Health, AI features, MCP, offline support, lbs units, tape measurements,
micronutrients, multi-week training programs with progression rules, social features,
push notifications.
