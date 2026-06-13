# BodyAtlas Offline Write Queue — Design (Phase 2)

**Status:** Approved. Implements Phase 2 outlook item 4 of the v1 design spec
(`docs/superpowers/specs/2026-06-12-bodyatlas-design.md`): "quick-logs queue in
IndexedDB, flush on reconnect."

**Goal:** Let the user log data while offline — primarily at the gym on flaky
wifi — and have it sync automatically on reconnect, with no duplicates and clear
feedback that the data is saved-but-not-yet-synced.

## Scope

Four **covered writes** queue when offline:

| Write | Endpoint |
|---|---|
| Quick-log meal | `POST /api/meals` |
| Quick-log weight / body measurement | `POST /api/measurements` |
| Quick-log sleep | `POST /api/sleep` |
| Log a set in the active workout | `POST /api/workouts/:id/exercises/:weId/sets` |

**Out of scope** (stays online-only): starting/ending a workout, all edits
(`PATCH`) and deletes, full-form creates beyond the quick-logs, exercise/template
management. Set logging is in scope precisely because the active workout was
created **while online**, so a queued set references a real server-side
`workoutExerciseId` — no client-side parent-ID generation or sync ordering
across parent/child is needed. Service Worker Background Sync is explicitly **not**
used: it is unreliable in the iOS WKWebView, a primary target.

## Architecture

A custom IndexedDB queue integrated into the existing TanStack Query mutation
layer (not TanStack's native paused-mutation persistence — the custom queue gives
us idempotency control, testable pure logic, and explicit pending UX). Server-side
idempotency keys guarantee no duplicates even when an acknowledgement is lost.

### Components

All new app code lives under `app/src/lib/offline/`.

**1. Queue store (`queue.ts`, `types.ts`)**

One IndexedDB object store, `operations`:

```ts
interface QueuedOp {
  id: string;            // client-generated UUID — also the idempotency key
  kind: 'meal' | 'measurement' | 'sleep' | 'set';
  payload: unknown;      // the request body (typed per kind via a discriminated union)
  context?: { workoutId: string; weId: string }; // set kind only — path params
  createdAt: string;     // ISO
  status: 'pending' | 'failed';
  error?: string;        // populated when dead-lettered
}
```

The queue *logic* operates on a narrow `QueueStore` interface
(`list()/put()/delete()/get()`). Production uses a thin hand-rolled
`IdbQueueStore` (no runtime dependency). Tests use an in-memory `MemoryQueueStore`
for the pure logic, plus `fake-indexeddb` (Apache-2.0, dev-only) to exercise the
real `IdbQueueStore` including survival across a simulated reload.

**2. Connectivity (`connectivity.ts`)**

Wraps `navigator.onLine` and the `online`/`offline` events into `isOnline()` plus
a subscribe API. A covered mutation that throws a **network error** (TypeError /
fetch failure) also routes into the queue, so a connection dropped *mid-submit* is
captured, not just a cold-offline start.

**3. Mutation integration**

The four covered TanStack mutation hooks (in `app/src/lib/train.ts` and
`health.ts`) are wrapped so that:
- **Offline at submit time** → enqueue a `QueuedOp` (fresh UUID) and optimistically
  insert a **provisional record** (carrying that UUID and `pending: true`) into the
  relevant query cache, so the item appears instantly.
- **Online** → normal request path. If it fails with a *network* error, fall back
  to the enqueue + provisional path. A 4xx/5xx that is not a network error
  surfaces as today (real validation failure, not queued).

**4. Flush worker (`flush.ts`)**

Triggered on `online` events and on app start (when online). Drains the queue
**sequentially, FIFO** (sequential keeps set ordering and simplifies reasoning):

- **2xx** → remove the op; reconcile the cache (replace the provisional record with
  the returned server row; clear `pending`).
- **4xx** (validation) → **dead-letter**: set the op `status: 'failed'` with its
  error; mark the provisional record with an error marker. Do not retry. Continue
  draining the rest (covered rows are independent, so a skipped op does not corrupt
  others).
- **Network error** → stop; keep remaining ops; wait for the next `online` event.
- **401** (session expired) → stop; keep ops; prompt re-login. Flush resumes after
  re-auth.

**5. Cross-reload hydration**

