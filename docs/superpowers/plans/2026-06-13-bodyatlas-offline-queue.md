# BodyAtlas Offline Write Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user log a meal, weight, sleep, or workout set while offline; the write is queued in IndexedDB and flushed idempotently on reconnect, with per-item and global "pending sync" UI.

**Architecture:** A custom IndexedDB queue sits beside the existing TanStack Query mutation layer. The four covered create-hooks try the network first; on a network error they enqueue an operation (carrying a client-generated UUID) and surface it as a provisional "pending" item via a reactive store. A flush worker drains the queue FIFO on reconnect. Each covered POST accepts that UUID as `clientId`; the server upserts on a unique `client_id` index so a lost-ack replay never duplicates.

**Tech Stack:** TanStack Query v5, IndexedDB (hand-rolled wrapper, `fake-indexeddb` for tests), Drizzle + D1, shared Zod schemas, Hono RPC. Source of truth spec: `docs/superpowers/specs/2026-06-13-bodyatlas-offline-queue-design.md`.

---

## File structure (new / changed)

```
shared/src/health.ts                       # + clientId on meal/sleep/measurement input schemas
shared/src/workout.ts                      # + clientId on set input schema
worker/src/db/schema.ts                    # + clientId column + unique index on 4 tables
worker/migrations/0007_offline_client_id.sql  # ALTER TABLE + CREATE UNIQUE INDEX x4
worker/src/routes/meals.ts                 # idempotent upsert in POST /
worker/src/routes/sleep.ts                 # idempotent upsert in POST /
worker/src/routes/measurements.ts          # idempotent upsert in POST /
worker/src/routes/workouts.ts              # idempotent upsert in POST /:id/exercises/:weId/sets
worker/test/offline-idempotency.test.ts    # dup-clientId tests for all 4 endpoints
app/src/lib/offline/types.ts               # QueuedOp, OpKind, QueueStore interface
app/src/lib/offline/memory-store.ts        # MemoryQueueStore (tests + fallback)
app/src/lib/offline/idb-store.ts           # IdbQueueStore (hand-rolled IndexedDB)
app/src/lib/offline/queue.ts               # OfflineQueue (enqueue/subscribe/remove/markFailed)
app/src/lib/offline/connectivity.ts        # isOnline + subscribe
app/src/lib/offline/senders.ts             # kind -> API call carrying clientId
app/src/lib/offline/flush.ts               # flushQueue(queue, senders) FIFO drain
app/src/lib/offline/index.ts               # singleton wiring + start() controller
app/src/lib/offline/*.test.ts              # unit tests per module
app/src/lib/offline/usePendingOps.ts       # useSyncExternalStore hook over the queue
app/src/components/OfflineIndicator.tsx     # global offline/pending indicator
app/src/components/PendingBadge.tsx         # per-item pending/error marker
app/src/lib/health.ts                      # wrap useCreateMeal/Sleep/Measurement
app/src/lib/train.ts                       # wrap useLogSet
app/src/pages/HealthPage.tsx               # merge pending meal/sleep/measurement items
app/src/pages/SessionPage.tsx              # merge pending sets
app/src/components/AppLayout.tsx           # mount OfflineIndicator; start() the controller
app/src/i18n/en.ts, app/src/i18n/ja.ts     # offline strings
```

---

### Task 1: Server schema — `client_id` column + unique index (migration 0007)

**Files:**
- Modify: `worker/src/db/schema.ts`
- Create: `worker/migrations/0007_offline_client_id.sql`

- [ ] **Step 1: Add the column + unique index to the four Drizzle tables.** In `worker/src/db/schema.ts`, import `uniqueIndex` alongside the existing `index`:

```ts
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
```

Add `clientId: text('client_id'),` as a field on each of `sets`, `meals`, `sleepRecords`, `bodyMeasurements`, and add a unique index in each table's index array. For `sets`:

```ts
  (t) => [
    index('idx_sets_workout_exercise').on(t.workoutExerciseId),
    uniqueIndex('idx_sets_client_id').on(t.clientId),
  ],
```

For `meals`:

```ts
  (t) => [
    index('idx_meals_user_eaten').on(t.userId, t.eatenAt),
    uniqueIndex('idx_meals_client_id').on(t.clientId),
  ],
```

For `sleepRecords`:

```ts
  (t) => [
    index('idx_sleep_user_woke').on(t.userId, t.wokeAt),
    uniqueIndex('idx_sleep_client_id').on(t.clientId),
  ],
```

For `bodyMeasurements`:

```ts
  (t) => [
    index('idx_measurements_user_measured').on(t.userId, t.measuredAt),
    uniqueIndex('idx_measurements_client_id').on(t.clientId),
  ],
```

(SQLite treats `NULL` values as distinct in a unique index, so existing rows and all online writes — which leave `client_id` NULL — never collide.)

- [ ] **Step 2: Write the migration SQL.** Create `worker/migrations/0007_offline_client_id.sql`:

```sql
ALTER TABLE `sets` ADD COLUMN `client_id` text;
ALTER TABLE `meals` ADD COLUMN `client_id` text;
ALTER TABLE `sleep_records` ADD COLUMN `client_id` text;
ALTER TABLE `body_measurements` ADD COLUMN `client_id` text;
CREATE UNIQUE INDEX `idx_sets_client_id` ON `sets` (`client_id`);
CREATE UNIQUE INDEX `idx_meals_client_id` ON `meals` (`client_id`);
CREATE UNIQUE INDEX `idx_sleep_client_id` ON `sleep_records` (`client_id`);
CREATE UNIQUE INDEX `idx_measurements_client_id` ON `body_measurements` (`client_id`);
```

- [ ] **Step 3: Apply the migration locally and verify it parses.**

Run: `npx wrangler d1 migrations apply bodyatlas --local --config worker/wrangler.jsonc --persist-to app/.wrangler/state`
Expected: reports `0007_offline_client_id.sql` applied, no SQL error.

- [ ] **Step 4: Typecheck the worker.**

Run: `npm run typecheck --workspace worker`
Expected: PASS (the new `clientId` field is recognized).

- [ ] **Step 5: Commit.**

```bash
git add worker/src/db/schema.ts worker/migrations/0007_offline_client_id.sql
git commit -m "feat: add client_id idempotency column to offline-queued tables"
```

---

### Task 2: Shared schemas — accept optional `clientId`

**Files:**
- Modify: `shared/src/health.ts`
- Modify: `shared/src/workout.ts`
- Test: `shared/src/health.test.ts`, `shared/src/workout.test.ts`

