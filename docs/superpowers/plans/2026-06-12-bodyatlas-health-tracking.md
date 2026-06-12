# BodyAtlas Health Tracking Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete Health tab: meals with the implicit autocomplete library (calories + P/F/C vs targets), sleep records (bed/wake + quality), body measurements (weight + body fat %), a day-by-day view, nutrition-target editing in Settings, and the remaining three quick-log actions wired.

**Architecture:** Same shape as the workout domain. Migration 0004 adds three tables; three new `Hono<ProtectedEnv>` route modules; app hooks derive types via `InferResponseType`; UI follows the Athletic Glow treatment from day one. Day boundaries are computed CLIENT-side from the browser's local timezone (the user's device tz; from/to absolute ISO instants sent to the API — the server only filters absolute times).

**Conventions:** everything established in Plans 1–2c (TDD, error envelope, inline 422 hooks, reset-db, mockApi, glow-card/skeletons, TZ-explicit ISO datetimes, FULL-VALUE patch documented where used). Tests at start: 17 shared / 56 worker / 38 app.

**Spec:** `docs/superpowers/specs/2026-06-12-bodyatlas-design.md` (Health domain + screens).

## Domain decisions locked in this plan

- **Meal library is implicit:** `GET /api/meals/search?q=` returns the user's past meals deduped by name (latest row per name wins for nutrition values), favorites first, limit 20. A "name" is favorite if ANY row with that name has `is_favorite = 1`; toggling favorites flips the flag on the specific row returned by search.
- **Meal edit is full-replace** with the same input schema as create (mirrors set-edit semantics). Favorite toggling is a separate `PATCH /:id/favorite`.
- **Sleep belongs to the day you woke up** — list queries filter `woke_at` within the day range. Sleep input requires `wokeAt > bedAt` and a ≤24h duration.
- **Measurements require at least one of** `weightKg` / `bodyFatPct`.
- **Times:** all datetimes TZ-explicit ISO over the wire (the established `isoDateString` rule). `eatenAt`/`measuredAt` default to server-now when omitted on create.
- **Daily totals** are computed client-side from the day's meals and compared against the user's targets (already in `users`; Settings gains editing for them in this plan).
- **Quick-log** actions navigate to `/health?add=meal|weight|sleep`; HealthPage opens the matching sheet and strips the param.

## File structure (new/changed)

```
shared/src/datetime.ts            # isoDateString moved here (workout.ts re-imports)
shared/src/health.ts              # meal/sleep/measurement schemas
shared/src/health.test.ts
worker/src/db/schema.ts           # + meals, sleep_records, body_measurements
worker/migrations/0004_health_tables.sql
worker/src/routes/meals.ts
worker/src/routes/sleep.ts
worker/src/routes/measurements.ts
worker/src/index.ts               # + three mounts
worker/test/reset-db.ts           # + three tables
worker/test/{meals,sleep,measurements}.test.ts
app/src/lib/health.ts             # hooks
app/src/lib/format.ts             # + dayRange/addDays/formatTime/sleepDuration helpers
app/src/components/MealFormSheet.tsx
app/src/components/SleepFormSheet.tsx
app/src/components/MeasurementFormSheet.tsx
app/src/pages/HealthPage.tsx      # replaces placeholder
app/src/pages/SettingsPage.tsx    # + nutrition targets
app/src/components/QuickLogSheet.tsx  # wire remaining actions
```

---

### Task 1: Health tables — schema, migration 0004, reset-db

**Files:**
- Modify: `worker/src/db/schema.ts`, `worker/test/reset-db.ts`
- Generated: `worker/migrations/0004_health_tables.sql`
- Test: `worker/test/health-db.test.ts`

- [ ] **Step 1: Failing test** — `worker/test/health-db.test.ts`:

```ts
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import { seedUser } from './helpers';

describe('health tables', () => {
  it('round-trips a meal, a sleep record, and a measurement', async () => {
    await seedUser('user-1');
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({
      id: 'm1',
      userId: 'user-1',
      name: 'チキンサラダ',
      eatenAt: new Date('2026-06-12T12:10:00Z'),
      calories: 480,
      proteinG: 42,
    });
    await db.insert(schema.sleepRecords).values({
      id: 'sl1',
      userId: 'user-1',
      bedAt: new Date('2026-06-11T14:40:00Z'),
      wokeAt: new Date('2026-06-11T22:00:00Z'),
      quality: 4,
    });
    await db.insert(schema.bodyMeasurements).values({
      id: 'bm1',
      userId: 'user-1',
      measuredAt: new Date('2026-06-12T00:00:00Z'),
      weightKg: 72.4,
    });

    const meal = await db.query.meals.findFirst();
    expect(meal?.name).toBe('チキンサラダ');
    expect(meal?.isFavorite).toBe(false);
    expect(meal?.fatG).toBeNull();
    const sleep = await db.query.sleepRecords.findFirst();
    expect(sleep?.quality).toBe(4);
    const bm = await db.query.bodyMeasurements.findFirst();
    expect(bm?.bodyFatPct).toBeNull();
  });
});
```

