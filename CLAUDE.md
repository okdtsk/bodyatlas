This repository is a web & mobile application to track personal health data and workout log.

Approved design spec: `docs/superpowers/specs/2026-06-12-bodyatlas-design.md` (source of truth for scope, data model, architecture).

# Architecture

- npm-workspaces monorepo: `shared/` (Zod schemas + types), `worker/` (Hono API on one Cloudflare Worker, D1 + Drizzle, KV sessions), `app/` (React SPA, Vite + @cloudflare/vite-plugin).
- One Worker serves both the SPA assets and `/api/*` + `/auth/*`; all `/api` routes are session-protected by default (register public routes before the `requireAuth` middleware).
- End-to-end types: Drizzle `$type<>` unions → Hono RPC `AppType` → `hc` client in the app. Shared Zod schemas validate on both sides.
- Dev: `npm run dev` (single origin, localhost:5173). Test: `npm test` (vitest; workers pool for the API). Deploy: `npm run deploy`.

# Current Status (2026-06-12) — v1 COMPLETE

All four v1 plans are shipped and deployed. Phase 2 progress:
- **MCP server (Phase 2a) shipped and deployed**: `https://bodyatlas.okdtsk.dev/mcp` (streamable HTTP), per-user `ba_` bearer tokens (hash-only storage, managed in Settings), 7 tools (log_meal/log_workout/log_weight/log_sleep/get_recent_workouts/get_trends/get_today). Setup guide: `docs/mcp-setup.md`. The MCP DO is `BodyAtlasMCP`; tools are plain functions in `worker/src/mcp/tools.ts`.
- **AI coach (Phase 2b) shipped and deployed**: BYO-key (Claude/OpenAI/Gemini) configured in Settings, keys AES-256-GCM encrypted at rest (`AI_KEY_SECRET` Worker secret); ✨ meal nutrition estimation in the meal form; on-demand weekly coach review (locale-aware) on the Trends tab. Adapter in `worker/src/lib/llm.ts`; endpoints under `/api/ai/*`.
- Remaining phase 2 (not started): iOS shell (Capacitor + HealthKit), offline queue — see the spec's Phase 2 outlook.


- **Foundation (Plan 1) shipped and deployed**: https://bodyatlas.okdtsk.dev — Google OAuth sign-in, themed (Gym Dark default / Clinical Light / Warm Journal), EN/JA, 4-tab shell + quick-log FAB stub, settings persistence.
- **Workout API (Plan 2a) shipped and deployed**: exercises (42 seeded EN/JA + custom), templates, workouts/sets endpoints with single-active rule, last-sets ghosts, post-hoc history editing. Timestamps cross the RPC boundary as ISO strings.
- **Workout UI (Plan 2b) shipped and deployed**: full Train tab — start (template/repeat/empty), active session with previous-performance ghosts, history with set editing, template editor, exercise catalog, quick-log set action. App data hooks derive ALL response types from the worker via `InferResponseType`.
- **Train polish (Plan 2c) shipped and deployed**: per-set notes, editable workout times (API requires TZ-explicit ISO), target-sets surfaced as session progress (ring + pips), Athletic Glow design treatment, skeleton loading states, iOS input-zoom fix.
- **Health tracking (Plan 3) shipped and deployed**: meals with deduped autocomplete library + favorites, sleep (woke-day semantics), body measurements, day view with totals vs editable targets, all four quick-log actions live.
- **Trends + Today (Plan 4) shipped and deployed**: strength progression (Epley est. 1RM), weekly volume by muscle group, nutrition vs body overlay, sleep bars — all client-bucketed in device tz; Today dashboard; Playwright E2E (3 specs) with hard-gated /auth/test-login (E2E_TEST_LOGIN flag, never in prod). Plans live in `docs/superpowers/plans/`.
- Phase 2 (after v1): MCP server, AI coach, iOS shell (Capacitor + HealthKit), offline queue.

# Core Features

## Workout logging

This feature is to track all previous workout.
A user can check recent workout records based on date or exercises (like Barbell bench press, Machine Hack Squat).

## Health tracker

A user can records Meals, Sleep, Body measurements.
Especially Meals section can accept not only meal names, but also each meal's time and nutrition.

## Recent Trend Analytics

A user can see recent workout & health trend via metrics and graphs.

## AI coach

If a user set AI API configuration (like OpenAI API, Gemini API, Claude API), user can get an advice from AI coach.


# Other Features

## MCP server

This application accepts data input not only from application directly, but also MCP.

## Apple Health integration

This application can fetch any data from apple health.

## Mobile-first UI

The target persona is user can view and manipulate any data at gym, restraunt, office.
So most use cases are mobile.
But desktop view is also necessary especically for reviewing the analysis results of recent records.