- [ ] **Step 1: Write failing tests** asserting `clientId` is accepted and validated as a UUID. Append to `shared/src/health.test.ts`:

```ts
import { mealInputSchema } from './health';

test('mealInputSchema accepts a uuid clientId', () => {
  const r = mealInputSchema.safeParse({ name: 'Eggs', clientId: '11111111-1111-1111-1111-111111111111' });
  expect(r.success).toBe(true);
});

test('mealInputSchema rejects a non-uuid clientId', () => {
  const r = mealInputSchema.safeParse({ name: 'Eggs', clientId: 'not-a-uuid' });
  expect(r.success).toBe(false);
});

test('mealInputSchema still accepts no clientId', () => {
  expect(mealInputSchema.safeParse({ name: 'Eggs' }).success).toBe(true);
});
```

Append to `shared/src/workout.test.ts`:

```ts
import { setInputSchema } from './workout';

test('setInputSchema accepts a uuid clientId', () => {
  const r = setInputSchema.safeParse({ reps: 5, clientId: '11111111-1111-1111-1111-111111111111' });
  expect(r.success).toBe(true);
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `npm test --workspace shared`
Expected: FAIL (the `clientId` key is stripped, so the uuid-reject test fails / type is absent).

- [ ] **Step 3: Add `clientId` to the schemas.** In `shared/src/health.ts`, add `clientId: z.string().uuid().optional(),` to `mealInputSchema` (object body), and to the `.object({...})` inside both `sleepInputSchema` and `measurementInputSchema` (add it to the object passed before `.refine(...)`). Example for meal:

```ts
export const mealInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eatenAt: isoDateString.optional(),
  calories: z.number().int().min(0).max(10000).optional(),
  proteinG: z.number().min(0).max(1000).optional(),
  fatG: z.number().min(0).max(1000).optional(),
  carbsG: z.number().min(0).max(1000).optional(),
  notes: z.string().trim().max(500).optional(),
  clientId: z.string().uuid().optional(),
});
```

In `shared/src/workout.ts`, add `clientId: z.string().uuid().optional(),` to the object inside `setInputSchema` (before its `.refine(...)`).

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `npm test --workspace shared`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add shared/src/health.ts shared/src/workout.ts shared/src/health.test.ts shared/src/workout.test.ts
git commit -m "feat: accept optional clientId on offline-queued input schemas"
```

---

### Task 3: Idempotent upsert in the four covered POST handlers

**Files:**
- Modify: `worker/src/routes/meals.ts`, `worker/src/routes/sleep.ts`, `worker/src/routes/measurements.ts`, `worker/src/routes/workouts.ts`
- Test: `worker/test/offline-idempotency.test.ts`

The pattern for every handler: if `clientId` is present, look for an existing row owned by the user with that `clientId`; if found, return it with status 200 (idempotent no-op). Otherwise insert (now including `clientId`), relying on the unique index as the race guard, and return 201.

- [ ] **Step 1: Write failing tests.** Create `worker/test/offline-idempotency.test.ts`. Use the existing test harness — copy the auth/login setup from `worker/test/meals.test.ts` (read it for the `loginAs`/cookie helper and the `app` import). One representative test per endpoint:

```ts
import { describe, expect, it } from 'vitest';
import { app } from '../src';
import { authedRequest } from './helpers'; // use whatever meals.test.ts uses to send authed requests

describe('offline idempotency', () => {
  it('POST /api/meals with a repeated clientId creates exactly one row', async () => {
    const clientId = '22222222-2222-2222-2222-222222222222';
    const body = { name: 'Oats', clientId };

    const first = await authedRequest('POST', '/api/meals', body);
    expect(first.status).toBe(201);
    const second = await authedRequest('POST', '/api/meals', body);
    expect(second.status).toBe(200);

    const firstRow = await first.json();
    const secondRow = await second.json();
    expect(secondRow.id).toBe(firstRow.id); // same row, not a duplicate

    const list = await (await authedRequest('GET', '/api/meals')).json();
    expect(list.filter((m: { name: string }) => m.name === 'Oats')).toHaveLength(1);
  });

  it('POST /api/measurements with a repeated clientId creates exactly one row', async () => {
    const clientId = '33333333-3333-3333-3333-333333333333';
    const body = { weightKg: 70, clientId };
    const first = await authedRequest('POST', '/api/measurements', body);
    const second = await authedRequest('POST', '/api/measurements', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe((await first.json()).id);
  });

  it('POST /api/sleep with a repeated clientId creates exactly one row', async () => {
    const clientId = '44444444-4444-4444-4444-444444444444';
    const body = {
      bedAt: '2026-06-12T23:00:00.000Z',
      wokeAt: '2026-06-13T07:00:00.000Z',
      clientId,
    };
    const first = await authedRequest('POST', '/api/sleep', body);
    const second = await authedRequest('POST', '/api/sleep', body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((await second.json()).id).toBe((await first.json()).id);
  });
});
```

> NOTE: match the exact request helper and login flow used in `worker/test/meals.test.ts` / `worker/test/helpers.ts`. If those expose a different shape (e.g. a `client` or `loginAndPost` helper), adapt the calls but keep the assertions (201 then 200, same `id`, one row). For the set endpoint, drive it through the existing workout-creation helper from `worker/test/workouts.test.ts` to obtain a `workoutId`/`weId`, then POST the same set body with a `clientId` twice and assert 201 then 200 with the same `id`.

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `npm test --workspace worker -- offline-idempotency`
Expected: FAIL (second POST returns 201 and creates a duplicate).

- [ ] **Step 3: Implement the meal handler.** In `worker/src/routes/meals.ts`, replace the `POST /` handler body:

```ts
  .post('/', validateMeal, async (c) => {
    const db = getDb(c.env.DB);
    const input = c.req.valid('json');
    if (input.clientId) {
      const dup = await db.query.meals.findFirst({
        where: and(eq(schema.meals.userId, c.get('userId')), eq(schema.meals.clientId, input.clientId)),
      });
      if (dup) return c.json(dup, 200);
    }
    const id = crypto.randomUUID();
    await db
      .insert(schema.meals)
      .values({ id, userId: c.get('userId'), clientId: input.clientId ?? null, ...toRow(input) })
      .onConflictDoNothing({ target: schema.meals.clientId });
    const created = await db.query.meals.findFirst({
      where: input.clientId
        ? and(eq(schema.meals.userId, c.get('userId')), eq(schema.meals.clientId, input.clientId))
        : eq(schema.meals.id, id),
    });
    return c.json(created, 201);
  })
```

