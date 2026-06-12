# BodyAtlas Trends + Today Implementation Plan (Plan 4 of 4 — completes v1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The four analytics views (strength progression with estimated 1RM, weekly training volume, nutrition vs body trend, sleep consistency), the Today dashboard, and the deferred Playwright E2E smoke suite. This completes the v1 spec.

**Architecture:** Trends endpoints return lightweight point series; all day/week bucketing happens CLIENT-side in the device timezone (consistent with `dayRangeIso`). Charts are small custom SVG/CSS components (token-colored — no chart library). E2E uses a dev-only `/auth/test-login` endpoint gated by an env var that is never set in production.

**Conventions:** everything established in Plans 1–3. Tests at start: 23 shared / 69 worker / 51 app.

## Domain decisions locked in this plan

- **Estimated 1RM** = Epley: `weight × (1 + reps/30)`, computed only for sets with `weightKg` and `1 ≤ reps ≤ 15`; a workout's point is the max across its sets of that exercise. Top weight = max `weightKg`.
- **Trends endpoints** (new, all under `/api/trends`, auth'd):
  - `GET /api/trends/strength/:exerciseId?from=` → per-workout `{ workoutId, startedAt, topWeightKg, est1rm, setCount }`, ascending.
  - `GET /api/trends/volume?from=` → per workout × muscle group `{ startedAt, muscleGroup, setCount }` (client buckets by ISO week, local tz).
  - `GET /api/trends/nutrition-body?from=` → `{ meals: [{eatenAt, calories, proteinG}], measurements: [{measuredAt, weightKg, bodyFatPct}] }` (projections, capped 2000 rows each).
  - **Sleep trend reuses `GET /api/sleep?from=&to=`** — no new endpoint.
  - `from` defaults to 12 weeks ago; validated like other date params.
- **Range selector**: `4w | 12w | 6m | 1y` → 28/84/182/365 days back from now, shared by all four sections (per spec).
- **Charts**: `LineChart` (SVG polyline(s) + min/max y-labels), `BarColumn` rows (CSS width bars — already the HealthPage pattern), `Sparkline` (tiny polyline). All colors via tokens.
- **Today tab**: nutrition progress (today's meals vs targets), workout status (active → resume link; finished today → ✓ summary; else rest), latest weight + 30-day sparkline, last night's sleep. Every card links to its tab.
- **E2E**: `GET /auth/test-login` exists ONLY when `c.env.E2E_TEST_LOGIN === '1'` (404 otherwise — verified by a worker test). Set in `worker/.dev.vars` locally and in the CI job env; never in production vars/secrets. Playwright (root `e2e/` dir, chromium) drives the real dev server (`npm run dev` — the Cloudflare Vite plugin auto-applies D1 migrations to its local state, so the seed catalog exists). Specs tolerate persisted local state by using unique names per run.

## File structure (new/changed)

```
worker/src/lib/stats.ts               # epley1rm
worker/src/routes/trends.ts
worker/src/auth/test-login.ts         # gated dev-only login
worker/src/types.ts                   # + E2E_TEST_LOGIN?: string
worker/src/index.ts                   # mount /trends; mount test-login in authRoutes file or index
worker/test/{trends,test-login}.test.ts
app/src/lib/trends.ts                 # hooks + range helper
app/src/lib/buckets.ts                # localDayKey / weekKey / bucketBy (+ tests)
app/src/components/charts/{LineChart,Sparkline}.tsx
app/src/pages/TrendsPage.tsx          # replaces placeholder
app/src/pages/TodayPage.tsx           # replaces placeholder
playwright.config.ts                  # repo root
e2e/{train.spec.ts,health.spec.ts,dashboard.spec.ts}
.github/workflows/ci.yml              # + e2e job
package.json                          # root: @playwright/test devDep, e2e script
```

---

### Task 1: Trends API + stats helper

**Files:**
- Create: `worker/src/lib/stats.ts`, `worker/src/routes/trends.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/trends.test.ts`

- [ ] **Step 1: Failing tests** — `worker/test/trends.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, seedWorkout, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

describe('/api/trends/strength/:exerciseId', () => {
  it('returns per-workout top weight and Epley 1RM ascending', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-barbell-bench-press', [
      { weightKg: 80, reps: 8 },
      { weightKg: 82.5, reps: 5 },
    ], { startedAt: new Date('2026-05-01T10:00:00Z'), endedAt: new Date('2026-05-01T11:00:00Z') });
    await seedWorkout('w2', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 85, reps: 5 }], {
      startedAt: new Date('2026-06-01T10:00:00Z'), endedAt: new Date('2026-06-01T11:00:00Z'),
    });

    const res = await SELF.fetch(
      'https://example.com/api/trends/strength/seed-barbell-bench-press?from=2026-04-01T00:00:00.000Z',
      { headers },
    );
    expect(res.status).toBe(200);
    const points = (await res.json()) as Array<{ workoutId: string; topWeightKg: number; est1rm: number; setCount: number }>;
    expect(points.map((p) => p.workoutId)).toEqual(['w1', 'w2']);
    expect(points[0]?.topWeightKg).toBe(82.5);
    // Epley: max(80*(1+8/30)=101.33, 82.5*(1+5/30)=96.25) → 101.3 (1dp)
    expect(points[0]?.est1rm).toBeCloseTo(101.3, 1);
    expect(points[1]?.setCount).toBe(1);
  });

  it('excludes other users and respects from', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', [{ weightKg: 200, reps: 1 }]);
    await seedWorkout('w-old', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }], {
      startedAt: new Date('2026-01-01T10:00:00Z'),
    });
    const res = await SELF.fetch(
      'https://example.com/api/trends/strength/seed-deadlift?from=2026-04-01T00:00:00.000Z',
      { headers },
    );
    expect(await res.json()).toEqual([]);
  });
});

describe('/api/trends/volume', () => {
  it('returns set counts per workout and muscle group', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-barbell-bench-press', [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 8 },
    ]);
    const res = await SELF.fetch(
      'https://example.com/api/trends/volume?from=2026-04-01T00:00:00.000Z',
      { headers },
    );
    const rows = (await res.json()) as Array<{ muscleGroup: string; setCount: number }>;
    expect(rows).toEqual([expect.objectContaining({ muscleGroup: 'chest', setCount: 2 })]);
  });
});

describe('/api/trends/nutrition-body', () => {
  it('returns meal and measurement projections in range', async () => {
    const headers = await authed();
    const json = (body: unknown) => ({
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    await SELF.fetch('https://example.com/api/meals', json({ name: 'Lunch', calories: 700, proteinG: 40, eatenAt: '2026-06-01T03:00:00.000Z' }));
    await SELF.fetch('https://example.com/api/measurements', json({ weightKg: 72.4, measuredAt: '2026-06-01T00:00:00.000Z' }));

    const res = await SELF.fetch(
      'https://example.com/api/trends/nutrition-body?from=2026-05-01T00:00:00.000Z',
      { headers },
    );
    const body = (await res.json()) as { meals: Array<{ calories: number | null }>; measurements: Array<{ weightKg: number | null }> };
    expect(body.meals).toHaveLength(1);
    expect(body.measurements[0]?.weightKg).toBe(72.4);
  });
});
```

Also a tiny unit describe for the helper (same file or `stats` tested through the route — route coverage above suffices; keep epley exported for app reuse symmetry).

- [ ] **Step 2: Implement.** `worker/src/lib/stats.ts`:

```ts
/** Epley estimated 1RM; null when not meaningfully computable. */
export function epley1rm(weightKg: number | null, reps: number | null): number | null {
  if (weightKg === null || reps === null || reps < 1 || reps > 15) return null;
  return Math.round(weightKg * (1 + reps / 30) * 10) / 10;
}
```

`worker/src/routes/trends.ts`:

```ts
import { and, asc, eq, gte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import { epley1rm } from '../lib/stats';
import type { ProtectedEnv } from '../types';

const DEFAULT_WINDOW_DAYS = 84;

function parseFrom(raw: string | undefined): Date | null {
  if (!raw) return new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86400000);
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}
const invalidFrom = { error: { code: 'validation', message: 'Invalid from date' } } as const;

export const trendsRoutes = new Hono<ProtectedEnv>()
  .get('/strength/:exerciseId', async (c) => {
    const from = parseFrom(c.req.query('from'));
    if (!from) return c.json(invalidFrom, 422);
    const db = getDb(c.env.DB);
    const rows = await db
      .select({
        workoutId: schema.workouts.id,
        startedAt: schema.workouts.startedAt,
        weightKg: schema.sets.weightKg,
        reps: schema.sets.reps,
      })
      .from(schema.sets)
      .innerJoin(schema.workoutExercises, eq(schema.sets.workoutExerciseId, schema.workoutExercises.id))
      .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
      .where(
        and(
          eq(schema.workouts.userId, c.get('userId')),
          eq(schema.workoutExercises.exerciseId, c.req.param('exerciseId')),
          gte(schema.workouts.startedAt, from),
        ),
      )
      .orderBy(asc(schema.workouts.startedAt));

    const byWorkout = new Map<string, { workoutId: string; startedAt: Date; topWeightKg: number | null; est1rm: number | null; setCount: number }>();
    for (const row of rows) {
      const entry = byWorkout.get(row.workoutId) ?? {
        workoutId: row.workoutId,
        startedAt: row.startedAt,
        topWeightKg: null,
        est1rm: null,
        setCount: 0,
      };
      entry.setCount += 1;
      if (row.weightKg !== null && (entry.topWeightKg === null || row.weightKg > entry.topWeightKg)) {
        entry.topWeightKg = row.weightKg;
      }
      const oneRm = epley1rm(row.weightKg, row.reps);
      if (oneRm !== null && (entry.est1rm === null || oneRm > entry.est1rm)) entry.est1rm = oneRm;
      byWorkout.set(row.workoutId, entry);
    }
    return c.json([...byWorkout.values()]);
  })
  .get('/volume', async (c) => {
    const from = parseFrom(c.req.query('from'));
    if (!from) return c.json(invalidFrom, 422);
    const db = getDb(c.env.DB);
    const rows = await db
      .select({
        startedAt: schema.workouts.startedAt,
        muscleGroup: schema.exercises.muscleGroup,
        setId: schema.sets.id,
      })
      .from(schema.sets)
      .innerJoin(schema.workoutExercises, eq(schema.sets.workoutExerciseId, schema.workoutExercises.id))
      .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
      .innerJoin(schema.exercises, eq(schema.workoutExercises.exerciseId, schema.exercises.id))
      .where(and(eq(schema.workouts.userId, c.get('userId')), gte(schema.workouts.startedAt, from)));

    const byKey = new Map<string, { startedAt: Date; muscleGroup: string; setCount: number }>();
    for (const row of rows) {
      const key = `${row.startedAt.getTime()}|${row.muscleGroup}`;
      const entry = byKey.get(key) ?? { startedAt: row.startedAt, muscleGroup: row.muscleGroup, setCount: 0 };
      entry.setCount += 1;
      byKey.set(key, entry);
    }
    return c.json([...byKey.values()]);
  })
  .get('/nutrition-body', async (c) => {
    const from = parseFrom(c.req.query('from'));
    if (!from) return c.json(invalidFrom, 422);
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const meals = await db
      .select({ eatenAt: schema.meals.eatenAt, calories: schema.meals.calories, proteinG: schema.meals.proteinG })
      .from(schema.meals)
      .where(and(eq(schema.meals.userId, userId), gte(schema.meals.eatenAt, from)))
      .orderBy(asc(schema.meals.eatenAt))
      .limit(2000);
    const measurements = await db
      .select({
        measuredAt: schema.bodyMeasurements.measuredAt,
        weightKg: schema.bodyMeasurements.weightKg,
        bodyFatPct: schema.bodyMeasurements.bodyFatPct,
      })
      .from(schema.bodyMeasurements)
      .where(and(eq(schema.bodyMeasurements.userId, userId), gte(schema.bodyMeasurements.measuredAt, from)))
      .orderBy(asc(schema.bodyMeasurements.measuredAt))
      .limit(2000);
    return c.json({ meals, measurements });
  });
```

- [ ] **Step 3:** Mount `.route('/trends', trendsRoutes)` after `/measurements`. Gate (`npm test -w worker` 73; root typecheck) + commit `feat: add trends API with Epley 1RM strength series`

---

### Task 2: Chart primitives + bucketing + trend hooks

**Files:**
- Create: `app/src/lib/buckets.ts`, `app/src/lib/trends.ts`, `app/src/components/charts/LineChart.tsx`, `app/src/components/charts/Sparkline.tsx`
- Test: `app/src/lib/buckets.test.ts`

- [ ] **Step 1: TDD bucketing** — `app/src/lib/buckets.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bucketSum, localDayKey, rangeFromIso, weekKey } from './buckets';

describe('localDayKey', () => {
  it('keys by the device-local calendar day', () => {
    const key = localDayKey(new Date(2026, 5, 12, 23, 30).toISOString());
    expect(key).toBe('2026-06-12');
  });
});

describe('weekKey', () => {
  it('keys by the local Monday of the week', () => {
    expect(weekKey(new Date(2026, 5, 12).toISOString())).toBe('2026-06-08'); // Fri → Mon
    expect(weekKey(new Date(2026, 5, 8).toISOString())).toBe('2026-06-08'); // Mon → itself
    expect(weekKey(new Date(2026, 5, 14).toISOString())).toBe('2026-06-08'); // Sun → prev Mon
  });
});

describe('bucketSum', () => {
  it('sums values per key in insertion-sorted order', () => {
    const out = bucketSum(
      [
        { iso: new Date(2026, 5, 9).toISOString(), value: 3 },
        { iso: new Date(2026, 5, 12).toISOString(), value: 2 },
        { iso: new Date(2026, 5, 16).toISOString(), value: 4 },
      ],
      weekKey,
    );
    expect(out).toEqual([
      { key: '2026-06-08', value: 5 },
      { key: '2026-06-15', value: 4 },
    ]);
  });
});

describe('rangeFromIso', () => {
  it('maps the selector to a from-instant N days back', () => {
    const from = new Date(rangeFromIso('4w'));
    expect(Math.round((Date.now() - from.getTime()) / 86400000)).toBe(28);
  });
});
```

- [ ] **Step 2: Implement** `app/src/lib/buckets.ts`:

```ts
const pad = (n: number) => String(n).padStart(2, '0');

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localDayKey(iso: string): string {
  return dayKeyOf(new Date(iso));
}

/** Local Monday of the ISO string's week. */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return dayKeyOf(monday);
}

export function bucketSum(
  rows: Array<{ iso: string; value: number }>,
  keyFn: (iso: string) => string,
): Array<{ key: string; value: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row.iso);
    map.set(key, (map.get(key) ?? 0) + row.value);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value }));
}

export const RANGES = ['4w', '12w', '6m', '1y'] as const;
export type RangeKey = (typeof RANGES)[number];
const RANGE_DAYS: Record<RangeKey, number> = { '4w': 28, '12w': 84, '6m': 182, '1y': 365 };

export function rangeFromIso(range: RangeKey): string {
  return new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString();
}
```

- [ ] **Step 3: Hooks** — `app/src/lib/trends.ts` per train.ts conventions (`InferResponseType`, raw fetch ONLY where the RPC input type rejects the call — `/trends/strength/:exerciseId` has a param + query, check whether `api.trends.strength[':exerciseId'].$get({ param, query })` compiles; volume + nutrition-body are plain GETs with query):
  - `useStrengthTrend(exerciseId, fromIso)` key `['trends','strength',exerciseId,fromIso]` (enabled only when exerciseId non-empty)
  - `useVolumeTrend(fromIso)` key `['trends','volume',fromIso]`
  - `useNutritionBodyTrend(fromIso)` key `['trends','nutrition-body',fromIso]`
  - Sleep trend: reuse existing `useSleep(fromIso, nowIso)`.
  - staleTime 5min on all.

- [ ] **Step 4: Chart components.** `app/src/components/charts/LineChart.tsx`:

```tsx
type Series = { points: Array<{ x: number; y: number }>; stroke: string; dashed?: boolean };

/** Minimal token-colored line chart. x/y are raw values; scales computed from data. */
export function LineChart({ series, height = 160, yUnit = '' }: { series: Series[]; height?: number; yUnit?: string }) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const w = 600;
  const padX = 8;
  const padY = 16;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number) => (xMax === xMin ? w / 2 : padX + ((x - xMin) / (xMax - xMin)) * (w - 2 * padX));
  const sy = (y: number) => (yMax === yMin ? height / 2 : height - padY - ((y - yMin) / (yMax - yMin)) * (height - 2 * padY));
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height: 'auto' }} role="img">
        {series.map((s, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={s.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={s.dashed ? '6 5' : undefined}
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          />
        ))}
        {series.map((s, i) =>
          s.points.map((p, j) => <circle key={`${i}-${j}`} cx={sx(p.x)} cy={sy(p.y)} r={3} fill={s.stroke} />),
        )}
      </svg>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{yMin === yMax ? '' : `${yMin}${yUnit}`}</span>
        <span className="muted">{`${yMax}${yUnit}`}</span>
      </div>
    </div>
  );
}
```

`Sparkline.tsx`: same scaling over one series, `width 120 height 32`, no dots/labels, stroke `var(--accent)`.

- [ ] **Step 5:** Gate (`npm test -w app` 57 — 6 new bucket tests; root typecheck) + commit `feat: add chart primitives, bucketing helpers, and trend hooks`

---

### Task 3: TrendsPage

**Files:**
- Modify: `app/src/pages/TrendsPage.tsx` (replace placeholder)
- Test: `app/src/pages/TrendsPage.test.tsx`

i18n additions (both catalogs): `trends.range.4w` '4w'/'4週', `trends.range.12w` '12w'/'12週', `trends.range.6m` '6m'/'6ヶ月', `trends.range.1y` '1y'/'1年', `trends.strength` 'Strength' / '筋力', `trends.pickExercise` 'Choose an exercise' / '種目を選択', `trends.topSet` 'Top set' / 'トップセット', `trends.est1rm` 'Est. 1RM' / '推定1RM', `trends.volume` 'Weekly volume' / '週間ボリューム', `trends.nutritionBody` 'Nutrition vs body' / '栄養と体組成', `trends.kcalPerDay` 'kcal/day' / 'kcal/日', `trends.weightLine` 'Weight' / '体重', `trends.sleep` 'Sleep' / '睡眠', `trends.avg` 'avg' / '平均', `trends.noData` 'Not enough data yet — keep logging!' / 'まだデータが足りません — 記録を続けましょう！'.

Behavior:
- Range selector: four `.btn` chips (active chip `btn-primary`), state `range: RangeKey` default '12w'; `fromIso = rangeFromIso(range)` memoized per range (compute once per range change, NOT per render — `useMemo([range])` — Date.now drift would bust query keys).
- **Strength section** (`glow-card`): exercise `<select className="input">` built from `useExercises('')` filtered to exercises the user has actually performed — simplest: options = all non-archived exercises (seed+custom), default = first exercise appearing in `useWorkouts({limit:1})`'s exerciseNames... keep simpler: default empty with `t('trends.pickExercise')`; persist last choice in localStorage (`ba_trend_exercise`). When chosen: LineChart with two series — topWeightKg (solid, `var(--accent)`) and est1rm (dashed, `var(--text-muted)`), x = startedAt epoch; legend line with the two labels. Empty → `t('trends.noData')`.
- **Volume section**: `bucketSum` per week over the volume rows (value = setCount) → CSS bar rows `{weekKey} | bar | N sets`; below, a per-muscle breakdown for the LAST week (chips `muscle.X: N`).
- **Nutrition vs body**: LineChart series 1 = daily kcal (bucketSum by localDayKey over meals' calories, x = epoch of day key); series 2 = weight points (x = measuredAt epoch, y = weightKg, dashed accent-2... use `var(--positive)`). Note units differ — acceptable for v1 (two-series sparkline-style comparison); label both in a legend with last values.
- **Sleep section**: bars per night (duration hours via sleepDurationLabel math — extract minutes inline) + `t('trends.avg')` line text `7h 20m`; data from useSleep(fromIso, now).
- Skeletons per section while pending; every section header via `section-title`.

Tests (3): range chip switches refetch (assert second fetch with smaller from window — spy URLs); strength section renders points after choosing an exercise (mock exercises + trends/strength); volume buckets render (mock volume rows across two weeks → two bars).

Gate (`npm test -w app` 60) + commit `feat: add trends page with four analytics sections`

---

### Task 4: TodayPage dashboard

**Files:**
- Modify: `app/src/pages/TodayPage.tsx` (replace placeholder)
- Test: `app/src/pages/TodayPage.test.tsx`

i18n additions: `today.workout` 'Workout' / 'ワークアウト', `today.restDay` 'Rest day — start one from Train' / '休養日 — トレーニングはTrainタブから', `today.done` 'Done' / '完了', `today.weight` 'Weight' / '体重', `today.sleep` 'Last night' / '昨夜の睡眠', `today.noSleep` 'No sleep logged' / '睡眠記録なし', `today.noWeight` 'No weight logged yet' / '体重記録なし', `today.eaten` 'eaten' / '摂取'.

Behavior (each card a `glow-card` Link):
- **Nutrition card** (→ /health): today's meals via `useMeals(dayRangeIso(new Date()))`; big `{kcal} / {target ?? '—'} kcal` + P/F/C mini-bars (reuse HealthPage's inline bar pattern — extract a small `MacroBars` component into `app/src/components/MacroBars.tsx` and use it on BOTH pages to avoid duplication; refactor HealthPage to import it).
- **Workout card** (→ /train or /train/session): `useActiveWorkout` → active → `is-active` card "In progress · resume"; else `useWorkouts({limit:1})` → if latest startedAt is today → `✓ {t('today.done')}` + exercise names; else `t('today.restDay')`.
- **Weight card** (→ /health): `useMeasurements(rangeFromIso('4w'), nowIso)` → latest weightKg big + Sparkline of the window; empty → `t('today.noWeight')`.
- **Sleep card** (→ /health): last night via `useSleep(dayRangeIso(new Date()))` → duration + quality stars; empty → `t('today.noSleep')`.
- Skeletons while pending.

Tests (2): renders all four cards with data (mock the five GETs; assert kcal sum, ✓ done, weight value, duration); rest-day + empty states render.

Gate (`npm test -w app` 62) + commit `feat: add today dashboard`

---

### Task 5: E2E — test-login endpoint + Playwright suite + CI

**Files:**
- Create: `worker/src/auth/test-login.ts`, `worker/test/test-login.test.ts`, `playwright.config.ts` (root), `e2e/train.spec.ts`, `e2e/health.spec.ts`, `e2e/dashboard.spec.ts`
- Modify: `worker/src/types.ts` (+ `E2E_TEST_LOGIN?: string`), `worker/src/auth/google.ts` or `worker/src/index.ts` (mount), `worker/.dev.vars` (+ `E2E_TEST_LOGIN=1`), root `package.json` (devDep `@playwright/test`, script `"e2e": "playwright test"`), `.github/workflows/ci.yml` (e2e job), `.gitignore` (+ `playwright-report/`, `test-results/`)

- [ ] **Step 1: Worker — TDD the gate.** `worker/test/test-login.test.ts`:

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// E2E_TEST_LOGIN is NOT set in the test bindings, so the endpoint must not exist.
describe('/auth/test-login', () => {
  it('is a 404 when the flag is absent', async () => {
    const res = await SELF.fetch('https://example.com/auth/test-login', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});
```

Implement `worker/src/auth/test-login.ts`:

```ts
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { SESSION_COOKIE } from './middleware';
import { createSession, SESSION_TTL_SECONDS } from './session';
import type { AppEnv } from '../types';

/** Dev/E2E-only sign-in. Mounted unconditionally but hard-gated by env var —
 *  E2E_TEST_LOGIN is set only in .dev.vars and the CI e2e job, never in production. */
export const testLoginRoutes = new Hono<AppEnv>().get('/test-login', async (c) => {
  if (c.env.E2E_TEST_LOGIN !== '1') {
    return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  }
  const db = getDb(c.env.DB);
  const existing = await db.query.users.findFirst({ where: eq(schema.users.googleSub, 'e2e-sub') });
  const userId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await db.insert(schema.users).values({
      id: userId,
      googleSub: 'e2e-sub',
      email: 'e2e@example.com',
      name: 'E2E',
    });
  }
  const token = await createSession(c.env.SESSIONS, userId);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect('/');
});
```

Mount in `worker/src/index.ts`: `app.route('/auth', testLoginRoutes);` (alongside the existing authRoutes mount). Add `E2E_TEST_LOGIN?: string` to `Bindings`. Add `E2E_TEST_LOGIN=1` to `worker/.dev.vars` (gitignored).

- [ ] **Step 2: Playwright.** Root: `npm install -D @playwright/test` (root devDep), script `"e2e": "playwright test"`. `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
```

`e2e/train.spec.ts` (unique names per run keep reruns green against persisted local state):

```ts
import { expect, test } from '@playwright/test';

test('log a workout end to end', async ({ page }) => {
  await page.goto('/auth/test-login');
  await page.getByText('Train', { exact: true }).first().click();

  // Finish any leftover active session from a previous run.
  const resume = page.getByText('Resume workout');
  if (await resume.isVisible().catch(() => false)) {
    await resume.click();
    await page.getByRole('button', { name: 'Finish workout' }).click();
    await page.getByText('Train', { exact: true }).first().click();
  }

  await page.getByRole('button', { name: 'Empty workout' }).click();
  await page.getByRole('button', { name: '+ Add exercise' }).click();
  await page.getByLabel('Search exercises').fill('Bench');
  await page.getByText('Barbell Bench Press').click();

  await page.getByLabel('kg').fill('60');
  await page.getByLabel('reps').fill('10');
  await page.getByRole('button', { name: 'Log set' }).click();
  await expect(page.getByText('60kg × 10')).toBeVisible();

  await page.getByRole('button', { name: 'Finish workout' }).click();
  await expect(page.getByText('Barbell Bench Press')).toBeVisible(); // detail page
});
```

`e2e/health.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('log a meal via quick-log and see totals', async ({ page }) => {
  const mealName = `E2E Meal ${Date.now()}`;
  await page.goto('/auth/test-login');
  await page.getByRole('button', { name: 'Quick log' }).click();
  await page.getByRole('button', { name: 'Log a meal' }).click();
  await page.getByLabel('Meal').fill(mealName);
  await page.getByLabel('kcal').fill('480');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(mealName)).toBeVisible();
});
```

`e2e/dashboard.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('today and trends render', async ({ page }) => {
  await page.goto('/auth/test-login');
  await expect(page.getByText('Today').first()).toBeVisible();
  await page.getByText('Trends', { exact: true }).first().click();
  await expect(page.getByText('Weekly volume')).toBeVisible();
});
```

(Adjust selectors to the real aria-labels/strings if they differ — run locally and fix; the EN locale is the default in a fresh chromium profile.)

- [ ] **Step 3: CI.** Append an `e2e` job to `.github/workflows/ci.yml`:

```yaml
  e2e:
    runs-on: ubuntu-latest
    needs: ci
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: printf 'GOOGLE_CLIENT_ID=ci\nGOOGLE_CLIENT_SECRET=ci\nE2E_TEST_LOGIN=1\n' > worker/.dev.vars
      - run: npm run e2e
```

- [ ] **Step 4:** Run the suite locally (`npm run e2e`) until all three specs pass — fix selectors as needed (report any changes). Worker tests: 74 (the gate test). Gate root typecheck.
- [ ] **Step 5:** Commit `feat: add e2e smoke suite with gated test login`

---

### Task 6: Deploy + v1 wrap

- [ ] No new migrations. `npm run deploy`.
- [ ] PRODUCTION CHECK: `curl -s -o /dev/null -w '%{http_code}' https://bodyatlas.okdtsk.dev/auth/test-login` → MUST be 404 (flag unset in prod). Use WebFetch/browser if curl unavailable.
- [ ] Browser smoke (user): Trends with real training data (strength chart for Bench Press, volume bars, nutrition/weight overlay, sleep bars); Today dashboard cards; range chips.
- [ ] CLAUDE.md: mark v1 COMPLETE (all four plans shipped; phase 2 next: MCP server, AI coach, iOS shell, offline queue). Commit `docs: v1 complete`.

---

## Plan self-review (authoring time)

- Spec v1 coverage complete: all four analytics ✓ (strength w/ est 1RM, weekly volume by muscle group, nutrition vs body, sleep consistency), shared range selector ✓, Today dashboard ✓, E2E smoke with stubbed auth ✓ (spec's "stubbed OAuth" realized as the gated test-login). Desktop trends benefit automatically (charts are full-width).
- Test-login security: hard 404 unless env flag; flag lives only in gitignored .dev.vars + CI env; prod check step makes it explicit.
- Charts kept dependency-free; mixed-unit overlay in nutrition-vs-body flagged as v1-acceptable.
- Known risks: Playwright selectors against live UI (Step 4 explicitly iterates locally); vite-plugin local D1 state persistence (specs written rerun-tolerant); volume map keyed by startedAt+muscle (two same-instant workouts merge — acceptable, impossible in practice with single-active rule).