- [ ] **Step 2: Run, observe failure.** Then extend `worker/src/db/schema.ts`:

```ts
export const meals = sqliteTable(
  'meals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    eatenAt: integer('eaten_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    name: text('name').notNull(),
    calories: integer('calories'),
    proteinG: real('protein_g'),
    fatG: real('fat_g'),
    carbsG: real('carbs_g'),
    notes: text('notes'),
    isFavorite: integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('idx_meals_user_eaten').on(t.userId, t.eatenAt)],
);

export const sleepRecords = sqliteTable(
  'sleep_records',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    bedAt: integer('bed_at', { mode: 'timestamp' }).notNull(),
    wokeAt: integer('woke_at', { mode: 'timestamp' }).notNull(),
    quality: integer('quality'),
    notes: text('notes'),
  },
  (t) => [index('idx_sleep_user_woke').on(t.userId, t.wokeAt)],
);

export const bodyMeasurements = sqliteTable(
  'body_measurements',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    measuredAt: integer('measured_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    weightKg: real('weight_kg'),
    bodyFatPct: real('body_fat_pct'),
  },
  (t) => [index('idx_measurements_user_measured').on(t.userId, t.measuredAt)],
);
```

- [ ] **Step 3:** Generate migration `health_tables` → verify three CREATE TABLEs + three indexes, non-destructive.
- [ ] **Step 4:** `worker/test/reset-db.ts` — add `'meals', 'sleep_records', 'body_measurements'` to `USER_TABLES` (before `users` in the list; they reference users only).
- [ ] **Step 5:** Gate (`npm test -w worker` 57) + commit `feat: add health domain tables`

---

### Task 2: Shared health schemas (+ isoDateString extraction)

**Files:**
- Create: `shared/src/datetime.ts`, `shared/src/health.ts`
- Modify: `shared/src/workout.ts` (import isoDateString from ./datetime), `shared/src/index.ts` (export health + datetime)
- Test: `shared/src/health.test.ts`

- [ ] **Step 1: Failing tests** — `shared/src/health.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mealInputSchema, measurementInputSchema, sleepInputSchema } from './health';

describe('mealInputSchema', () => {
  it('accepts name-only quick logging', () => {
    expect(mealInputSchema.safeParse({ name: 'プロテイン' }).success).toBe(true);
  });
  it('rejects negative calories and blank names', () => {
    expect(mealInputSchema.safeParse({ name: 'x', calories: -10 }).success).toBe(false);
    expect(mealInputSchema.safeParse({ name: '  ' }).success).toBe(false);
  });
});

describe('sleepInputSchema', () => {
  const base = { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:00:00.000Z' };
  it('accepts a normal night with quality', () => {
    expect(sleepInputSchema.safeParse({ ...base, quality: 4 }).success).toBe(true);
  });
  it('rejects wokeAt before bedAt and >24h sleeps', () => {
    expect(sleepInputSchema.safeParse({ bedAt: base.wokeAt, wokeAt: base.bedAt }).success).toBe(false);
    expect(
      sleepInputSchema.safeParse({ bedAt: '2026-06-10T00:00:00.000Z', wokeAt: '2026-06-11T01:00:00.000Z' }).success,
    ).toBe(false);
  });
  it('rejects quality outside 1-5', () => {
    expect(sleepInputSchema.safeParse({ ...base, quality: 6 }).success).toBe(false);
  });
});

describe('measurementInputSchema', () => {
  it('requires at least one value', () => {
    expect(measurementInputSchema.safeParse({}).success).toBe(false);
    expect(measurementInputSchema.safeParse({ weightKg: 72.4 }).success).toBe(true);
    expect(measurementInputSchema.safeParse({ bodyFatPct: 18.5 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Implement.** `shared/src/datetime.ts`:

```ts
import { z } from 'zod';

/** Parseable datetime WITH explicit timezone (Z or ±HH:MM) — bare local strings shift in the UTC worker runtime. */
export const isoDateString = z
  .string()
  .refine(
    (v) => !Number.isNaN(new Date(v).getTime()) && /(?:Z|[+-]\d{2}:\d{2})$/.test(v),
    { message: 'Datetime must include an explicit timezone (Z or ±HH:MM)' },
  );
```

In `shared/src/workout.ts`: delete the local `isoDateString` and `import { isoDateString } from './datetime';`.

`shared/src/health.ts`:

```ts
import { z } from 'zod';
import { isoDateString } from './datetime';