(The pre-select returns the existing row with 200; the `onConflictDoNothing` + post-select closes the race where two replays arrive nearly simultaneously.)

- [ ] **Step 4: Implement the measurement and sleep handlers** with the identical shape. In `worker/src/routes/measurements.ts`, the `POST /` handler — use `schema.bodyMeasurements`, its `toRow`/insert values, and `eq(schema.bodyMeasurements.clientId, input.clientId)`. In `worker/src/routes/sleep.ts`, the `POST /` handler — use `schema.sleepRecords` and `eq(schema.sleepRecords.clientId, input.clientId)`. In both, add `clientId: input.clientId ?? null` to the inserted values and `.onConflictDoNothing({ target: schema.<table>.clientId })`, return the duplicate with 200 and the created row with 201. (Read each file first to mirror its existing `toRow`/values construction and the `validate` import.)

- [ ] **Step 5: Implement the set handler.** In `worker/src/routes/workouts.ts`, the `POST '/:id/exercises/:weId/sets'` handler. After resolving `we` (keep the 404 check) and reading `input = c.req.valid('json')`, add the dup check and `clientId` to the inserted `set`:

```ts
      const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
      if (!we) return c.json(notFound, 404);
      const input = c.req.valid('json');
      if (input.clientId) {
        const dup = await db.query.sets.findFirst({ where: eq(schema.sets.clientId, input.clientId) });
        if (dup) return c.json(dup, 200);
      }
      const last = await db
        .select({ position: schema.sets.position })
        .from(schema.sets)
        .where(eq(schema.sets.workoutExerciseId, we.id))
        .orderBy(desc(schema.sets.position))
        .limit(1);
      const set = {
        id: crypto.randomUUID(),
        workoutExerciseId: we.id,
        clientId: input.clientId ?? null,
        position: (last[0]?.position ?? 0) + 1,
        weightKg: input.weightKg ?? null,
        reps: input.reps ?? null,
        rpe: input.rpe ?? null,
        durationSec: input.durationSec ?? null,
        distanceM: input.distanceM ?? null,
        note: input.note ?? null,
      };
      await db.insert(schema.sets).values(set).onConflictDoNothing({ target: schema.sets.clientId });
      return c.json(set, 201);
```

(`sets` ownership is already enforced via `we`; `clientId` is globally unique, so the dup lookup does not need a user join, but the prior `we` check still gates creation.)

- [ ] **Step 6: Run the tests to confirm they pass.**

Run: `npm test --workspace worker -- offline-idempotency`
Expected: PASS.

- [ ] **Step 7: Run the full worker suite** to confirm no regressions in the existing meal/sleep/measurement/set tests.

Run: `npm test --workspace worker`
Expected: PASS (all prior tests plus the new ones).

- [ ] **Step 8: Commit.**

```bash
git add worker/src/routes/ worker/test/offline-idempotency.test.ts
git commit -m "feat: idempotent upsert by clientId on offline-queued POST routes"
```

---

### Task 4: Offline queue core — types, memory store, OfflineQueue

**Files:**
- Create: `app/src/lib/offline/types.ts`, `app/src/lib/offline/memory-store.ts`, `app/src/lib/offline/queue.ts`
- Test: `app/src/lib/offline/queue.test.ts`

- [ ] **Step 1: Define the types.** Create `app/src/lib/offline/types.ts`:

```ts
export type OpKind = 'meal' | 'measurement' | 'sleep' | 'set';

export interface SetContext {
  workoutId: string;
  weId: string;
}

export interface QueuedOp {
  id: string; // UUID — also the server clientId
  kind: OpKind;
  payload: Record<string, unknown>; // request body, already including clientId
  context?: SetContext; // present only for kind === 'set'
  createdAt: string; // ISO
  status: 'pending' | 'failed';
  error?: string;
}

/** Async persistence backend for the queue. */
export interface QueueStore {
  list(): Promise<QueuedOp[]>;
  put(op: QueuedOp): Promise<void>;
  remove(id: string): Promise<void>;
}
```

- [ ] **Step 2: Implement the in-memory store.** Create `app/src/lib/offline/memory-store.ts`:

```ts
import type { QueuedOp, QueueStore } from './types';

/** Volatile QueueStore for tests and as a fallback when IndexedDB is unavailable. */
export class MemoryQueueStore implements QueueStore {
  private ops: QueuedOp[] = [];

  async list(): Promise<QueuedOp[]> {
    return this.ops.map((op) => ({ ...op }));
  }

  async put(op: QueuedOp): Promise<void> {
    const i = this.ops.findIndex((o) => o.id === op.id);
    if (i >= 0) this.ops[i] = { ...op };
    else this.ops.push({ ...op });
  }

  async remove(id: string): Promise<void> {
    this.ops = this.ops.filter((o) => o.id !== id);
  }
}
```

- [ ] **Step 3: Write failing tests for OfflineQueue.** Create `app/src/lib/offline/queue.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';

describe('OfflineQueue', () => {
  let queue: OfflineQueue;
  beforeEach(async () => {
    queue = new OfflineQueue(new MemoryQueueStore());
    await queue.load();
  });

  it('enqueue adds a pending op with a uuid id and exposes it in the snapshot', async () => {
    const op = await queue.enqueue('meal', { name: 'Eggs' });
    expect(op.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(op.kind).toBe('meal');
    expect(op.status).toBe('pending');
    expect(op.payload.clientId).toBe(op.id); // clientId injected into payload
    expect(queue.getSnapshot()).toHaveLength(1);
  });

  it('enqueue with set context stores it', async () => {
    const op = await queue.enqueue('set', { reps: 5 }, { workoutId: 'w1', weId: 'we1' });
    expect(op.context).toEqual({ workoutId: 'w1', weId: 'we1' });
  });

  it('notifies subscribers on change and returns a stable snapshot between changes', async () => {
    const seen = vi.fn();
    queue.subscribe(seen);
    const before = queue.getSnapshot();
    expect(queue.getSnapshot()).toBe(before); // referentially stable
    await queue.enqueue('meal', { name: 'Eggs' });
    expect(seen).toHaveBeenCalled();
    expect(queue.getSnapshot()).not.toBe(before);
  });

  it('remove deletes the op; markFailed flips status and records the error', async () => {
    const op = await queue.enqueue('meal', { name: 'Eggs' });
    await queue.markFailed(op.id, 'API error 422');
    expect(queue.getSnapshot()[0].status).toBe('failed');
    expect(queue.getSnapshot()[0].error).toBe('API error 422');
    await queue.remove(op.id);
    expect(queue.getSnapshot()).toHaveLength(0);
  });

  it('load() rehydrates the snapshot from the store (survives a reload)', async () => {
    const store = new MemoryQueueStore();
    const q1 = new OfflineQueue(store);
    await q1.load();
    await q1.enqueue('sleep', { bedAt: 'a', wokeAt: 'b' });
    const q2 = new OfflineQueue(store);
    await q2.load();
    expect(q2.getSnapshot()).toHaveLength(1);
  });
});
```