The TanStack Query cache is in-memory and lost on reload, but the IndexedDB queue
persists. On app start, before flushing, read all pending/failed ops and
re-inject their provisional records into the caches, so the user still sees pending
items after a reload or after the iOS shell is backgrounded and relaunched.

### Server idempotency

- **Migration `0007`**: add a nullable `client_id TEXT` column with a **unique
  index** to `meals`, `sleep_records`, `body_measurements`, and `sets`. UUIDs are
  globally unique, so a plain unique index suffices (no per-user composite needed).
- **Shared schemas** (`shared/src/health.ts`, `shared/src/workout.ts`): add
  `clientId: z.string().uuid().optional()` to the meal, sleep, measurement, and set
  *input* schemas.
- **Handlers** (the four covered POSTs): when `clientId` is present, attempt the
  insert; on a unique-constraint violation, `SELECT` the existing row by `clientId`
  and return it with 200 (idempotent no-op). When `clientId` is absent, behavior is
  unchanged. This makes a lost-ack replay a safe no-op.

### Pending UX

- **Per-item**: provisional records render a small "pending sync" marker (a clock
  dot with reduced opacity) wherever the covered records list (Today, day views,
  active workout set list). A dead-lettered op renders an error marker instead.
- **Global**: a compact indicator near the header/FAB shows offline state and
  "N pending", clearing as the queue drains. New EN/JA i18n strings.

## Data flow

1. **Offline log** → hook enqueues the op (UUID, kind, payload, optional set
   context) to IndexedDB and writes a provisional `pending` record into the cache.
   The item shows immediately with a pending marker; the global indicator shows
   offline + count.
2. **Reconnect** → flush worker drains FIFO → each op POSTs with its `clientId` →
   server upserts idempotently → returns the real row → cache reconciled
   (provisional replaced, `pending` cleared) → op removed → count decrements.
3. **Relaunch with pending ops** → on start (online), provisional records are
   re-hydrated from the queue into caches, then the flush runs.

## Error handling summary

| Condition | Behavior |
|---|---|
| 2xx on flush | Remove op, reconcile provisional → real row |
| 4xx validation on flush | Dead-letter op (`failed` + error), mark item, keep draining |
| Network error on flush | Stop, retain ops, retry on next `online` |
| 401 on flush | Stop, retain ops, prompt re-login, resume after re-auth |
| Duplicate replay (lost ack) | Server returns existing row by `clientId` — no dupe |

## Testing

- **Pure queue + flush reducer** (in-memory store): enqueue, FIFO drain, idempotent
  replay, dead-letter on 4xx, stop-on-network-error, stop-on-401, resume on
  reconnect.
- **Idb adapter** (`fake-indexeddb`): persistence survives a simulated reload;
  hydration re-injects provisional records.
- **Worker** (vitest-pool-workers): POST with the same `clientId` twice → exactly
  one row and the same response; POST without `clientId` → unchanged behavior; one
  test per covered table.
- **Components**: pending and error markers render for provisional records; global
  indicator reflects offline state and count.
- **E2E (optional)**: toggle the browser offline, log a quick-log, reconnect, assert
  exactly one record.

## File map (new / changed)

- `shared/src/health.ts`, `shared/src/workout.ts` — `+clientId` on the four input schemas.
- `worker/migrations/0007_*.sql` — `client_id` columns + unique indexes.
- `worker/src/routes/{meals,sleep,measurements,workouts}.ts` — idempotent upsert on the four covered POSTs.
- `worker/src/db/schema.ts` — `clientId` column on the four tables.
- `app/src/lib/offline/{types,connectivity,queue,flush}.ts` — queue store, connectivity, flush worker.
- `app/src/lib/{train,health}.ts` — wrap the four covered mutation hooks.
- App startup — hydrate provisional records from the queue, then flush.
- List components (Today, day views, active workout) — pending/error markers.
- A global offline/pending indicator component.
- `app/src/i18n/{en,ja}.ts` — offline/pending strings.

## Out of scope for this phase

Offline edits/deletes, offline workout start, conflict resolution beyond
idempotent replay, background sync while the app is closed, and a manual
"retry failed op" UI (dead-lettered ops surface an error; manual retry/cleanup can
come later if needed).
