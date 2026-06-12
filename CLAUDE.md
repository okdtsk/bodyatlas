This repository is a web & mobile application to track personal health data and workout log.

Approved design spec: `docs/superpowers/specs/2026-06-12-bodyatlas-design.md` (source of truth for scope, data model, architecture).

# Architecture

- npm-workspaces monorepo: `shared/` (Zod schemas + types), `worker/` (Hono API on one Cloudflare Worker, D1 + Drizzle, KV sessions), `app/` (React SPA, Vite + @cloudflare/vite-plugin).
- One Worker serves both the SPA assets and `/api/*` + `/auth/*`; all `/api` routes are session-protected by default (register public routes before the `requireAuth` middleware).
- End-to-end types: Drizzle `$type<>` unions → Hono RPC `AppType` → `hc` client in the app. Shared Zod schemas validate on both sides.
- Dev: `npm run dev` (single origin, localhost:5173). Test: `npm test` (vitest; workers pool for the API). Deploy: `npm run deploy`.

# Current Status (2026-06-12)

- **Foundation (Plan 1) shipped and deployed**: https://bodyatlas.okdtsk.dev — Google OAuth sign-in, themed (Gym Dark default / Clinical Light / Warm Journal), EN/JA, 4-tab shell + quick-log FAB stub, settings persistence.
- **Workout API (Plan 2a) shipped and deployed**: exercises (42 seeded EN/JA + custom), templates, workouts/sets endpoints with single-active rule, last-sets ghosts, post-hoc history editing. Timestamps cross the RPC boundary as ISO strings.
- Pending plans: Plan 2b workout UI (Train tab), Plan 3 health tracking (meals/sleep/measurements), Plan 4 trends + Today dashboard + Playwright E2E. Plans live in `docs/superpowers/plans/`.
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