- [ ] **Step 2-verify: Run the tests to confirm they fail.**

Run: `npm test --workspace app -- offline/queue`
Expected: FAIL (`OfflineQueue` not defined).

- [ ] **Step 4: Implement OfflineQueue.** Create `app/src/lib/offline/queue.ts`:

```ts
import type { OpKind, QueuedOp, QueueStore, SetContext } from './types';

/**
 * In-memory mirror of the persisted queue with a subscribe API, suitable for
 * useSyncExternalStore. getSnapshot returns a referentially stable array that
 * only changes identity when the queue changes.
 */
export class OfflineQueue {
  private ops: QueuedOp[] = [];
  private snapshot: QueuedOp[] = [];
  private listeners = new Set<() => void>();

  constructor(private readonly store: QueueStore) {}

  /** Load persisted ops into the in-memory mirror. Call once at startup. */
  async load(): Promise<void> {
    this.ops = await this.store.list();
    this.refresh();
  }

  async enqueue(kind: OpKind, payload: Record<string, unknown>, context?: SetContext): Promise<QueuedOp> {
    const id = crypto.randomUUID();
    const op: QueuedOp = {
      id,
      kind,
      payload: { ...payload, clientId: id },
      ...(context ? { context } : {}),
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    await this.store.put(op);
    this.ops.push(op);
    this.refresh();
    return op;
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
    this.ops = this.ops.filter((o) => o.id !== id);
    this.refresh();
  }

  async markFailed(id: string, error: string): Promise<void> {
    const op = this.ops.find((o) => o.id === id);
    if (!op) return;
    const updated: QueuedOp = { ...op, status: 'failed', error };
    await this.store.put(updated);
    this.ops = this.ops.map((o) => (o.id === id ? updated : o));
    this.refresh();
  }

  /** Ops still awaiting a successful flush (status === 'pending'), FIFO order. */
  pending(): QueuedOp[] {
    return this.ops.filter((o) => o.status === 'pending');
  }

  getSnapshot(): QueuedOp[] {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private refresh(): void {
    this.snapshot = this.ops.map((o) => ({ ...o }));
    for (const l of this.listeners) l();
  }
}
```

- [ ] **Step 5: Run the tests to confirm they pass.**

Run: `npm test --workspace app -- offline/queue`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/src/lib/offline/types.ts app/src/lib/offline/memory-store.ts app/src/lib/offline/queue.ts app/src/lib/offline/queue.test.ts
git commit -m "feat: offline queue core with subscribable in-memory mirror"
```

---

### Task 5: IndexedDB-backed store

**Files:**
- Create: `app/src/lib/offline/idb-store.ts`
- Test: `app/src/lib/offline/idb-store.test.ts`
- Modify: `app/package.json` (add `fake-indexeddb` dev dependency)

- [ ] **Step 1: Add the test-only IndexedDB shim.**

Run: `npm install -D fake-indexeddb --workspace app`
Expected: `fake-indexeddb` (Apache-2.0) added to `app/package.json` devDependencies.

- [ ] **Step 2: Write failing tests.** Create `app/src/lib/offline/idb-store.test.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { IdbQueueStore } from './idb-store';
import type { QueuedOp } from './types';

const op = (id: string): QueuedOp => ({
  id,
  kind: 'meal',
  payload: { name: 'Eggs', clientId: id },
  createdAt: '2026-06-13T00:00:00.000Z',
  status: 'pending',
});