export const mealInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  eatenAt: isoDateString.optional(),
  calories: z.number().int().min(0).max(10000).optional(),
  proteinG: z.number().min(0).max(1000).optional(),
  fatG: z.number().min(0).max(1000).optional(),
  carbsG: z.number().min(0).max(1000).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const mealFavoriteSchema = z.object({ isFavorite: z.boolean() });

export const sleepInputSchema = z
  .object({
    bedAt: isoDateString,
    wokeAt: isoDateString,
    quality: z.number().int().min(1).max(5).optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine((v) => new Date(v.wokeAt) > new Date(v.bedAt), { message: 'wokeAt must be after bedAt' })
  .refine(
    (v) => new Date(v.wokeAt).getTime() - new Date(v.bedAt).getTime() <= 24 * 3600 * 1000,
    { message: 'Sleep duration cannot exceed 24 hours' },
  );

export const measurementInputSchema = z
  .object({
    measuredAt: isoDateString.optional(),
    weightKg: z.number().positive().max(500).optional(),
    bodyFatPct: z.number().min(1).max(75).optional(),
  })
  .refine((v) => v.weightKg !== undefined || v.bodyFatPct !== undefined, {
    message: 'Provide weight or body fat',
  });

export type MealInput = z.infer<typeof mealInputSchema>;
export type SleepInput = z.infer<typeof sleepInputSchema>;
export type MeasurementInput = z.infer<typeof measurementInputSchema>;
```

`shared/src/index.ts`: add `export * from './health';` and `export * from './datetime';`.

- [ ] **Step 3:** Gate (`npm test -w shared` 24, worker tests still green — the workout.ts refactor must not change behavior) + commit `feat: add health domain validation schemas`

---

### Task 3: `/api/meals` — CRUD, search/autocomplete, favorites

**Files:**
- Create: `worker/src/routes/meals.ts`
- Modify: `worker/src/index.ts` (mount `/meals` after `/workouts`)
- Test: `worker/test/meals.test.ts`

- [ ] **Step 1: Failing tests** — `worker/test/meals.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}
const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('/api/meals', () => {
  it('creates a meal with defaults and lists it within a day range', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch(
        'https://example.com/api/meals',
        json(headers, { name: 'チキンサラダ', calories: 480, proteinG: 42, eatenAt: '2026-06-12T12:10:00.000Z' }),
      )
    ).json()) as { id: string; isFavorite: boolean };
    expect(created.isFavorite).toBe(false);

    const list = (await (
      await SELF.fetch(
        'https://example.com/api/meals?from=2026-06-12T00:00:00.000Z&to=2026-06-13T00:00:00.000Z',
        { headers },
      )
    ).json()) as Array<{ name: string }>;
    expect(list).toHaveLength(1);

    const outside = (await (
      await SELF.fetch(
        'https://example.com/api/meals?from=2026-06-13T00:00:00.000Z&to=2026-06-14T00:00:00.000Z',
        { headers },
      )
    ).json()) as unknown[];
    expect(outside).toHaveLength(0);
  });

  it('search dedupes by name with latest nutrition and pins favorites', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン', calories: 120, eatenAt: '2026-06-01T08:00:00.000Z' }));
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン', calories: 130, eatenAt: '2026-06-10T08:00:00.000Z' }));
    const oat = (await (
      await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'オートミール', calories: 350, eatenAt: '2026-06-11T08:00:00.000Z' }))
    ).json()) as { id: string };
    await SELF.fetch(`https://example.com/api/meals/${oat.id}/favorite`, json(headers, { isFavorite: true }, 'PATCH'));

    const results = (await (
      await SELF.fetch('https://example.com/api/meals/search?q=', { headers })
    ).json()) as Array<{ name: string; calories: number | null; isFavorite: boolean }>;
    expect(results).toHaveLength(2); // deduped プロテイン + オートミール
    expect(results[0]?.name).toBe('オートミール'); // favorite pinned first
    expect(results.find((r) => r.name === 'プロテイン')?.calories).toBe(130); // latest wins
  });

  it('search filters by query matching the name', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン' }));
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'オートミール' }));
    const results = (await (
      await SELF.fetch('https://example.com/api/meals/search?q=プロテ', { headers })
    ).json()) as Array<{ name: string }>;
    expect(results.map((r) => r.name)).toEqual(['プロテイン']);
  });

  it('updates and deletes a meal, scoped to the owner', async () => {
    const headers = await authed();
    await seedUser('user-2');
    const theirs = (await (
      await SELF.fetch('https://example.com/api/meals', json({ Cookie: await sessionCookieFor('user-2') }, { name: 'Their meal' }))
    ).json()) as { id: string };

    const mine = (await (
      await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'Lunch', calories: 600 }))
    ).json()) as { id: string };

    const updated = (await (
      await SELF.fetch(`https://example.com/api/meals/${mine.id}`, json(headers, { name: 'Lunch', calories: 650 }, 'PUT'))
    ).json()) as { calories: number };
    expect(updated.calories).toBe(650);

    expect((await SELF.fetch(`https://example.com/api/meals/${theirs.id}`, json(headers, { name: 'x' }, 'PUT'))).status).toBe(404);
    expect((await SELF.fetch(`https://example.com/api/meals/${mine.id}`, { headers, method: 'DELETE' })).status).toBe(200);
  });

  it('rejects an invalid meal with 422', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/meals', json(headers, { name: '', calories: -1 }));
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Step 2: Run, observe failure. Implement** `worker/src/routes/meals.ts`:

```ts
import { zValidator } from '@hono/zod-validator';
import { mealFavoriteSchema, mealInputSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, gte, like, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Meal not found' } } as const;

const validateMeal = zValidator('json', mealInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

function toRow(input: import('@bodyatlas/shared').MealInput) {
  return {
    name: input.name,
    ...(input.eatenAt ? { eatenAt: new Date(input.eatenAt) } : {}),
    calories: input.calories ?? null,
    proteinG: input.proteinG ?? null,
    fatG: input.fatG ?? null,
    carbsG: input.carbsG ?? null,
    notes: input.notes ?? null,
  };
}

export const mealsRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const { from, to } = c.req.query();
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return c.json({ error: { code: 'validation', message: 'Invalid from/to date' } }, 422);
    }
    const rows = await db
      .select()
      .from(schema.meals)
      .where(
        and(
          eq(schema.meals.userId, c.get('userId')),
          fromDate ? gte(schema.meals.eatenAt, fromDate) : undefined,
          toDate ? lt(schema.meals.eatenAt, toDate) : undefined,
        ),
      )
      .orderBy(asc(schema.meals.eatenAt))
      .limit(200);
    return c.json(rows);
  })
  .get('/search', async (c) => {
    const db = getDb(c.env.DB);
    const q = c.req.query('q');
    const rows = await db
      .select()
      .from(schema.meals)
      .where(
        and(
          eq(schema.meals.userId, c.get('userId')),
          q ? like(schema.meals.name, `%${q}%`) : undefined,
        ),
      )
      .orderBy(desc(schema.meals.eatenAt))
      .limit(300);
    // Dedupe by name (rows are newest-first, so the first hit per name carries
    // the latest nutrition); a name is favorite if ANY of its rows is.
    const byName = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const existing = byName.get(row.name);
      if (!existing) {
        byName.set(row.name, row);
      } else if (row.isFavorite && !existing.isFavorite) {
        byName.set(row.name, { ...existing, isFavorite: true });
      }
    }
    const deduped = [...byName.values()]
      .sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite))
      .slice(0, 20);
    return c.json(deduped);
  })
  .post('/', validateMeal, async (c) => {
    const db = getDb(c.env.DB);
    const id = crypto.randomUUID();
    await db.insert(schema.meals).values({ id, userId: c.get('userId'), ...toRow(c.req.valid('json')) });
    const created = await db.query.meals.findFirst({ where: eq(schema.meals.id, id) });
    return c.json(created, 201);
  })
  .put('/:id', validateMeal, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.meals.findFirst({
      where: and(eq(schema.meals.id, id), eq(schema.meals.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.update(schema.meals).set(toRow(c.req.valid('json'))).where(eq(schema.meals.id, id));
    return c.json(await db.query.meals.findFirst({ where: eq(schema.meals.id, id) }));
  })
  .patch(
    '/:id/favorite',
    zValidator('json', mealFavoriteSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const id = c.req.param('id');
      const existing = await db.query.meals.findFirst({
        where: and(eq(schema.meals.id, id), eq(schema.meals.userId, c.get('userId'))),
      });
      if (!existing) return c.json(notFound, 404);
      await db
        .update(schema.meals)
        .set({ isFavorite: c.req.valid('json').isFavorite })
        .where(eq(schema.meals.id, id));
      return c.json(await db.query.meals.findFirst({ where: eq(schema.meals.id, id) }));
    },
  )
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.meals.findFirst({
      where: and(eq(schema.meals.id, id), eq(schema.meals.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.meals).where(eq(schema.meals.id, id));
    return c.json({ ok: true });
  });
```

ROUTE-ORDER NOTE: `/search` registered before `/:id` routes (shown above) — keep it that way.

- [ ] **Step 3:** Mount `.route('/meals', mealsRoutes)` in the apiApp chain. Gate (`npm test -w worker` 62; root typecheck) + commit `feat: add meals API with autocomplete search and favorites`

---

### Task 4: `/api/sleep` + `/api/measurements`

**Files:**
- Create: `worker/src/routes/sleep.ts`, `worker/src/routes/measurements.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/sleep.test.ts`, `worker/test/measurements.test.ts`

- [ ] **Step 1: Failing tests.** `worker/test/sleep.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}
const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('/api/sleep', () => {
  it('creates, lists by woke-day range, updates, deletes', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch(
        'https://example.com/api/sleep',
        json(headers, { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:00:00.000Z', quality: 4 }),
      )
    ).json()) as { id: string };

    const inDay = (await (
      await SELF.fetch(
        'https://example.com/api/sleep?from=2026-06-11T15:00:00.000Z&to=2026-06-12T15:00:00.000Z',
        { headers },
      )
    ).json()) as unknown[];
    expect(inDay).toHaveLength(1); // woke_at inside range (bed_at outside is fine)

    const updated = (await (
      await SELF.fetch(
        `https://example.com/api/sleep/${created.id}`,
        json(headers, { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:30:00.000Z', quality: 5 }, 'PUT'),
      )
    ).json()) as { quality: number };
    expect(updated.quality).toBe(5);

    expect((await SELF.fetch(`https://example.com/api/sleep/${created.id}`, { headers, method: 'DELETE' })).status).toBe(200);
  });

  it('rejects wokeAt before bedAt with 422 and scopes to owner', async () => {
    const headers = await authed();
    const bad = await SELF.fetch(
      'https://example.com/api/sleep',
      json(headers, { bedAt: '2026-06-11T22:00:00.000Z', wokeAt: '2026-06-11T14:00:00.000Z' }),
    );
    expect(bad.status).toBe(422);

    await seedUser('user-2');
    const theirs = (await (
      await SELF.fetch(
        'https://example.com/api/sleep',
        json({ Cookie: await sessionCookieFor('user-2') }, { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:00:00.000Z' }),
      )
    ).json()) as { id: string };
    expect((await SELF.fetch(`https://example.com/api/sleep/${theirs.id}`, { headers, method: 'DELETE' })).status).toBe(404);
  });
});
```

`worker/test/measurements.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}
const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('/api/measurements', () => {
  it('creates weight-only, lists by range, updates, deletes', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch(
        'https://example.com/api/measurements',
        json(headers, { weightKg: 72.4, measuredAt: '2026-06-12T00:00:00.000Z' }),
      )
    ).json()) as { id: string; bodyFatPct: number | null };
    expect(created.bodyFatPct).toBeNull();

    const list = (await (
      await SELF.fetch(
        'https://example.com/api/measurements?from=2026-06-11T15:00:00.000Z&to=2026-06-12T15:00:00.000Z',
        { headers },
      )
    ).json()) as unknown[];
    expect(list).toHaveLength(1);

    const updated = (await (
      await SELF.fetch(
        `https://example.com/api/measurements/${created.id}`,
        json(headers, { weightKg: 72.2, bodyFatPct: 18.5, measuredAt: '2026-06-12T00:00:00.000Z' }, 'PUT'),
      )
    ).json()) as { bodyFatPct: number };
    expect(updated.bodyFatPct).toBe(18.5);

    expect((await SELF.fetch(`https://example.com/api/measurements/${created.id}`, { headers, method: 'DELETE' })).status).toBe(200);
  });

  it('rejects an empty measurement with 422', async () => {
    const headers = await authed();
    expect((await SELF.fetch('https://example.com/api/measurements', json(headers, {}))).status).toBe(422);
  });
});
```

- [ ] **Step 2: Implement.** `worker/src/routes/sleep.ts` (measurements.ts is the identical pattern with its own schema/fields — write it the same way):

```ts
import { zValidator } from '@hono/zod-validator';
import { sleepInputSchema, type SleepInput } from '@bodyatlas/shared';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Sleep record not found' } } as const;

