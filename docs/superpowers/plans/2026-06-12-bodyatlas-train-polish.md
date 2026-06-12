# BodyAtlas Train Polish Implementation Plan (Plan 2c)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-feedback refinements on the shipped Train tab: no input-zoom on iOS, skeleton loading states, per-set notes, editable workout start/end times, target-sets surfaced as session progress, and the "Athletic Glow" visual direction (user-selected mockup C) applied across the Train tab.

**Architecture:** Mostly app-side. One additive migration (0003: `sets.note`, `workout_exercises.target_sets`), small shared-schema and route extensions. Design stays token-driven so all three themes get the treatment; glow effects derive from `--accent` via `color-mix`.

**Tech Stack / conventions:** unchanged (see prior plans). 98 tests green at start (15 shared / 52 worker / 31 app).

**Design reference (mockup C):** session header with a progress ring (total sets done / planned) and elapsed minutes; exercise cards with progress pips, "+2.5kg vs last time" delta, soft accent glow on the active card; per-set note shown as a muted italic line; up-next cards dimmed with "N sets planned".

---

### Task 1: API v3 — set notes, workout-exercise targets, editable times

**Files:**
- Modify: `worker/src/db/schema.ts`, `shared/src/workout.ts`, `shared/src/workout.test.ts`, `worker/src/routes/workouts.ts`, `worker/test/workouts.test.ts`
- Generated: `worker/migrations/0003_set_notes_and_targets.sql`

- [ ] **Step 1: Failing tests first.** Append to `worker/test/workouts.test.ts`:

```ts
describe('plan 2c API extensions', () => {
  it('persists a note on a set and returns it in detail', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises`,
        json(headers, { exerciseId: 'seed-barbell-bench-press' }),
      )
    ).json()) as { id: string };
    const set = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
        json(headers, { weightKg: 80, reps: 8, note: '最後だけフォームが崩れた' }),
      )
    ).json()) as { note: string | null };
    expect(set.note).toBe('最後だけフォームが崩れた');
  });

  it('copies targetSets from the template onto workout exercises', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Push A', ['seed-barbell-bench-press']);
    const db = getDb(env.DB);
    await db
      .update(schema.templateExercises)
      .set({ targetSets: 3 })
      .where(eq(schema.templateExercises.templateId, 't1'));
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, { templateId: 't1' }));
    const created = (await res.json()) as { workoutExercises: Array<{ targetSets: number | null }> };
    expect(created.workoutExercises[0]?.targetSets).toBe(3);
  });

  it('updates startedAt and endedAt via PATCH', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w1',
      json(headers, { startedAt: '2026-06-01T09:30:00.000Z', endedAt: '2026-06-01T10:45:00.000Z' }, 'PATCH'),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as { startedAt: string; endedAt: string };
    expect(new Date(updated.startedAt).toISOString()).toBe('2026-06-01T09:30:00.000Z');
    expect(new Date(updated.endedAt).toISOString()).toBe('2026-06-01T10:45:00.000Z');
  });

  it('rejects endedAt before startedAt with 422', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w1',
      json(headers, { endedAt: '2026-05-01T09:00:00.000Z' }, 'PATCH'), // before existing startedAt 2026-06-01
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_time_range');
  });
});
```

Add `import { env } from 'cloudflare:test';`, `import { eq } from 'drizzle-orm';`, `import { getDb, schema } from '../src/db';` to the test file imports if missing, and move/reuse the existing `startWorkout` helper so this describe can use it (extract it to file scope if it currently lives inside another describe).

Also append to `shared/src/workout.test.ts`:

```ts
describe('plan 2c schema extensions', () => {
  it('accepts a note on a set and trims it', () => {
    const r = setInputSchema.safeParse({ reps: 8, note: ' フォーム良し ' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.note).toBe('フォーム良し');
  });
  it('accepts ISO datetimes on workout update and rejects garbage', () => {
    expect(updateWorkoutSchema.safeParse({ startedAt: '2026-06-01T09:30' }).success).toBe(true);
    expect(updateWorkoutSchema.safeParse({ endedAt: 'not-a-date' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run, observe failures.**

- [ ] **Step 3: Schema columns.** In `worker/src/db/schema.ts` add to `sets`: `note: text('note'),` and to `workoutExercises`: `targetSets: integer('target_sets'),`. Generate: `npm run db:generate -w worker -- --name set_notes_and_targets` → confirm `0003_*.sql` contains exactly two `ALTER TABLE ... ADD COLUMN` statements (non-destructive).

- [ ] **Step 4: Shared schemas.** In `shared/src/workout.ts`:

```ts
const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), { message: 'Invalid datetime' });
```

Add to the `setInputSchema` object (inside `z.object`, before `.refine`): `note: z.string().trim().min(1).max(200).optional(),`

Replace `updateWorkoutSchema`:

```ts
export const updateWorkoutSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  finish: z.boolean().optional(),
  startedAt: isoDateString.optional(),
  endedAt: isoDateString.optional(),
});
```

- [ ] **Step 5: Routes.** In `worker/src/routes/workouts.ts`:
- Template create path: copy targets — change the template branch to collect `{ exerciseId, targetSets }` pairs and include `targetSets: te.targetSets` in the inserted `workoutExercises` rows (copy path keeps the source's `targetSets` likewise via `we.targetSets ?? null`; empty/copy-default null).
- Set create/update handlers: include `note: input.note ?? null` in the inserted/updated set objects.
- PATCH `/:id` handler — replace the update logic:

```ts
const input = c.req.valid('json');
const newStartedAt = input.startedAt ? new Date(input.startedAt) : existing.startedAt;
const newEndedAt = input.endedAt
  ? new Date(input.endedAt)
  : input.finish
    ? new Date()
    : existing.endedAt;
if (newEndedAt && newStartedAt > newEndedAt) {
  return c.json(
    { error: { code: 'invalid_time_range', message: 'endedAt must be after startedAt' } },
    422,
  );
}
await db
  .update(schema.workouts)
  .set({
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(input.startedAt ? { startedAt: newStartedAt } : {}),
    ...(input.endedAt || input.finish ? { endedAt: newEndedAt } : {}),
  })
  .where(eq(schema.workouts.id, id));
```

- [ ] **Step 6: Gate + commit.** `npm test && npm run typecheck` from root (expect 56 worker / 17 shared / 31 app). Commit: `feat: add set notes, workout-exercise targets, and editable workout times`

---

### Task 2: App foundations — no-zoom CSS, skeletons, glow tokens, i18n, helpers

**Files:**
- Modify: `app/src/styles/base.css`, `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`, `app/src/lib/format.ts`, `app/src/lib/format.test.ts`
- Create: `app/src/components/Skeleton.tsx`, `app/src/components/ProgressRing.tsx`, `app/src/components/Pips.tsx`

- [ ] **Step 1: CSS.** Append to `app/src/styles/base.css`:

```css
/* --- Plan 2c: input zoom fix, skeletons, athletic glow --- */
.input,
select.input,
textarea.input {
  font-size: 16px; /* <16px makes iOS Safari zoom on focus */
}

@keyframes shimmer {
  to {
    background-position: -200% 0;
  }
}

.skeleton {
  background: linear-gradient(90deg, var(--surface-2) 25%, var(--border) 50%, var(--surface-2) 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s linear infinite;
  border-radius: var(--radius);
}

.glow-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 14px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
}

.glow-card.is-active {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 22%, transparent);
}

.glow-card.is-upnext {
  opacity: 0.72;
}

.pips {
  display: inline-flex;
  gap: 3px;
}

.pip {
  width: 14px;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-2);
}

.pip.on {
  background: var(--accent);
}

.delta-up {
  color: var(--positive);
  font-weight: 700;
}

.delta-down {
  color: var(--text-muted);
}

.session-header {
  display: flex;
  align-items: center;
  gap: 14px;
}

.eyebrow {
  font-size: 10px;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: var(--text-muted);
}

.set-note {
  color: var(--text-muted);
  font-size: 12px;
  font-style: italic;
}
```

- [ ] **Step 2: i18n.** Append to both catalogs (EN / JA):

```
'set.note': 'Note' / 'メモ'
'set.notePlaceholder': 'e.g. form broke down on the last rep' / '例: 最後だけフォームが崩れた'
'train.vsLast': 'vs last time' / '前回比'
'train.setsPlanned': 'sets planned' / 'セット予定'
'train.upNext': 'Up next' / '次の種目'
'train.totalSets': 'total sets' / '合計セット'
'train.elapsedMin': 'min' / '分'
'train.startTime': 'Start time' / '開始時刻'
'train.endTime': 'End time' / '終了時刻'
'train.invalidTimeRange': 'End time must be after start time.' / '終了時刻は開始時刻より後にしてください。'
```

(Exact TS syntax as the existing entries; JA file order must mirror EN.)

- [ ] **Step 3: Helpers, TDD.** Append failing tests to `app/src/lib/format.test.ts`:

```ts
import { toLocalInputValue, weightDelta } from './format';

describe('weightDelta', () => {
  const s = (weightKg: number | null) => ({ weightKg, reps: 5, rpe: null, durationSec: null, distanceM: null });
  it('compares top weights', () => {
    expect(weightDelta([s(82.5), s(80)], [s(80), s(80)])).toBe(2.5);
  });
  it('returns null when either side has no weight', () => {
    expect(weightDelta([s(null)], [s(80)])).toBeNull();
    expect(weightDelta([], [s(80)])).toBeNull();
  });
});

describe('toLocalInputValue', () => {
  it('formats an ISO string for datetime-local inputs', () => {
    const v = toLocalInputValue('2026-06-01T09:30:00.000Z');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(new Date(v).getMinutes()).toBe(new Date('2026-06-01T09:30:00.000Z').getMinutes());
  });
});
```

Implement in `app/src/lib/format.ts`:

```ts
export function weightDelta(
  current: Array<{ weightKg: number | null }>,
  last: Array<{ weightKg: number | null }>,
): number | null {
  const top = (arr: Array<{ weightKg: number | null }>) =>
    arr.reduce<number | null>(
      (m, s) => (s.weightKg !== null && (m === null || s.weightKg > m) ? s.weightKg : m),
      null,
    );
  const c = top(current);
  const l = top(last);
  if (c === null || l === null) return null;
  return Math.round((c - l) * 100) / 100;
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
```

- [ ] **Step 4: Components.** `app/src/components/Skeleton.tsx`:

```tsx
export function Skeleton({ height = 64, count = 1 }: { height?: number; count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton" style={{ height }} aria-hidden />
      ))}
    </>
  );
}
```

`app/src/components/ProgressRing.tsx`:

```tsx
export function ProgressRing({ done, total }: { done: number; total: number | null }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = total && total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${done}${total ? `/${total}` : ''}`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
      {total !== null && total > 0 && (
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 32 32)"
        />
      )}
      <text x="32" y="37" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="800">
        {total && total > 0 ? `${done}/${total}` : done}
      </text>
    </svg>
  );
}
```

`app/src/components/Pips.tsx`:

```tsx
export function Pips({ done, planned }: { done: number; planned: number | null }) {
  const total = Math.max(done, planned ?? 0);
  if (total === 0 || total > 12) return null; // sanity cap for layout
  return (
    <span className="pips" aria-label={`${done}/${planned ?? done}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'pip on' : 'pip'} />
      ))}
    </span>
  );
}
```

- [ ] **Step 5: Gate + commit.** `npm test -w app && npm run typecheck -w app` (34 app tests). Commit: `feat: add zoom-safe inputs, skeletons, and athletic-glow primitives`

---

### Task 3: SessionPage — Athletic Glow redesign + set notes + skeletons

**Files:**
- Modify: `app/src/pages/SessionPage.tsx`, `app/src/components/SetInputRow.tsx`, `app/src/components/SetInputRow.test.tsx`, `app/src/pages/SessionPage.test.tsx`, `app/src/components/AppLayout.tsx`

Behavior (mockup C):
- Header: `session-header` with `ProgressRing` (done = all logged sets; total = sum of `targetSets` over exercises, or null when no exercise has a target), an `eyebrow` line `PUSH DAY A — 24 MIN`-style (template name omitted if none; elapsed minutes re-render every 30s via an interval `useReducer` tick), and the Finish button.
- Exercise cards: `glow-card`; the FIRST exercise whose `sets.length < (targetSets ?? Infinity)` and has fewest sets gets `is-active` — simpler rule (use it): the first card with zero sets after a card with sets, or the last card with any sets; if that's ambiguous, mark the LAST card that has at least one set, else the first card. Implement as: `activeIndex = max(lastIndexWith(sets.length>0), 0)`.
- Card header row: name + `Pips done={sets.length} planned={targetSets}`.
- Delta line: when ghosts exist and `weightDelta(we.sets, last.sets)` is non-null and ≠ 0, render `+2.5kg {t('train.vsLast')} ↗` with `delta-up` (positive) / `delta-down` (negative, e.g. `-2.5kg ... ↘`); when 0 or null fall back to the existing ghost line.
- Cards with zero sets AND a later position than the active card render `is-upnext` with `{t('train.upNext')} · {targetSets} {t('train.setsPlanned')}` when targets exist.
- Set rows show `s.note` under the row as `.set-note` when present.
- Loading state: replace the bare `…` with `<Skeleton height={120} count={3} />` inside the section.
- **SetInputRow note field:** add a `✎` toggle button (aria-label `t('set.note')`); when open, a full-width `.input` text field (placeholder `t('set.notePlaceholder')`, maxLength 200) on a second line; `build()` includes `...(note.trim() !== '' ? { note: note.trim() } : {})`; `initial` gains `note?: string`. The note input is `inputMode` default (text), `font-size` 16px via `.input`.
- **FAB:** in `AppLayout.tsx`, hide the FAB on the session route: `const { pathname } = useLocation();` and render the FAB + sheet only when `pathname !== '/train/session'` (the quick-log action is redundant mid-session).

Tests:
- Update `SetInputRow.test.tsx`: new test — open the note toggle, type a note, submit a strength set, expect payload to include `note`.
- Update `SessionPage.test.tsx`: extend the `activeWorkout` fixture sets with `note: null` and `targetSets: 3` on we1; new assertions in the render test — pips aria-label `1/3` present; a fixture set with `note: 'フォーム良し'` renders that text. Keep existing tests passing (mock shapes now include the new columns).
- Gate: `npm test -w app && npm run typecheck -w app` (36 app tests). Commit: `feat: redesign session screen with progress ring, pips, deltas, and set notes`

---

### Task 4: WorkoutDetailPage — editable times + notes-on-sets + glow styling

**Files:**
- Modify: `app/src/pages/WorkoutDetailPage.tsx`, `app/src/pages/WorkoutDetailPage.test.tsx`, `app/src/lib/train.ts`

Behavior:
- `useUpdateWorkout` mutation input type extends with `startedAt?: string; endedAt?: string` (already accepted by the worker; the RPC type updates automatically — just pass through).
- Two `datetime-local` inputs (labels `t('train.startTime')` / `t('train.endTime')`), values via `toLocalInputValue`, saved onBlur when changed: `update.mutate({ startedAt: new Date(value).toISOString() })` (resp. endedAt). On 422 (mutation error), show `t('train.invalidTimeRange')` instead of the generic error.
- DetailExercise cards become `glow-card`; set rows show `.set-note` lines; the set edit form passes `initial.note` and the SetInputRow note toggle handles editing (FULL-VALUE PATCH naturally includes/omits it).
- Loading state: `<Skeleton height={120} count={3} />`.

Tests (`WorkoutDetailPage.test.tsx`):
- Fixture sets gain `note` values; assert a note renders.
- New test: changing the start-time input and blurring fires PATCH with an ISO `startedAt` (assert the PATCH body contains `startedAt` and parses to the chosen local time).
- Keep the existing 3 tests green (extend fixture columns).
- Gate (39 app tests expected). Commit: `feat: add editable workout times and set notes to detail page`

---

### Task 5: TrainPage / ExercisesPage / TemplateEditor — glow styling + skeletons

**Files:**
- Modify: `app/src/pages/TrainPage.tsx`, `app/src/pages/ExercisesPage.tsx`, `app/src/pages/ExerciseHistoryPage.tsx`, `app/src/pages/TemplateEditorPage.tsx`

Apply consistently (no behavior changes, so existing tests must stay green unchanged):
- Replace `card` with `glow-card` on: resume card (`is-active` modifier for the glow), template rows, recent-workout rows, exercise rows, history rows, template-editor rows.
- TrainPage: resume card gains an `eyebrow` line (`IN PROGRESS` via `t('train.inProgress')`) and bolder time; section titles keep `.section-title`; recent rows show `setCount` with bold numerals (wrap the count in `<strong>`).
- Loading states: TrainPage templates/recent lists, ExercisesPage list, ExerciseHistoryPage list, TemplateEditor (edit mode) all render `<Skeleton height={72} count={3} />` while their query `isPending`.
- ExerciseHistoryPage: include the exercise name in the `<h1>` when resolvable — fetch via `useExercises('')` and find by id; fall back to `t('train.history')`.
- Gate: full root `npm test && npm run typecheck && npm run build`. Commit: `feat: apply athletic-glow styling and skeletons across Train tab`

---

### Task 6: Deploy

- [ ] `npx wrangler d1 migrations apply bodyatlas --remote --config worker/wrangler.jsonc` → 0003 applied.
- [ ] `npm run deploy`.
- [ ] Browser smoke (user): inputs no longer zoom on focus (iPhone); skeletons replace blank flashes; session shows ring/pips/deltas; add a set note 「最後だけフォームが崩れた」; edit a workout's start time; check Clinical Light + Warm Journal still look right (glow derives from their accents).
- [ ] CLAUDE.md status line + commit `docs: update status for train polish`.

---

## Plan self-review (authoring time)

- All six user feedback items mapped: zoom→T2 CSS; empty-flash→T2/T3/T4/T5 skeletons; target-sets meaning→surfaced as ring/pips (T1 copies targets, T3 renders); editable times→T1 API + T4 UI; per-set memo→T1 column + T3/T4 UI (named `note`, label メモ/Note); design→T2 primitives + T3/T4/T5 application of mockup C.
- Migration is additive only (two ADD COLUMNs); FULL-VALUE set PATCH naturally carries `note`.
- Risk: `color-mix` requires modern browsers — fine for Safari/Chrome 2026. Active-card heuristic is intentionally simple; refine later if it feels wrong.