describe('IdbQueueStore', () => {
  beforeEach(() => {
    // fresh database name per run keeps tests isolated
    indexedDB.deleteDatabase('bodyatlas-offline');
  });

  it('persists, lists, and removes ops', async () => {
    const store = new IdbQueueStore();
    await store.put(op('a'));
    await store.put(op('b'));
    expect((await store.list()).map((o) => o.id).sort()).toEqual(['a', 'b']);
    await store.remove('a');
    expect((await store.list()).map((o) => o.id)).toEqual(['b']);
  });

  it('put overwrites an existing op by id', async () => {
    const store = new IdbQueueStore();
    await store.put(op('a'));
    await store.put({ ...op('a'), status: 'failed', error: 'x' });
    const [row] = await store.list();
    expect(row.status).toBe('failed');
  });

  it('a fresh store instance sees previously persisted ops (survives reload)', async () => {
    await new IdbQueueStore().put(op('a'));
    const reopened = new IdbQueueStore();
    expect((await reopened.list())).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Run the tests to confirm they fail.**

Run: `npm test --workspace app -- offline/idb-store`
Expected: FAIL (`IdbQueueStore` not defined).

- [ ] **Step 4: Implement the hand-rolled IndexedDB store.** Create `app/src/lib/offline/idb-store.ts`:

```ts
import type { QueuedOp, QueueStore } from './types';

const DB_NAME = 'bodyatlas-offline';
const STORE = 'operations';
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/** IndexedDB-backed QueueStore. Each method opens, transacts, and closes. */
export class IdbQueueStore implements QueueStore {
  async list(): Promise<QueuedOp[]> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readonly');
      return (await promisify(tx.objectStore(STORE).getAll())) as QueuedOp[];
    } finally {
      db.close();
    }
  }

  async put(op: QueuedOp): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await promisify(tx.objectStore(STORE).put(op));
    } finally {
      db.close();
    }
  }

  async remove(id: string): Promise<void> {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      await promisify(tx.objectStore(STORE).delete(id));
    } finally {
      db.close();
    }
  }
}
```

- [ ] **Step 5: Run the tests to confirm they pass.**

Run: `npm test --workspace app -- offline/idb-store`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/src/lib/offline/idb-store.ts app/src/lib/offline/idb-store.test.ts app/package.json package-lock.json
git commit -m "feat: indexeddb-backed offline queue store"
```

---

### Task 6: Connectivity module

**Files:**
- Create: `app/src/lib/offline/connectivity.ts`
- Test: `app/src/lib/offline/connectivity.test.ts`

- [ ] **Step 1: Write failing tests.** Create `app/src/lib/offline/connectivity.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOnline, onOnline } from './connectivity';

describe('connectivity', () => {
  afterEach(() => vi.restoreAllMocks());

  it('isOnline reflects navigator.onLine', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnvalue(false);
    expect(isOnline()).toBe(false);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnvalue(true);
    expect(isOnline()).toBe(true);
  });

  it('onOnline fires the callback on an online event and unsubscribes', () => {
    const cb = vi.fn();
    const off = onOnline(cb);
    window.dispatchEvent(new Event('online'));
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    window.dispatchEvent(new Event('online'));
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `npm test --workspace app -- offline/connectivity`
Expected: FAIL (`connectivity` not defined).

- [ ] **Step 3: Implement.** Create `app/src/lib/offline/connectivity.ts`:

```ts
/** True when the browser believes it has a network connection. */
export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Subscribe to 'came back online' transitions. Returns an unsubscribe fn. */
export function onOnline(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener('online', handler);
  return () => window.removeEventListener('online', handler);
}

/**
 * Classify a thrown mutation error as an offline/network failure (enqueue) vs a
 * real HTTP error (surface). expectOk throws `Error('API error <status>')` for
 * HTTP responses; a network failure throws a TypeError before that. So: a
 * TypeError, or any error while navigator is offline, is treated as offline.
 */
export function isOfflineError(err: unknown): boolean {
  if (!isOnline()) return true;
  return err instanceof TypeError;
}
```

- [ ] **Step 4: Add a failing test for `isOfflineError`** to the same file:

```ts
import { isOfflineError } from './connectivity';

it('isOfflineError treats a TypeError as offline and an HTTP error as not', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnvalue(true);
  expect(isOfflineError(new TypeError('Failed to fetch'))).toBe(true);
  expect(isOfflineError(new Error('API error 422'))).toBe(false);
});

it('isOfflineError treats any error as offline when navigator is offline', () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnvalue(false);
  expect(isOfflineError(new Error('API error 500'))).toBe(true);
});
```

- [ ] **Step 5: Run the tests to confirm they pass** (implementation from Step 3 already satisfies them).

Run: `npm test --workspace app -- offline/connectivity`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add app/src/lib/offline/connectivity.ts app/src/lib/offline/connectivity.test.ts
git commit -m "feat: connectivity detection and offline-error classifier"
```

---

### Task 7: Senders + flush worker

**Files:**
- Create: `app/src/lib/offline/senders.ts`, `app/src/lib/offline/flush.ts`
- Test: `app/src/lib/offline/flush.test.ts`

The flush worker is pure with respect to the network: it takes a `sender` function so it can be tested without `fetch`. The real `senders.ts` adapts each op kind to a hono-client call.

- [ ] **Step 1: Write failing tests for the flush worker.** Create `app/src/lib/offline/flush.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { flushQueue } from './flush';
import type { SendResult } from './flush';

async function queueWith(n: number): Promise<OfflineQueue> {
  const q = new OfflineQueue(new MemoryQueueStore());
  await q.load();
  for (let i = 0; i < n; i++) await q.enqueue('meal', { name: `m${i}` });
  return q;
}

const ok: SendResult = { ok: true, status: 201 };

describe('flushQueue', () => {
  it('drains all ops FIFO on success and clears the queue', async () => {
    const q = await queueWith(3);
    const order: string[] = [];
    const send = vi.fn(async (op) => {
      order.push(op.payload.name as string);
      return ok;
    });
    const result = await flushQueue(q, send);
    expect(order).toEqual(['m0', 'm1', 'm2']);
    expect(q.pending()).toHaveLength(0);
    expect(result.flushed).toBe(3);
  });

  it('dead-letters a 4xx op and keeps draining the rest', async () => {
    const q = await queueWith(2);
    const send = vi.fn(async (op) =>
      (op.payload.name === 'm0' ? { ok: false, status: 422 } : ok),
    );
    const result = await flushQueue(q, send);
    expect(q.pending()).toHaveLength(0); // m1 flushed
    expect(q.getSnapshot().filter((o) => o.status === 'failed')).toHaveLength(1); // m0 dead-lettered
    expect(result.failed).toBe(1);
    expect(result.flushed).toBe(1);
  });

  it('stops on a network error and retains the unsent ops', async () => {
    const q = await queueWith(3);
    const send = vi.fn(async (op) => {
      if (op.payload.name === 'm1') throw new TypeError('Failed to fetch');
      return ok;
    });
    const result = await flushQueue(q, send);
    expect(result.stoppedReason).toBe('network');
    expect(q.pending().map((o) => o.payload.name)).toEqual(['m1', 'm2']); // m0 removed, m1/m2 retained
  });

  it('stops on 401 and retains the ops', async () => {
    const q = await queueWith(2);
    const send = vi.fn(async () => ({ ok: false, status: 401 }) as SendResult);
    const result = await flushQueue(q, send);
    expect(result.stoppedReason).toBe('auth');
    expect(q.pending()).toHaveLength(2);
  });

  it('is a no-op when there is nothing pending', async () => {
    const q = await queueWith(0);
    const send = vi.fn();
    const result = await flushQueue(q, send);
    expect(send).not.toHaveBeenCalled();
    expect(result.flushed).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail.**

Run: `npm test --workspace app -- offline/flush`
Expected: FAIL (`flushQueue` not defined).

- [ ] **Step 3: Implement the flush worker.** Create `app/src/lib/offline/flush.ts`:

```ts
import type { OfflineQueue } from './queue';
import type { QueuedOp } from './types';

export interface SendResult {
  ok: boolean;
  status: number;
}

export type Sender = (op: QueuedOp) => Promise<SendResult>;

export interface FlushResult {
  flushed: number;
  failed: number;
  stoppedReason?: 'network' | 'auth';
}

/**
 * Drain the queue's pending ops FIFO.
 * - 2xx        -> remove the op
 * - 401        -> stop; retain remaining ops (session expired)
 * - other 4xx/5xx -> dead-letter the op (markFailed) and continue
 * - thrown error  -> network failure; stop and retain remaining ops
 */
export async function flushQueue(queue: OfflineQueue, send: Sender): Promise<FlushResult> {
  let flushed = 0;
  let failed = 0;
  for (const op of queue.pending()) {
    let result: SendResult;
    try {
      result = await send(op);
    } catch {
      return { flushed, failed, stoppedReason: 'network' };
    }
    if (result.ok) {
      await queue.remove(op.id);
      flushed++;
    } else if (result.status === 401) {
      return { flushed, failed, stoppedReason: 'auth' };
    } else {
      await queue.markFailed(op.id, `API error ${result.status}`);
      failed++;
    }
  }
  return { flushed, failed };
}
```

- [ ] **Step 4: Run the tests to confirm they pass.**

Run: `npm test --workspace app -- offline/flush`
Expected: PASS.

- [ ] **Step 5: Implement the real senders.** Create `app/src/lib/offline/senders.ts`:

```ts
import { api } from '../api';
import type { QueuedOp } from './types';
import type { SendResult } from './flush';

/**
 * Replay a queued op against the API, carrying its clientId (already in payload).
 * Returns { ok, status }; lets network errors throw so flushQueue can stop.
 */
export async function sendOp(op: QueuedOp): Promise<SendResult> {
  const res = await callFor(op);
  return { ok: res.ok, status: res.status };
}

function callFor(op: QueuedOp) {
  switch (op.kind) {
    case 'meal':
      return api.meals.$post({ json: op.payload });
    case 'sleep':
      return api.sleep.$post({ json: op.payload });
    case 'measurement':
      return api.measurements.$post({ json: op.payload });
    case 'set': {
      const ctx = op.context;
      if (!ctx) throw new Error('set op missing workout context');
      return api.workouts[':id'].exercises[':weId'].sets.$post({
        param: { id: ctx.workoutId, weId: ctx.weId },
        json: op.payload,
      });
    }
  }
}
```

> NOTE: the hono client's `$post` typings expect the validated input shape; `op.payload` is `Record<string, unknown>`. If `tsc` rejects the json argument, cast at THIS boundary only — `json: op.payload as never` is acceptable here because the queue payload is intentionally untyped storage and the server re-validates. Do not add casts anywhere else. Confirm with `npm run typecheck --workspace app` and prefer no cast if the call compiles.

- [ ] **Step 6: Commit.**

```bash
git add app/src/lib/offline/flush.ts app/src/lib/offline/flush.test.ts app/src/lib/offline/senders.ts
git commit -m "feat: offline flush worker and api senders"
```

---

### Task 8: Singleton wiring + start() controller

**Files:**
- Create: `app/src/lib/offline/index.ts`
- Test: `app/src/lib/offline/index.test.ts`

- [ ] **Step 1: Write a failing test** for the controller's flush-on-online behavior. Create `app/src/lib/offline/index.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { createController } from './index';

describe('offline controller', () => {
  afterEach(() => vi.restoreAllMocks());

  it('flushes pending ops when an online event fires', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const queue = new OfflineQueue(new MemoryQueueStore());
    await queue.load();
    await queue.enqueue('meal', { name: 'Eggs' });
    const send = vi.fn(async () => ({ ok: true, status: 201 }));

    const controller = createController(queue, send);
    await controller.start(); // initial flush since online
    expect(queue.pending()).toHaveLength(0);

    await queue.enqueue('meal', { name: 'Toast' });
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(queue.pending()).toHaveLength(0));

    controller.stop();
  });

  it('does not flush on start when offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const queue = new OfflineQueue(new MemoryQueueStore());
    await queue.load();
    await queue.enqueue('meal', { name: 'Eggs' });
    const send = vi.fn(async () => ({ ok: true, status: 201 }));
    const controller = createController(queue, send);
    await controller.start();
    expect(send).not.toHaveBeenCalled();
    controller.stop();
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

Run: `npm test --workspace app -- offline/index`
Expected: FAIL (`createController` not defined).

- [ ] **Step 3: Implement the controller + singleton.** Create `app/src/lib/offline/index.ts`:

```ts
import { isOnline, onOnline } from './connectivity';
import { flushQueue, type Sender } from './flush';
import { IdbQueueStore } from './idb-store';
import { MemoryQueueStore } from './memory-store';
import { OfflineQueue } from './queue';
import { sendOp } from './senders';

export { OfflineQueue } from './queue';
export type { QueuedOp, OpKind } from './types';

/** The app-wide queue. IndexedDB when available, memory as a fallback. */
function makeStore() {
  return typeof indexedDB !== 'undefined' ? new IdbQueueStore() : new MemoryQueueStore();
}

export const offlineQueue = new OfflineQueue(makeStore());

export interface Controller {
  start(): Promise<void>;
  stop(): void;
  flushNow(): Promise<void>;
}

/** Wire a queue to connectivity: flush on start (if online) and on reconnect. */
export function createController(queue: OfflineQueue, send: Sender): Controller {
  let off: (() => void) | undefined;
  let running = false;

  const flush = async () => {
    if (running || !isOnline()) return;
    running = true;
    try {
      await flushQueue(queue, send);
    } finally {
      running = false;
    }
  };

  return {
    async start() {
      off = onOnline(() => void flush());
      await flush();
    },
    stop() {
      off?.();
      off = undefined;
    },
    flushNow: flush,
  };
}

/** Default controller bound to the app singleton queue + real senders. */
export const offlineController = createController(offlineQueue, sendOp);
```

- [ ] **Step 4: Run the test to confirm it passes.**

Run: `npm test --workspace app -- offline/index`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add app/src/lib/offline/index.ts app/src/lib/offline/index.test.ts
git commit -m "feat: offline controller wiring flush to connectivity"
```

---

### Task 9: Wrap the covered mutation hooks

**Files:**
- Modify: `app/src/lib/health.ts` (`useCreateMeal`, `useCreateSleep`, `useCreateMeasurement`)
- Modify: `app/src/lib/train.ts` (`useLogSet`)
- Test: `app/src/lib/offline-hooks.test.tsx`

Each covered hook keeps its online path but, on an offline error, enqueues and resolves successfully (so the UI proceeds), returning a provisional marker.

- [ ] **Step 1: Write a failing test** proving an offline meal create enqueues instead of throwing. Create `app/src/lib/offline-hooks.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { offlineQueue } from './offline';
import { useCreateMeal } from './health';
import { api } from './api';

function wrapper({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCreateMeal offline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enqueues the meal when the network throws and resolves successfully', async () => {
    await offlineQueue.load();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    vi.spyOn(api.meals, '$post').mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useCreateMeal(), { wrapper });
    await result.current.mutateAsync({ name: 'Eggs' });

    await waitFor(() =>
      expect(offlineQueue.pending().some((o) => o.kind === 'meal')).toBe(true),
    );
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails.**

Run: `npm test --workspace app -- offline-hooks`
Expected: FAIL (the mutation rejects instead of enqueueing).

- [ ] **Step 3: Add an enqueue helper, then wrap each hook.** In `app/src/lib/health.ts`, add imports at the top:

```ts
import { offlineQueue } from './offline';
import { isOfflineError } from './offline/connectivity';
import type { OpKind } from './offline';
```

Add a module-level helper:

```ts
/** Run an online mutation; on an offline error, enqueue and resolve as queued. */
async function withOfflineFallback<T>(
  online: () => Promise<T>,
  kind: OpKind,
  payload: Record<string, unknown>,
): Promise<T | { queued: true; id: string }> {
  try {
    return await online();
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    const op = await offlineQueue.enqueue(kind, payload);
    return { queued: true, id: op.id };
  }
}
```

Rewrite `useCreateMeal`'s `mutationFn`:

```ts
    mutationFn: (input: MealInput) =>
      withOfflineFallback(
        () => expectOk<CreatedMeal>(api.meals.$post({ json: input })),
        'meal',
        input as Record<string, unknown>,
      ),
```

Apply the same wrapping to `useCreateSleep` (kind `'sleep'`) and `useCreateMeasurement` (kind `'measurement'`), passing each hook's `input` as the payload. Leave their `onSuccess` invalidations as-is (a no-op while offline).

- [ ] **Step 4: Wrap `useLogSet`.** In `app/src/lib/train.ts`, add the same three imports. Rewrite `useLogSet`'s `mutationFn` to pass the set context:

```ts
    mutationFn: (input: SetInput) =>
      withOfflineFallbackSet(
        () =>
          expectOk(
            api.workouts[':id'].exercises[':weId'].sets.$post({
              param: { id: workoutId, weId },
              json: input,
            }),
          ),
        input as Record<string, unknown>,
        { workoutId, weId },
      ),
```

Add the set-aware helper in `train.ts` (it threads `context`):

```ts
import { offlineQueue } from './offline';
import { isOfflineError } from './offline/connectivity';
import type { SetContext } from './offline/types';

async function withOfflineFallbackSet<T>(
  online: () => Promise<T>,
  payload: Record<string, unknown>,
  context: SetContext,
): Promise<T | { queued: true; id: string }> {
  try {
    return await online();
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    const op = await offlineQueue.enqueue('set', payload, context);
    return { queued: true, id: op.id };
  }
}
```

- [ ] **Step 5: Run the test to confirm it passes.**

Run: `npm test --workspace app -- offline-hooks`
Expected: PASS.

- [ ] **Step 6: Run the full app suite** to confirm no regression in existing hook/sheet tests.

Run: `npm test --workspace app`
Expected: PASS.

- [ ] **Step 7: Commit.**

```bash
git add app/src/lib/health.ts app/src/lib/train.ts app/src/lib/offline-hooks.test.tsx
git commit -m "feat: queue covered mutations on offline error"
```

---

### Task 10: Pending UI — hook, badge, indicator, and list merging

**Files:**
- Create: `app/src/lib/offline/usePendingOps.ts`, `app/src/components/PendingBadge.tsx`, `app/src/components/OfflineIndicator.tsx`
- Modify: `app/src/pages/HealthPage.tsx`, `app/src/pages/SessionPage.tsx`, `app/src/components/AppLayout.tsx`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`
- Test: `app/src/components/OfflineIndicator.test.tsx`

- [ ] **Step 1: Implement the reactive hook.** Create `app/src/lib/offline/usePendingOps.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { offlineQueue } from './index';
import type { OpKind, QueuedOp } from './types';

/** All queued ops (pending + failed), reactive to queue changes. */
export function useQueuedOps(): QueuedOp[] {
  return useSyncExternalStore(
    (cb) => offlineQueue.subscribe(cb),
    () => offlineQueue.getSnapshot(),
    () => offlineQueue.getSnapshot(),
  );
}

/** Queued ops of one kind. */
export function useQueuedOpsByKind(kind: OpKind): QueuedOp[] {
  return useQueuedOps().filter((o) => o.kind === kind);
}
```

- [ ] **Step 2: Implement the per-item badge.** Create `app/src/components/PendingBadge.tsx`:

```tsx
import { useI18n } from '../i18n';

/** Small marker shown on a not-yet-synced (or failed) provisional record. */
export function PendingBadge({ failed = false }: { failed?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 999,
        background: failed ? 'var(--negative)' : 'var(--surface-2)',
        color: failed ? 'var(--accent-contrast)' : 'var(--text-muted)',
      }}
    >
      {failed ? t('offline.failed') : t('offline.pending')}
    </span>
  );
}
```

- [ ] **Step 3: Write a failing test for the global indicator.** Create `app/src/components/OfflineIndicator.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { OfflineIndicator } from './OfflineIndicator';
import { offlineQueue } from '../lib/offline';

function renderIndicator() {
  return render(
    <I18nProvider locale="en">
      <OfflineIndicator />
    </I18nProvider>,
  );
}

describe('OfflineIndicator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is hidden when online with nothing pending', async () => {
    await offlineQueue.load();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { container } = renderIndicator();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a pending count when ops are queued', async () => {
    await offlineQueue.load();
    await offlineQueue.enqueue('meal', { name: 'Eggs' });
    renderIndicator();
    expect(await screen.findByText(/1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails.**

Run: `npm test --workspace app -- OfflineIndicator`
Expected: FAIL (`OfflineIndicator` not defined).

- [ ] **Step 5: Implement the indicator.** Create `app/src/components/OfflineIndicator.tsx`:

```tsx
import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n';
import { isOnline } from '../lib/offline/connectivity';
import { useQueuedOps } from '../lib/offline/usePendingOps';

function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => isOnline(),
    () => true,
  );
}

/** Compact banner: shows offline state and how many writes are waiting to sync. */
export function OfflineIndicator() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const pending = useQueuedOps().filter((o) => o.status === 'pending').length;

  if (online && pending === 0) return null;

  const label = !online
    ? `${t('offline.offline')}${pending ? ` · ${t('offline.pendingCount').replace('{n}', String(pending))}` : ''}`
    : t('offline.pendingCount').replace('{n}', String(pending));

  return (
    <div
      role="status"
      style={{
        fontSize: 12,
        textAlign: 'center',
        padding: '4px 8px',
        background: 'var(--surface-2)',
        color: 'var(--text-muted)',
      }}
    >
      {label}
    </div>
  );
}
```

- [ ] **Step 6: Add i18n strings.** In `app/src/i18n/en.ts` add:

```ts
  'offline.offline': 'Offline',
  'offline.pending': 'Pending sync',
  'offline.failed': 'Sync failed',
  'offline.pendingCount': '{n} waiting to sync',
```

In `app/src/i18n/ja.ts` add the parity keys:

```ts
  'offline.offline': 'オフライン',
  'offline.pending': '同期待ち',
  'offline.failed': '同期に失敗',
  'offline.pendingCount': '{n}件の同期待ち',
```

- [ ] **Step 7: Run the indicator test to confirm it passes** (and the i18n parity test stays green).

Run: `npm test --workspace app -- OfflineIndicator i18n`
Expected: PASS.

- [ ] **Step 8: Mount the indicator and start the controller.** In `app/src/components/AppLayout.tsx` (read it first), import and render `<OfflineIndicator />` at the top of the layout (above the routed `<Outlet />`), and start the controller once on mount:

```tsx
import { useEffect } from 'react';
import { OfflineIndicator } from './OfflineIndicator';
import { offlineController, offlineQueue } from '../lib/offline';

// inside the component, before the return:
  useEffect(() => {
    let active = true;
    void offlineQueue.load().then(() => {
      if (active) void offlineController.start();
    });
    return () => {
      active = false;
      offlineController.stop();
    };
  }, []);
```

Render `<OfflineIndicator />` just inside the layout's root element.

- [ ] **Step 9: Merge pending items into the health day lists.** In `app/src/pages/HealthPage.tsx` (read it first), for each of the meal/sleep/measurement sections, pull the matching pending ops and render them above the server rows with a `<PendingBadge />`. Example for meals (adapt to the file's actual JSX):

```tsx
import { useQueuedOpsByKind } from '../lib/offline/usePendingOps';
import { PendingBadge } from '../components/PendingBadge';

// within the meals section, before `{meals.map(...)}`:
const pendingMeals = useQueuedOpsByKind('meal');
// render:
{pendingMeals.map((op) => (
  <li key={op.id} style={{ opacity: 0.7, display: 'flex', justifyContent: 'space-between' }}>
    <span>{String(op.payload.name ?? '')}</span>
    <PendingBadge failed={op.status === 'failed'} />
  </li>
))}
```

Do the equivalent for sleep (label from `op.payload.bedAt`/`wokeAt`) and measurements (label from `op.payload.weightKg`/`bodyFatPct`), matching each section's existing row markup. Keep it minimal — a single provisional row per pending op with the badge.

- [ ] **Step 10: Merge pending sets into the active workout.** In `app/src/pages/SessionPage.tsx` (read it first), within each exercise's set list, render pending set ops whose `context.weId` matches that workout-exercise, with a `<PendingBadge />`:

```tsx
import { useQueuedOpsByKind } from '../lib/offline/usePendingOps';
import { PendingBadge } from '../components/PendingBadge';

const pendingSets = useQueuedOpsByKind('set');
// within an exercise block (weId in scope):
{pendingSets
  .filter((op) => op.context?.weId === weId)
  .map((op) => (
    <div key={op.id} style={{ opacity: 0.7, display: 'flex', gap: 8 }}>
      <span>{op.payload.reps ? `${op.payload.reps} reps` : '—'}</span>
      <PendingBadge failed={op.status === 'failed'} />
    </div>
  ))}
```

- [ ] **Step 11: Run the full app suite.**

Run: `npm test --workspace app`
Expected: PASS.

- [ ] **Step 12: Commit.**

```bash
git add app/src/lib/offline/usePendingOps.ts app/src/components/PendingBadge.tsx app/src/components/OfflineIndicator.tsx app/src/components/OfflineIndicator.test.tsx app/src/components/AppLayout.tsx app/src/pages/HealthPage.tsx app/src/pages/SessionPage.tsx app/src/i18n/en.ts app/src/i18n/ja.ts
git commit -m "feat: pending-sync UI — indicator, badges, and provisional list items"
```

---

### Task 11: Full gate + manual offline smoke

**Files:** none (verification only)

- [ ] **Step 1: Typecheck everything.**

Run: `npm run typecheck`
Expected: PASS across shared/worker/app.

- [ ] **Step 2: Run the full test suite.**

Run: `npm test`
Expected: PASS — shared (prior + new clientId tests), worker (prior + offline-idempotency), app (prior + offline modules + indicator).

- [ ] **Step 3: Build.**

Run: `npm run build`
Expected: clean build.

- [ ] **Step 4: Manual smoke (document the result in the PR/commit, not automated).** With `npm run dev`: open the app, sign in, then in DevTools set the network to Offline. Log a meal via the quick-log FAB → it appears with a "Pending sync" badge and the global indicator shows "Offline · 1 waiting to sync". Set the network back to Online → within a moment the badge clears and the meal persists (reload to confirm exactly one row, no duplicate). Repeat once more with the same item still queued across a page reload to confirm cross-reload hydration (the pending badge should reappear after reload while offline).

- [ ] **Step 5: Commit any final touch-ups, then finish the branch** with superpowers:finishing-a-development-branch.

---

## Plan self-review (authoring time)

- **Spec coverage:** Scope (4 covered writes incl. in-workout sets) → Tasks 3/9. Custom IndexedDB queue → Tasks 4/5. TanStack integration → Task 9. Server idempotency keys (migration + upsert) → Tasks 1/2/3. Flush worker with 2xx/4xx/401/network handling → Task 7. Per-item + global pending UX → Task 10. Cross-reload hydration → `OfflineQueue.load()` + Task 8 controller + Task 10 Step 8 (`offlineQueue.load()` on mount; the IndexedDB store persists ops; `usePendingOps` re-renders provisional items after reload). Testing matrix (pure queue/flush, idb adapter, worker idempotency, components) → Tasks 4–10. All spec sections map to a task.
- **Placeholder scan:** No "TBD"/"add error handling" placeholders; each code step shows complete code. Two explicit NOTEs flag where the implementer must mirror an existing test helper (Task 3) or confirm a single boundary cast (Task 7) — both name the exact file/line to check, not vague hand-waving.
- **Type consistency:** `QueuedOp`/`QueueStore`/`OpKind`/`SetContext` defined in Task 4 are used unchanged in Tasks 5–10. `SendResult`/`Sender`/`flushQueue` from Task 7 are consumed unchanged in Task 8. `offlineQueue`/`offlineController`/`createController` from Task 8 are imported unchanged in Tasks 9–10. `useQueuedOps`/`useQueuedOpsByKind` from Task 10 Step 1 are used in the same task's later steps. Hook names (`useCreateMeal`, `useCreateSleep`, `useCreateMeasurement`, `useLogSet`) match the real exports verified in `health.ts`/`train.ts`.
- **YAGNI:** No manual "retry failed op" UI, no offline edits/deletes, no background sync — all explicitly deferred in the spec.
```