const validate = zValidator('json', sleepInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

function toRow(input: SleepInput) {
  return {
    bedAt: new Date(input.bedAt),
    wokeAt: new Date(input.wokeAt),
    quality: input.quality ?? null,
    notes: input.notes ?? null,
  };
}

export const sleepRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const { from, to } = c.req.query();
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) {
      return c.json({ error: { code: 'validation', message: 'Invalid from/to date' } }, 422);
    }
    const rows = await db
      .select()
      .from(schema.sleepRecords)
      .where(
        and(
          eq(schema.sleepRecords.userId, c.get('userId')),
          fromDate ? gte(schema.sleepRecords.wokeAt, fromDate) : undefined,
          toDate ? lt(schema.sleepRecords.wokeAt, toDate) : undefined,
        ),
      )
      .orderBy(asc(schema.sleepRecords.wokeAt))
      .limit(100);
    return c.json(rows);
  })
  .post('/', validate, async (c) => {
    const db = getDb(c.env.DB);
    const id = crypto.randomUUID();
    await db.insert(schema.sleepRecords).values({ id, userId: c.get('userId'), ...toRow(c.req.valid('json')) });
    return c.json(await db.query.sleepRecords.findFirst({ where: eq(schema.sleepRecords.id, id) }), 201);
  })
  .put('/:id', validate, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.sleepRecords.findFirst({
      where: and(eq(schema.sleepRecords.id, id), eq(schema.sleepRecords.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.update(schema.sleepRecords).set(toRow(c.req.valid('json'))).where(eq(schema.sleepRecords.id, id));
    return c.json(await db.query.sleepRecords.findFirst({ where: eq(schema.sleepRecords.id, id) }));
  })
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.sleepRecords.findFirst({
      where: and(eq(schema.sleepRecords.id, id), eq(schema.sleepRecords.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.sleepRecords).where(eq(schema.sleepRecords.id, id));
    return c.json({ ok: true });
  });
```

`measurements.ts`: same five-route shape over `schema.bodyMeasurements` with `measurementInputSchema`; `toRow` maps `measuredAt` (optional → only set when provided), `weightKg`, `bodyFatPct` (`?? null`); range filters on `measuredAt`; message "Measurement not found".

- [ ] **Step 3:** Mount `.route('/sleep', sleepRoutes).route('/measurements', measurementsRoutes)`. Gate (`npm test -w worker` 66; root typecheck) + commit `feat: add sleep and measurements APIs`

---

### Task 5: App — i18n keys, day helpers, health hooks

**Files:**
- Modify: `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`, `app/src/lib/format.ts`, `app/src/lib/format.test.ts`
- Create: `app/src/lib/health.ts`

- [ ] **Step 1: i18n keys** (EN / JA), appended to both catalogs:

```
'health.meals': 'Meals' / '食事'
'health.addMeal': 'Add meal' / '食事を記録'
'health.mealName': 'Meal' / '食事名'
'health.calories': 'kcal' / 'kcal'
'health.protein': 'P' / 'P'
'health.fat': 'F' / 'F'
'health.carbs': 'C' / 'C'
'health.noMeals': 'No meals logged this day.' / 'この日の食事記録はありません。'
'health.sleep': 'Sleep' / '睡眠'
'health.addSleep': 'Log sleep' / '睡眠を記録'
'health.bedTime': 'Bed time' / '就寝時刻'
'health.wakeTime': 'Wake time' / '起床時刻'
'health.quality': 'Quality' / '睡眠の質'
'health.noSleep': 'No sleep logged.' / '睡眠記録はありません。'
'health.invalidSleepRange': 'Wake time must be after bed time.' / '起床時刻は就寝時刻より後にしてください。'
'health.body': 'Body' / '体組成'
'health.addMeasurement': 'Log weight' / '体重を記録'
'health.weight': 'Weight (kg)' / '体重 (kg)'
'health.bodyFat': 'Body fat (%)' / '体脂肪率 (%)'
'health.noMeasurement': 'No measurement logged.' / '体組成記録はありません。'
'health.measurementNeedsValue': 'Enter weight or body fat.' / '体重か体脂肪率を入力してください。'
'health.time': 'Time' / '時刻'
'health.today': 'Today' / '今日'
'health.dailyTotal': 'Daily total' / '1日の合計'
'health.target': 'target' / '目標'
'health.favorite': 'Favorite' / 'お気に入り'
'settings.targets': 'Nutrition targets' / '栄養目標'
'settings.targetKcal': 'Calories (kcal)' / 'カロリー (kcal)'
'settings.targetProtein': 'Protein (g)' / 'タンパク質 (g)'
'settings.targetFat': 'Fat (g)' / '脂質 (g)'
'settings.targetCarbs': 'Carbs (g)' / '炭水化物 (g)'
```

- [ ] **Step 2: Day helpers, TDD.** Tests appended to `format.test.ts`:

```ts
import { addDays, dayRangeIso, formatTime, sleepDurationLabel } from './format';

describe('dayRangeIso', () => {
  it('returns local midnight to next midnight as TZ-explicit ISO', () => {
    const d = new Date(2026, 5, 12, 15, 30); // local June 12
    const { fromIso, toIso } = dayRangeIso(d);
    expect(new Date(fromIso).getHours()).toBe(0);
    expect(new Date(toIso).getTime() - new Date(fromIso).getTime()).toBe(86400000);
    expect(fromIso.endsWith('Z')).toBe(true);
  });
});

describe('addDays', () => {
  it('moves whole days', () => {
    expect(addDays(new Date(2026, 5, 12), -1).getDate()).toBe(11);
  });
});

describe('sleepDurationLabel', () => {
  it('formats h:mm', () => {
    expect(sleepDurationLabel('2026-06-11T14:40:00.000Z', '2026-06-11T22:00:00.000Z')).toBe('7h 20m');
  });
});
```

Implementations in `format.ts`:

```ts
export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local-midnight day window as TZ-explicit ISO instants. */
export function dayRangeIso(d: Date): { fromIso: string; toIso: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { fromIso: start.toISOString(), toIso: addDays(start, 1).toISOString() };
}

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function sleepDurationLabel(bedIso: string, wokeIso: string): string {
  const mins = Math.round((new Date(wokeIso).getTime() - new Date(bedIso).getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}
```

- [ ] **Step 3: Hooks** — `app/src/lib/health.ts`, following `train.ts` exactly (typed RPC + `InferResponseType`, NO hand-written response shapes; `expectOk` imported or duplicated as train.ts does):

Queries: `useMeals(fromIso, toIso)` key `['meals', fromIso, toIso]`; `useMealSearch(q)` key `['meal-search', q]` (staleTime 60s); `useSleep(fromIso, toIso)` key `['sleep', fromIso, toIso]`; `useMeasurements(fromIso, toIso)` key `['measurements', fromIso, toIso]`.
Mutations (invalidate their domain prefix; meal mutations also invalidate `['meal-search']`): `useCreateMeal`, `useUpdateMeal` (PUT, takes `{id, input}`), `useToggleFavorite` (`{id, isFavorite}`), `useDeleteMeal`, `useCreateSleep`, `useUpdateSleep`, `useDeleteSleep`, `useCreateMeasurement`, `useUpdateMeasurement`, `useDeleteMeasurement`.
Exported derived types: `Meal`, `MealSearchResult`, `SleepRecord`, `Measurement`.

- [ ] **Step 4:** Gate (`npm test -w app` 42 incl. 4 new helper tests; root typecheck) + commit `feat: add health i18n, day helpers, and data hooks`

---

### Task 6: Settings — nutrition targets

**Files:**
- Modify: `app/src/pages/SettingsPage.tsx`
- Test: extend `app/src/SettingsPage.test.tsx`

- [ ] Add a `t('settings.targets')` section under the language select: four numeric inputs (`.input input-num` widened, `inputMode="numeric"`, labels via the four target keys) bound to `me.targetKcal` etc., saved onBlur when changed: `update.mutate({ targetKcal: parsed })` (null when cleared — `updateMeSchema` already allows nullable). Parse with the NaN guard pattern from TemplateEditor.
- [ ] New test: type 2400 into the Calories target, blur, expect PATCH body `{ targetKcal: 2400 }`.
- [ ] Gate (43 app tests) + commit `feat: add nutrition target editing to settings`

---

### Task 7: HealthPage day view

**Files:**
- Modify: `app/src/pages/HealthPage.tsx` (replace placeholder)
- Test: `app/src/pages/HealthPage.test.tsx`

Behavior:
- `selectedDate` state (default `new Date()`); header `◀ {formatDay} ▶` buttons (aria-labels `prev-day`/`next-day`); show `t('health.today')` chip when the date is today.
- `const { fromIso, toIso } = dayRangeIso(selectedDate)` drives `useMeals/useSleep/useMeasurements`.
- **Daily total card** (`glow-card is-active`): kcal big number `{sum} / {me.targetKcal ?? '—'}`, and three small bars P/F/C — each `{sum}g / target` with a simple progress bar (`div` width %, capped 100, `.pip`-style background via inline width on an accent bar). All sums from the day's meals (null fields count as 0).
- **Meals section** (`section-title t('health.meals')` + add button `t('health.addMeal')`): rows `formatTime(eatenAt)` + name + kcal (+ ★ when favorite); tap row → edit sheet. Empty → `t('health.noMeals')`.
- **Sleep section**: card showing `sleepDurationLabel` big, `bed → woke` times, quality as `★` repeat; tap → edit. Empty → add button `t('health.addSleep')`.
- **Body section**: card with weight + body fat; tap → edit. Empty → add button.
- Sheets controlled by state `openSheet: null | { kind: 'meal'|'sleep'|'measurement', editing?: <row> }`; the three form-sheet components are Task 8/9 — for THIS task create them as minimal stubs that render `role="dialog"` with a close button (full forms next tasks).
- `useSearchParams`: on mount, `?add=meal|weight|sleep` opens the matching sheet and `setSearchParams({}, { replace: true })`.
- Skeletons while pending.

Tests (3): renders meals with totals (fixture: two meals, targets on me — assert `1,130` style sum text present and meal names render); empty day shows the three empty-state strings; prev-day button changes the fetched range (assert second fetch URL's `from` is one day earlier — inspect the fetch spy).

Gate (46 app tests) + commit `feat: add health day view with daily nutrition totals`

---

### Task 8: MealFormSheet with autocomplete + favorites

**Files:**
- Create: `app/src/components/MealFormSheet.tsx` (replacing the Task 7 stub)
- Test: `app/src/components/MealFormSheet.test.tsx`

Behavior:
- Props: `{ defaultDate: Date; editing?: Meal | null; onClose: () => void }`. Sheet markup per ExercisePicker (backdrop, dialog, aria-modal, Escape).
- Fields: name (`.input`, autoFocus on create), time (`datetime-local`, default = `editing?.eatenAt ?? now-of-defaultDate`, sent as `toISOString()`), kcal / P / F / C numeric inputs (`input-num` style, comma-tolerant parse via the SetInputRow `num` approach — extract that helper to `app/src/lib/format.ts` as `parseDecimal` and reuse in both places), notes input.
- **Autocomplete:** while typing the name (create mode only), `useMealSearch(name)` renders up to 5 suggestion rows under the field (name + kcal + ★); tapping one fills name + nutrition fields (user can still edit); suggestions hide once a suggestion is picked or the field loses focus (use a small `suggestionsOpen` state; don't over-engineer).
- ★ button on each suggestion toggles favorite via `useToggleFavorite` (stopPropagation).
- Save: create → `useCreateMeal`; edit → `useUpdateMeal`; disabled until name non-empty; error → generic message; delete button in edit mode (confirm).
- Tests (2): typing a name shows suggestions from the mocked search and tapping fills kcal; saving fires POST with the typed values (assert body).

Gate (48 app tests) + commit `feat: add meal form with autocomplete library and favorites`

---

### Task 9: SleepFormSheet + MeasurementFormSheet

**Files:**
- Create: `app/src/components/SleepFormSheet.tsx`, `app/src/components/MeasurementFormSheet.tsx` (replacing stubs)
- Test: `app/src/components/SleepFormSheet.test.tsx`

Behavior:
- **SleepFormSheet** `{ defaultDate, editing?, onClose }`: bed time + wake time `datetime-local` inputs (defaults: editing values, else bed = defaultDate-1day 23:00 local, wake = defaultDate 07:00 local), quality as five `★` toggle buttons (aria-label `quality-N`), notes. Client-side guard: wake > bed else inline `t('health.invalidSleepRange')` and save disabled. Save → create/update with `toISOString()` values; delete in edit mode.
- **MeasurementFormSheet**: weight + body fat numeric inputs (comma-tolerant), time `datetime-local` (default now-of-defaultDate), save disabled until one value present (`t('health.measurementNeedsValue')` hint), create/update/delete.
- Test (2, sleep only): valid times fire POST with TZ-explicit ISO; inverted times disable save + show the message.

Gate (50 app tests) + commit `feat: add sleep and measurement form sheets`

---

### Task 10: Quick-log wiring + Health tab polish pass

**Files:**
- Modify: `app/src/components/QuickLogSheet.tsx`, `app/src/components/QuickLogSheet.test.tsx`

- [ ] Enable the three remaining actions: meal → `navigate('/health?add=meal')`, weight → `navigate('/health?add=weight')`, sleep → `navigate('/health?add=sleep')`, each closing the sheet. Remove the `comingSoon` badges and the `disabled` attributes.
- [ ] Tests: extend the QuickLogSheet test — clicking the meal action navigates to `/health?add=meal` (probe route asserting `useSearchParams`/location) and closes; same pattern for weight (sleep covered by symmetry).
- [ ] Full gate from root: `npm run typecheck && npm test && npm run build` (expect 24 shared / 66 worker / 52 app).
- [ ] Commit `feat: wire meal, weight, and sleep quick-log actions`

---

### Task 11: Deploy

- [ ] `npx wrangler d1 migrations apply bodyatlas --remote --config worker/wrangler.jsonc` → 0004 applied.
- [ ] `npm run deploy`.
- [ ] Browser smoke (user): log a meal with autocomplete (second time logging the same name should pre-fill), favorite it, check the daily totals bar against targets set in Settings, log sleep + weight via the FAB from any tab, edit each entry, flip to 日本語.
- [ ] CLAUDE.md status + commit `docs: update status for health tracking`.

---

## Plan self-review (authoring time)

- Spec coverage (health domain): meals time+nutrition+notes ✓, implicit library w/ favorites ✓, sleep bed/wake/quality ✓, measurements weight+bf% ✓, day view with totals vs targets ✓ (targets editable in Settings — gap in earlier plans closed here), quick-log all four actions live ✓. Trends remain Plan 4.
- Reuses every established pattern; new helpers (`dayRangeIso` local-midnight windows) keep tz-correctness client-side where the device tz lives, with TZ-explicit instants on the wire.
- Type consistency: hooks derive from RPC; forms reuse `parseDecimal` (extracted from SetInputRow — SetInputRow must import the extracted helper to avoid duplication).
- Known risks flagged: meal search dedupe is in-JS over a 300-row window (fine at personal scale); HealthPage stubs for sheets within Task 7 get replaced in Tasks 8–9 (tests for HealthPage must not depend on form internals).
