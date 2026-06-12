# BodyAtlas Workout UI Implementation Plan (Plan 2b of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete Train tab: start sessions (template / repeat-last / empty), the active-session logging screen with previous-performance ghosts, history by date and by exercise, template and custom-exercise management, and a working quick-log "Log a set" action.

**Architecture:** Pure client work in `app/` against the deployed Plan 2a API via the typed `hc<AppType>` client. TanStack Query owns server state (query keys documented below); react-router nested routes under `/train`. All styling via existing design tokens + a small utility-class layer added once.

**Tech Stack:** unchanged. RTL + jsdom for component tests (fetch stubbed per test via a small `mockApi` helper).

**Spec:** `docs/superpowers/specs/2026-06-12-bodyatlas-design.md` (Train screen section). API reference: `worker/src/routes/{exercises,templates,workouts}.ts` — read these when in doubt; the RPC types are the contract.

**Facts to honor (from Plan 2a final review):**
- Timestamps cross the RPC boundary as **ISO strings** — always `new Date(value)` client-side; never type them as `Date`.
- `GET /api/workouts/active` → `{ workout: WorkoutDetail | null }`. `POST /api/workouts` → 201 detail, or **409** `{ error: { code: 'active_workout_exists', details: { workoutId } } }` — the UI treats 409 as "resume".
- `GET /api/exercises/:id/last-sets?excludeWorkoutId=` → `{ workoutId, startedAt, sets[] } | null` — the ghost data.
- Custom exercises have `nameEn` only (`nameJa` null) — display falls back automatically.
- Editing finished workouts is intended behavior (locked by test).
- Set PATCH is FULL-VALUE: send every field on edit.

## Screen map & routes (all under the existing AppLayout route)

```
/train                      TrainPage        resume card | start options | recent history
/train/session              SessionPage      active workout logging (redirect → /train if none)
/train/workouts/:id         WorkoutDetailPage  view/edit a past workout
/train/exercises            ExercisesPage    browse/search catalog, create custom, archive
/train/exercises/:id        ExerciseHistoryPage  per-exercise past performances
/train/templates/new        TemplateEditorPage (create)
/train/templates/:id        TemplateEditorPage (edit)
```

## Query keys (single source of truth — define once in hooks file)

```
['exercises', q]                      list (q = search string or '')
['templates']                         list
['workouts', 'active']                { workout | null }
['workouts', 'list', filters]         summaries
['workouts', 'detail', id]            full detail
['last-sets', exerciseId, excludeId]  ghosts
```
Mutations invalidate: any workout mutation → `['workouts']` prefix; template mutations → `['templates']`; exercise mutations → `['exercises']` prefix.

## File structure (new)

```
app/src/lib/train.ts                 # all hooks + helpers for the workout domain
app/src/lib/format.ts                # set/date display formatting (+ tests)
app/src/test/mockApi.ts              # fetch stub helper for RTL tests
app/src/components/SetInputRow.tsx   # type-aware set entry form
app/src/components/ExercisePicker.tsx# search sheet + inline custom creation
app/src/pages/TrainPage.tsx          # replaces placeholder
app/src/pages/SessionPage.tsx
app/src/pages/WorkoutDetailPage.tsx
app/src/pages/ExercisesPage.tsx
app/src/pages/ExerciseHistoryPage.tsx
app/src/pages/TemplateEditorPage.tsx
```

---

### Task 1: i18n keys + utility CSS layer

**Files:**
- Modify: `app/src/i18n/en.ts`, `app/src/i18n/ja.ts`, `app/src/styles/base.css`

- [ ] **Step 1: Append to `app/src/i18n/en.ts`** (inside the `en` object, before the closing `}`):

```ts
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.back': 'Back',
  'common.confirmDelete': 'Delete this? This cannot be undone.',
  'train.resume': 'Resume workout',
  'train.inProgress': 'Workout in progress',
  'train.start': 'Start a workout',
  'train.empty': 'Empty workout',
  'train.repeatLast': 'Repeat last workout',
  'train.fromTemplate': 'Templates',
  'train.newTemplate': 'New template',
  'train.editTemplate': 'Edit template',
  'train.templateName': 'Template name',
  'train.targetSets': 'Target sets',
  'train.recent': 'Recent workouts',
  'train.noWorkouts': 'No workouts yet — start your first one!',
  'train.browseExercises': 'Exercise catalog',
  'train.finish': 'Finish workout',
  'train.finished': 'Finished',
  'train.addExercise': 'Add exercise',
  'train.logSet': 'Log set',
  'train.updateSet': 'Update set',
  'train.lastTime': 'Last time',
  'train.noPrevious': 'First time — no previous data',
  'train.sets': 'sets',
  'train.notes': 'Notes',
  'train.deleteWorkout': 'Delete workout',
  'train.history': 'History',
  'train.startedAt': 'Started',
  'exercise.search': 'Search exercises',
  'exercise.create': 'Create exercise',
  'exercise.name': 'Exercise name',
  'exercise.type': 'Type',
  'exercise.muscleGroup': 'Muscle group',
  'exercise.equipment': 'Equipment',
  'exercise.archive': 'Archive',
  'exercise.archived': 'Archived',
  'exercise.custom': 'Custom',
  'exercise.noResults': 'No exercises found',
  'field.weight': 'kg',
  'field.reps': 'reps',
  'field.rpe': 'RPE',
  'field.duration': 'min',
  'field.distance': 'km',
  'type.strength': 'Strength',
  'type.bodyweight': 'Bodyweight',
  'type.cardio': 'Cardio',
  'muscle.chest': 'Chest',
  'muscle.back': 'Back',
  'muscle.shoulders': 'Shoulders',
  'muscle.arms': 'Arms',
  'muscle.legs': 'Legs',
  'muscle.core': 'Core',
  'muscle.full-body': 'Full body',
  'equip.barbell': 'Barbell',
  'equip.dumbbell': 'Dumbbell',
  'equip.machine': 'Machine',
  'equip.cable': 'Cable',
  'equip.kettlebell': 'Kettlebell',
  'equip.bodyweight': 'Bodyweight',
  'equip.band': 'Band',
  'equip.cardio-machine': 'Cardio machine',
  'equip.other': 'Other',
```

- [ ] **Step 2: Append the same keys to `app/src/i18n/ja.ts`:**

```ts
  'common.save': '保存',
  'common.cancel': 'キャンセル',
  'common.delete': '削除',
  'common.edit': '編集',
  'common.add': '追加',
  'common.back': '戻る',
  'common.confirmDelete': '削除しますか？この操作は取り消せません。',
  'train.resume': 'ワークアウトを再開',
  'train.inProgress': 'ワークアウト実施中',
  'train.start': 'ワークアウトを開始',
  'train.empty': '空のワークアウト',
  'train.repeatLast': '前回のワークアウトを繰り返す',
  'train.fromTemplate': 'テンプレート',
  'train.newTemplate': '新規テンプレート',
  'train.editTemplate': 'テンプレートを編集',
  'train.templateName': 'テンプレート名',
  'train.targetSets': '目標セット数',
  'train.recent': '最近のワークアウト',
  'train.noWorkouts': 'まだワークアウトがありません — 最初の記録を始めましょう！',
  'train.browseExercises': '種目カタログ',
  'train.finish': 'ワークアウト終了',
  'train.finished': '終了済み',
  'train.addExercise': '種目を追加',
  'train.logSet': 'セットを記録',
  'train.updateSet': 'セットを更新',
  'train.lastTime': '前回',
  'train.noPrevious': '初挑戦 — 前回データなし',
  'train.sets': 'セット',
  'train.notes': 'メモ',
  'train.deleteWorkout': 'ワークアウトを削除',
  'train.history': '履歴',
  'train.startedAt': '開始',
  'exercise.search': '種目を検索',
  'exercise.create': '種目を作成',
  'exercise.name': '種目名',
  'exercise.type': 'タイプ',
  'exercise.muscleGroup': '部位',
  'exercise.equipment': '器具',
  'exercise.archive': 'アーカイブ',
  'exercise.archived': 'アーカイブ済み',
  'exercise.custom': 'カスタム',
  'exercise.noResults': '種目が見つかりません',
  'field.weight': 'kg',
  'field.reps': '回',
  'field.rpe': 'RPE',
  'field.duration': '分',
  'field.distance': 'km',
  'type.strength': 'ウェイト',
  'type.bodyweight': '自重',
  'type.cardio': '有酸素',
  'muscle.chest': '胸',
  'muscle.back': '背中',
  'muscle.shoulders': '肩',
  'muscle.arms': '腕',
  'muscle.legs': '脚',
  'muscle.core': '体幹',
  'muscle.full-body': '全身',
  'equip.barbell': 'バーベル',
  'equip.dumbbell': 'ダンベル',
  'equip.machine': 'マシン',
  'equip.cable': 'ケーブル',
  'equip.kettlebell': 'ケトルベル',
  'equip.bodyweight': '自重',
  'equip.band': 'バンド',
  'equip.cardio-machine': '有酸素マシン',
  'equip.other': 'その他',
```

- [ ] **Step 3: Run the catalog parity test** — `npm test -w app` → still green (the existing messages test + ja's `Record<MessageKey,string>` type enforce parity; a missing key fails compile).

- [ ] **Step 4: Append utility classes to `app/src/styles/base.css`:**

```css
/* --- utility layer (Plan 2b) --- */
.stack {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
}

.card.tappable {
  cursor: pointer;
}

.muted {
  color: var(--text-muted);
  font-size: 13px;
}

.section-title {
  font-size: 12px;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin: 16px 0 8px;
}

.btn {
  padding: 10px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  font-weight: 600;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-contrast);
}

.btn-danger {
  background: transparent;
  border-color: var(--negative);
  color: var(--negative);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.input {
  padding: 10px;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  width: 100%;
}

.input-num {
  width: 72px;
  text-align: center;
}

.error-text {
  color: var(--negative);
  font-size: 13px;
}

.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: flex-end;
  z-index: 20;
}

.sheet-panel {
  background: var(--surface);
  border-radius: var(--radius) var(--radius) 0 0;
  border-top: 2px solid var(--accent);
  padding: 16px;
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  max-height: 80dvh;
  overflow-y: auto;
}
```

- [ ] **Step 5: Typecheck + commit**

```bash
npm run typecheck -w app && npm test -w app
git add app/src
git commit -m "feat: add train-domain i18n keys and utility CSS layer"
```

---

### Task 2: Format helpers + data hooks

**Files:**
- Create: `app/src/lib/format.ts`, `app/src/lib/train.ts`
- Test: `app/src/lib/format.test.ts`

- [ ] **Step 1: Write the failing test** — `app/src/lib/format.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { exerciseName, formatSet, trimNum } from './format';

describe('trimNum', () => {
  it('drops trailing zeros', () => {
    expect(trimNum(80)).toBe('80');
    expect(trimNum(82.5)).toBe('82.5');
    expect(trimNum(82.25)).toBe('82.25');
  });
});

describe('formatSet', () => {
  it('formats a strength set', () => {
    expect(formatSet({ weightKg: 80, reps: 8, rpe: 8.5, durationSec: null, distanceM: null })).toBe(
      '80kg × 8 @8.5',
    );
  });
  it('formats a bodyweight set', () => {
    expect(formatSet({ weightKg: null, reps: 12, rpe: null, durationSec: null, distanceM: null })).toBe(
      '× 12',
    );
  });
  it('formats cardio duration + distance', () => {
    expect(
      formatSet({ weightKg: null, reps: null, rpe: null, durationSec: 1500, distanceM: 5000 }),
    ).toBe('25:00 · 5km');
  });
});

describe('exerciseName', () => {
  const ex = { nameEn: 'Bench Press', nameJa: 'ベンチプレス' };
  it('prefers Japanese in ja locale with EN fallback', () => {
    expect(exerciseName(ex, 'ja')).toBe('ベンチプレス');
    expect(exerciseName({ nameEn: 'Custom', nameJa: null }, 'ja')).toBe('Custom');
    expect(exerciseName(ex, 'en')).toBe('Bench Press');
  });
});
```

- [ ] **Step 2: Run, observe failure**, then implement `app/src/lib/format.ts`:

```ts
import type { Locale } from '@bodyatlas/shared';

export function trimNum(n: number): string {
  return String(n);
}

type SetValues = {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  durationSec: number | null;
  distanceM: number | null;
};

export function formatSet(s: SetValues): string {
  const parts: string[] = [];
  if (s.weightKg !== null && s.reps !== null) {
    parts.push(`${trimNum(s.weightKg)}kg × ${s.reps}`);
  } else if (s.reps !== null) {
    parts.push(`× ${s.reps}`);
  }
  if (s.durationSec !== null) {
    const m = Math.floor(s.durationSec / 60);
    const sec = s.durationSec % 60;
    parts.push(`${m}:${String(sec).padStart(2, '0')}`);
  }
  if (s.distanceM !== null) parts.push(`${trimNum(s.distanceM / 1000)}km`);
  let out = parts.join(' · ');
  if (s.rpe !== null) out += ` @${trimNum(s.rpe)}`;
  return out;
}

export function exerciseName(
  ex: { nameEn: string; nameJa: string | null },
  locale: Locale,
): string {
  return locale === 'ja' ? (ex.nameJa ?? ex.nameEn) : ex.nameEn;
}

export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(iso));
}
```

(`trimNum` relies on JS number stringification — `String(80)` is `'80'`, `String(82.5)` is `'82.5'`; no toFixed games.)

- [ ] **Step 3: Implement `app/src/lib/train.ts`** — the entire hooks layer:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateExercise, SetInput, TemplateInput } from '@bodyatlas/shared';
import { api } from './api';

// ---------- helpers ----------

async function expectOk<T>(res: Response & { json(): Promise<T> }): Promise<T> {
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

// ---------- exercises ----------

export function useExercises(q: string, includeArchived = false) {
  return useQuery({
    queryKey: ['exercises', q, includeArchived],
    queryFn: () =>
      expectOk(
        api.exercises.$get({
          query: { q: q || undefined, includeArchived: includeArchived ? 'true' : undefined },
        }),
      ),
    staleTime: 60_000,
  });
}

export type Exercise = NonNullable<ReturnType<typeof useExercises>['data']>[number];

export function useCreateExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExercise) => expectOk(api.exercises.$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercises'] }),
  });
}

export function useArchiveExercise() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      expectOk(api.exercises[':id'].$patch({ param: { id }, json: { isArchived: true } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['exercises'] }),
  });
}

export function useLastSets(exerciseId: string, excludeWorkoutId?: string) {
  return useQuery({
    queryKey: ['last-sets', exerciseId, excludeWorkoutId ?? null],
    queryFn: () =>
      expectOk(
        api.exercises[':id']['last-sets'].$get({
          param: { id: exerciseId },
          query: { excludeWorkoutId },
        }),
      ),
    staleTime: 5 * 60_000,
  });
}

// ---------- templates ----------

export function useTemplates() {
  return useQuery({
    queryKey: ['templates'],
    queryFn: () => expectOk(api.templates.$get()),
  });
}

export type Template = NonNullable<ReturnType<typeof useTemplates>['data']>[number];

export function useSaveTemplate(id?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TemplateInput) =>
      id
        ? expectOk(api.templates[':id'].$put({ param: { id }, json: input }))
        : expectOk(api.templates.$post({ json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expectOk(api.templates[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates'] }),
  });
}

// ---------- workouts ----------

export function useActiveWorkout() {
  return useQuery({
    queryKey: ['workouts', 'active'],
    queryFn: () => expectOk(api.workouts.active.$get()),
  });
}

export type ActiveWorkout = NonNullable<
  NonNullable<ReturnType<typeof useActiveWorkout>['data']>['workout']
>;

export function useWorkouts(filters: { limit?: number; exerciseId?: string } = {}) {
  return useQuery({
    queryKey: ['workouts', 'list', filters],
    queryFn: () =>
      expectOk(
        api.workouts.$get({
          query: {
            limit: filters.limit !== undefined ? String(filters.limit) : undefined,
            exerciseId: filters.exerciseId,
          },
        }),
      ),
  });
}

export function useWorkout(id: string) {
  return useQuery({
    queryKey: ['workouts', 'detail', id],
    queryFn: () => {
      return api.workouts[':id'].$get({ param: { id } }).then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`API error ${res.status}`);
        return res.json();
      });
    },
  });
}

/** Resolves to the workout id to navigate to — created OR already-active (409). */
export function useStartWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { templateId?: string; copyFromWorkoutId?: string }) => {
      const res = await api.workouts.$post({ json: input });
      if (res.status === 409) {
        const body = (await res.json()) as {
          error: { details: { workoutId: string } };
        };
        return { workoutId: body.error.details.workoutId, resumed: true };
      }
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const created = (await res.json()) as { id: string };
      return { workoutId: created.id, resumed: false };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useUpdateWorkout(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { notes?: string | null; finish?: boolean }) =>
      expectOk(api.workouts[':id'].$patch({ param: { id }, json: input })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useDeleteWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => expectOk(api.workouts[':id'].$delete({ param: { id } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useAddWorkoutExercise(workoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (exerciseId: string) =>
      expectOk(
        api.workouts[':id'].exercises.$post({ param: { id: workoutId }, json: { exerciseId } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useRemoveWorkoutExercise(workoutId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (weId: string) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].$delete({ param: { id: workoutId, weId } }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useLogSet(workoutId: string, weId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SetInput) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].sets.$post({
          param: { id: workoutId, weId },
          json: input,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useUpdateSet(workoutId: string, weId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ setId, input }: { setId: string; input: SetInput }) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].sets[':setId'].$patch({
          param: { id: workoutId, weId, setId },
          json: input,
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}

export function useDeleteSet(workoutId: string, weId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (setId: string) =>
      expectOk(
        api.workouts[':id'].exercises[':weId'].sets[':setId'].$delete({
          param: { id: workoutId, weId, setId },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workouts'] }),
  });
}
```

NOTE: if any `$get/$post` query/param shape disagrees with the generated RPC types (e.g., `query` values must be strings), follow the type errors — the worker types are the contract. Report deviations.

- [ ] **Step 4: Run** — `npm test -w app && npm run typecheck -w app` → format tests pass, hooks compile.

- [ ] **Step 5: Commit**

```bash
git add app/src/lib
git commit -m "feat: add workout formatting helpers and typed data hooks"
```

---

### Task 3: mockApi test helper + TrainPage + routes

**Files:**
- Create: `app/src/test/mockApi.ts`, `app/src/pages/SessionPage.tsx` (stub), `app/src/pages/WorkoutDetailPage.tsx` (stub), `app/src/pages/ExercisesPage.tsx` (stub), `app/src/pages/ExerciseHistoryPage.tsx` (stub), `app/src/pages/TemplateEditorPage.tsx` (stub)
- Modify: `app/src/pages/TrainPage.tsx` (replace placeholder), `app/src/App.tsx` (nested routes)
- Test: `app/src/pages/TrainPage.test.tsx`

- [ ] **Step 1: Create `app/src/test/mockApi.ts`**

```ts
import { vi } from 'vitest';

type RouteMap = Record<string, unknown | ((init?: RequestInit) => unknown)>;

/**
 * Stubs global fetch. Keys are `"METHOD /path"` (query strings ignored on match).
 * Values are response bodies (200) or functions receiving the RequestInit.
 * Returns the spy so tests can assert calls.
 */
export function mockApi(routes: RouteMap) {
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    const method = init?.method ?? 'GET';
    const key = `${method} ${url.pathname}`;
    if (!(key in routes)) {
      throw new Error(`mockApi: unmocked ${key}`);
    }
    const value = routes[key];
    const body = typeof value === 'function' ? (value as (i?: RequestInit) => unknown)(init) : value;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), {
      status: method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

export const emptyActive = { workout: null };
```

- [ ] **Step 2: Write the failing test** — `app/src/pages/TrainPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { TrainPage } from './TrainPage';

function renderTrain() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter>
          <TrainPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('TrainPage', () => {
  it('shows start options and templates when no workout is active', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
      'GET /api/templates': [
        { id: 't1', name: 'Push Day A', templateExercises: [] },
      ],
      'GET /api/workouts': [],
    });
    renderTrain();
    expect(await screen.findByText('Push Day A')).toBeInTheDocument();
    expect(screen.getByText('Empty workout')).toBeInTheDocument();
    expect(screen.getByText('No workouts yet — start your first one!')).toBeInTheDocument();
  });

  it('shows a resume card when a workout is active', async () => {
    mockApi({
      'GET /api/workouts/active': {
        workout: { id: 'w1', startedAt: '2026-06-12T10:00:00Z', endedAt: null, workoutExercises: [] },
      },
      'GET /api/templates': [],
      'GET /api/workouts': [],
    });
    renderTrain();
    expect(await screen.findByText('Resume workout')).toBeInTheDocument();
  });

  it('lists recent workouts with set counts', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
      'GET /api/templates': [],
      'GET /api/workouts': [
        {
          id: 'w1',
          startedAt: '2026-06-01T10:00:00Z',
          endedAt: '2026-06-01T11:00:00Z',
          exerciseNames: ['Back Squat'],
          exerciseNamesJa: ['バックスクワット'],
          setCount: 5,
        },
      ],
    });
    renderTrain();
    expect(await screen.findByText(/Back Squat/)).toBeInTheDocument();
    expect(screen.getByText(/5 sets/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run, observe failure.** Then implement — replace `app/src/pages/TrainPage.tsx`:

```tsx
import { Link, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { formatDay } from '../lib/format';
import { useActiveWorkout, useStartWorkout, useTemplates, useWorkouts } from '../lib/train';

export function TrainPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data: activeData } = useActiveWorkout();
  const { data: templates } = useTemplates();
  const { data: recent } = useWorkouts({ limit: 10 });
  const start = useStartWorkout();

  const active = activeData?.workout ?? null;
  const lastWorkoutId = recent?.[0]?.id;

  const begin = (input: { templateId?: string; copyFromWorkoutId?: string }) =>
    start.mutate(input, { onSuccess: () => navigate('/train/session') });

  return (
    <section className="stack">
      <h1>{t('nav.train')}</h1>

      {active && (
        <Link
          to="/train/session"
          className="card tappable"
          style={{ borderColor: 'var(--accent)', textDecoration: 'none', color: 'var(--text)' }}
        >
          <strong style={{ color: 'var(--accent)' }}>{t('train.resume')}</strong>
          <div className="muted">
            {t('train.inProgress')} · {t('train.startedAt')}{' '}
            {new Date(active.startedAt).toLocaleTimeString()}
          </div>
        </Link>
      )}

      {!active && (
        <>
          <div className="section-title">{t('train.start')}</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => begin({})} disabled={start.isPending}>
              {t('train.empty')}
            </button>
            {lastWorkoutId && (
              <button
                className="btn"
                onClick={() => begin({ copyFromWorkoutId: lastWorkoutId })}
                disabled={start.isPending}
              >
                {t('train.repeatLast')}
              </button>
            )}
          </div>
          {start.isError && <p className="error-text">{t('error.generic')}</p>}

          <div className="section-title">{t('train.fromTemplate')}</div>
          <div className="stack">
            {templates?.map((tpl) => (
              <div key={tpl.id} className="card row" style={{ justifyContent: 'space-between' }}>
                <button
                  className="btn"
                  style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none' }}
                  onClick={() => begin({ templateId: tpl.id })}
                  disabled={start.isPending}
                >
                  <strong>{tpl.name}</strong>
                  <span className="muted"> · {tpl.templateExercises.length}</span>
                </button>
                <Link className="muted" to={`/train/templates/${tpl.id}`}>
                  {t('common.edit')}
                </Link>
              </div>
            ))}
            <Link className="btn" style={{ textAlign: 'center', textDecoration: 'none' }} to="/train/templates/new">
              + {t('train.newTemplate')}
            </Link>
          </div>
        </>
      )}

      <div className="section-title">{t('train.recent')}</div>
      <div className="stack">
        {recent?.length === 0 && <p className="muted">{t('train.noWorkouts')}</p>}
        {recent?.map((w) => (
          <Link
            key={w.id}
            to={`/train/workouts/${w.id}`}
            className="card tappable"
            style={{ textDecoration: 'none', color: 'var(--text)' }}
          >
            <strong>{formatDay(String(w.startedAt), locale)}</strong>
            <div className="muted">
              {(locale === 'ja' ? w.exerciseNamesJa : w.exerciseNames).join(' · ')} — {w.setCount}{' '}
              {t('train.sets')}
            </div>
          </Link>
        ))}
      </div>

      <Link className="muted" to="/train/exercises">
        {t('train.browseExercises')} →
      </Link>
    </section>
  );
}
```

- [ ] **Step 4: Create the five stub pages** (each replaced in later tasks). Pattern — `app/src/pages/SessionPage.tsx`:

```tsx
export function SessionPage() {
  return null;
}
```

Same one-liner pattern for `WorkoutDetailPage`, `ExercisesPage`, `ExerciseHistoryPage`, `TemplateEditorPage` (named exports matching the filenames).

- [ ] **Step 5: Register routes in `app/src/App.tsx`** — replace the single `train` route with a nested block:

```tsx
import { ExerciseHistoryPage } from './pages/ExerciseHistoryPage';
import { ExercisesPage } from './pages/ExercisesPage';
import { SessionPage } from './pages/SessionPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { WorkoutDetailPage } from './pages/WorkoutDetailPage';
```

```tsx
<Route path="train">
  <Route index element={<TrainPage />} />
  <Route path="session" element={<SessionPage />} />
  <Route path="workouts/:id" element={<WorkoutDetailPage />} />
  <Route path="exercises" element={<ExercisesPage />} />
  <Route path="exercises/:id" element={<ExerciseHistoryPage />} />
  <Route path="templates/new" element={<TemplateEditorPage />} />
  <Route path="templates/:id" element={<TemplateEditorPage />} />
</Route>
```

- [ ] **Step 6: Run** — `npm test -w app && npm run typecheck -w app` → all pass (8 app tests).

- [ ] **Step 7: Commit**

```bash
git add app/src
git commit -m "feat: add Train tab home with start options, resume, and history list"
```

---

### Task 4: ExercisePicker + ExercisesPage

**Files:**
- Create: `app/src/components/ExercisePicker.tsx`
- Modify: `app/src/pages/ExercisesPage.tsx` (replace stub)
- Test: `app/src/components/ExercisePicker.test.tsx`

- [ ] **Step 1: Write the failing test** — `app/src/components/ExercisePicker.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { ExercisePicker } from './ExercisePicker';

const exercises = [
  { id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength', muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null },
  { id: 'e2', nameEn: 'Back Squat', nameJa: 'バックスクワット', type: 'strength', muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: null },
];

function renderPicker(onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ExercisePicker onSelect={onSelect} onClose={vi.fn()} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return onSelect;
}

afterEach(() => vi.unstubAllGlobals());

describe('ExercisePicker', () => {
  it('lists exercises and fires onSelect with the chosen one', async () => {
    mockApi({ 'GET /api/exercises': exercises });
    const onSelect = renderPicker();
    await userEvent.click(await screen.findByText('Bench Press'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('creates a custom exercise through the inline form', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': {
        id: 'new1', nameEn: 'Zercher Squat', nameJa: null, type: 'strength',
        muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: 'u1',
      },
    });
    const onSelect = renderPicker();
    await userEvent.click(await screen.findByText('Create exercise'));
    await userEvent.type(screen.getByLabelText('Exercise name'), 'Zercher Squat');
    await userEvent.selectOptions(screen.getByLabelText('Muscle group'), 'legs');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' })));
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ name: 'Zercher Squat', muscleGroup: 'legs' });
  });
});
```

- [ ] **Step 2: Run, observe failure.** Implement `app/src/components/ExercisePicker.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { EQUIPMENT, EXERCISE_TYPES, MUSCLE_GROUPS, type CreateExercise } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../i18n';
import { exerciseName } from '../lib/format';
import { useCreateExercise, useExercises, type Exercise } from '../lib/train';

export function ExercisePicker({
  onSelect,
  onClose,
}: {
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: exercises, isPending } = useExercises(q);
  const create = useCreateExercise();

  const [form, setForm] = useState<CreateExercise>({
    name: '',
    type: 'strength',
    muscleGroup: 'chest',
    equipment: 'barbell',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submitCreate = () => {
    create.mutate(form, {
      onSuccess: (created) => onSelect(created as Exercise),
    });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel stack"
        role="dialog"
        aria-modal="true"
        aria-label={t('train.addExercise')}
        onClick={(e) => e.stopPropagation()}
      >
        {!creating ? (
          <>
            <input
              className="input"
              autoFocus
              placeholder={t('exercise.search')}
              aria-label={t('exercise.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="stack" style={{ gap: 4 }}>
              {!isPending && exercises?.length === 0 && (
                <p className="muted">{t('exercise.noResults')}</p>
              )}
              {exercises?.map((ex) => (
                <button
                  key={ex.id}
                  className="card tappable row"
                  style={{ justifyContent: 'space-between', textAlign: 'left' }}
                  onClick={() => onSelect(ex)}
                >
                  <span>
                    {exerciseName(ex, locale)}
                    {ex.userId !== null && <span className="muted"> · {t('exercise.custom')}</span>}
                  </span>
                  <span className="muted">{t(`muscle.${ex.muscleGroup}` as MessageKey)}</span>
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => setCreating(true)}>
              + {t('exercise.create')}
            </button>
          </>
        ) : (
          <>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.name')}
              <input
                className="input"
                aria-label={t('exercise.name')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.type')}
              <select
                className="input"
                aria-label={t('exercise.type')}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as CreateExercise['type'] })}
              >
                {EXERCISE_TYPES.map((v) => (
                  <option key={v} value={v}>{t(`type.${v}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.muscleGroup')}
              <select
                className="input"
                aria-label={t('exercise.muscleGroup')}
                value={form.muscleGroup}
                onChange={(e) =>
                  setForm({ ...form, muscleGroup: e.target.value as CreateExercise['muscleGroup'] })
                }
              >
                {MUSCLE_GROUPS.map((v) => (
                  <option key={v} value={v}>{t(`muscle.${v}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.equipment')}
              <select
                className="input"
                aria-label={t('exercise.equipment')}
                value={form.equipment}
                onChange={(e) =>
                  setForm({ ...form, equipment: e.target.value as CreateExercise['equipment'] })
                }
              >
                {EQUIPMENT.map((v) => (
                  <option key={v} value={v}>{t(`equip.${v}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            {create.isError && <p className="error-text">{t('error.generic')}</p>}
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={submitCreate}
                disabled={create.isPending || form.name.trim() === ''}
              >
                {t('common.save')}
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement `app/src/pages/ExercisesPage.tsx`** (replace stub) — catalog browser reusing the same hooks:

```tsx
import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n, type MessageKey } from '../i18n';
import { exerciseName } from '../lib/format';
import { useArchiveExercise, useExercises } from '../lib/train';

export function ExercisesPage() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const { data: exercises } = useExercises(q);
  const archive = useArchiveExercise();

  return (
    <section className="stack">
      <h1>{t('train.browseExercises')}</h1>
      <input
        className="input"
        placeholder={t('exercise.search')}
        aria-label={t('exercise.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="stack" style={{ gap: 4 }}>
        {exercises?.map((ex) => (
          <div key={ex.id} className="card row" style={{ justifyContent: 'space-between' }}>
            <Link to={`/train/exercises/${ex.id}`} style={{ color: 'var(--text)', textDecoration: 'none', flex: 1 }}>
              <strong>{exerciseName(ex, locale)}</strong>
              <div className="muted">
                {t(`muscle.${ex.muscleGroup}` as MessageKey)} · {t(`equip.${ex.equipment}` as MessageKey)}
                {ex.userId !== null && <> · {t('exercise.custom')}</>}
              </div>
            </Link>
            {ex.userId !== null && (
              <button className="btn" onClick={() => archive.mutate(ex.id)} disabled={archive.isPending}>
                {t('exercise.archive')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run** — `npm test -w app && npm run typecheck -w app` → all pass (10 app tests).

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "feat: add exercise picker with inline custom creation and catalog page"
```

---

### Task 5: SetInputRow + SessionPage (the core logging screen)

**Files:**
- Create: `app/src/components/SetInputRow.tsx`
- Modify: `app/src/pages/SessionPage.tsx` (replace stub)
- Test: `app/src/components/SetInputRow.test.tsx`, `app/src/pages/SessionPage.test.tsx`

- [ ] **Step 1: Write the failing tests.** `app/src/components/SetInputRow.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { SetInputRow } from './SetInputRow';

function renderRow(type: 'strength' | 'bodyweight' | 'cardio', onSubmit = vi.fn()) {
  render(
    <I18nProvider locale="en">
      <SetInputRow exerciseType={type} onSubmit={onSubmit} submitLabel="Log set" />
    </I18nProvider>,
  );
  return onSubmit;
}

describe('SetInputRow', () => {
  it('submits a strength set with numbers parsed', async () => {
    const onSubmit = renderRow('strength');
    await userEvent.type(screen.getByLabelText('kg'), '82.5');
    await userEvent.type(screen.getByLabelText('reps'), '8');
    await userEvent.type(screen.getByLabelText('RPE'), '8.5');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ weightKg: 82.5, reps: 8, rpe: 8.5 });
  });

  it('submits cardio minutes converted to seconds and km to meters', async () => {
    const onSubmit = renderRow('cardio');
    await userEvent.type(screen.getByLabelText('min'), '25');
    await userEvent.type(screen.getByLabelText('km'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    expect(onSubmit).toHaveBeenCalledWith({ durationSec: 1500, distanceM: 5000 });
  });

  it('disables submit when nothing countable is entered', async () => {
    renderRow('strength');
    expect(screen.getByRole('button', { name: 'Log set' })).toBeDisabled();
  });
});
```

`app/src/pages/SessionPage.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { SessionPage } from './SessionPage';

const activeWorkout = {
  id: 'w1',
  startedAt: '2026-06-12T10:00:00Z',
  endedAt: null,
  notes: null,
  templateId: null,
  workoutExercises: [
    {
      id: 'we1',
      position: 1,
      notes: null,
      exercise: {
        id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength',
        muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null,
      },
      sets: [
        { id: 's1', position: 1, weightKg: 80, reps: 8, rpe: null, durationSec: null, distanceM: null },
      ],
    },
  ],
};

function renderSession() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/train/session']}>
          <Routes>
            <Route path="/train/session" element={<SessionPage />} />
            <Route path="/train" element={<div>TRAIN HOME</div>} />
            <Route path="/train/workouts/:id" element={<div>DETAIL</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('SessionPage', () => {
  it('renders the active workout with ghosts and logged sets', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: activeWorkout },
      'GET /api/exercises/e1/last-sets': {
        workoutId: 'w0',
        startedAt: '2026-06-05T10:00:00Z',
        sets: [{ id: 'p1', position: 1, weightKg: 77.5, reps: 8, rpe: null, durationSec: null, distanceM: null }],
      },
    });
    renderSession();
    expect(await screen.findByText('Bench Press')).toBeInTheDocument();
    expect(await screen.findByText(/77.5kg × 8/)).toBeInTheDocument(); // ghost
    expect(screen.getByText(/80kg × 8/)).toBeInTheDocument(); // logged set
  });

  it('logs a set with the typed values', async () => {
    const spy = mockApi({
      'GET /api/workouts/active': { workout: activeWorkout },
      'GET /api/exercises/e1/last-sets': null,
      'POST /api/workouts/w1/exercises/we1/sets': {
        id: 's2', position: 2, weightKg: 82.5, reps: 6, rpe: null, durationSec: null, distanceM: null,
      },
    });
    renderSession();
    await screen.findByText('Bench Press');
    await userEvent.type(screen.getByLabelText('kg'), '82.5');
    await userEvent.type(screen.getByLabelText('reps'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ weightKg: 82.5, reps: 6 });
    });
  });

  it('redirects to /train when nothing is active', async () => {
    mockApi({ 'GET /api/workouts/active': { workout: null } });
    renderSession();
    expect(await screen.findByText('TRAIN HOME')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, observe failures.** Implement `app/src/components/SetInputRow.tsx`:

```tsx
import { useState } from 'react';
import type { ExerciseType, SetInput } from '@bodyatlas/shared';
import { useI18n } from '../i18n';

/** Parses a decimal string; '' → undefined; invalid → undefined. */
function num(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function SetInputRow({
  exerciseType,
  onSubmit,
  submitLabel,
  initial,
  busy = false,
}: {
  exerciseType: ExerciseType;
  onSubmit: (input: SetInput) => void;
  submitLabel: string;
  initial?: { weightKg?: string; reps?: string; rpe?: string; durationMin?: string; distanceKm?: string };
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [weight, setWeight] = useState(initial?.weightKg ?? '');
  const [reps, setReps] = useState(initial?.reps ?? '');
  const [rpe, setRpe] = useState(initial?.rpe ?? '');
  const [durationMin, setDurationMin] = useState(initial?.durationMin ?? '');
  const [distanceKm, setDistanceKm] = useState(initial?.distanceKm ?? '');

  const isCardio = exerciseType === 'cardio';

  const build = (): SetInput => ({
    ...(num(weight) !== undefined ? { weightKg: num(weight) } : {}),
    ...(num(reps) !== undefined ? { reps: num(reps) } : {}),
    ...(num(rpe) !== undefined ? { rpe: num(rpe) } : {}),
    ...(num(durationMin) !== undefined ? { durationSec: Math.round(num(durationMin)! * 60) } : {}),
    ...(num(distanceKm) !== undefined ? { distanceM: num(distanceKm)! * 1000 } : {}),
  });

  const valid =
    num(reps) !== undefined || num(durationMin) !== undefined || num(distanceKm) !== undefined;

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <label className="stack" style={{ gap: 2, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
      <input
        className="input input-num"
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      {label}
    </label>
  );

  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {!isCardio && field(t('field.weight'), weight, setWeight)}
      {!isCardio && field(t('field.reps'), reps, setReps)}
      {!isCardio && field(t('field.rpe'), rpe, setRpe)}
      {isCardio && field(t('field.duration'), durationMin, setDurationMin)}
      {isCardio && field(t('field.distance'), distanceKm, setDistanceKm)}
      <button
        className="btn btn-primary"
        style={{ marginLeft: 'auto' }}
        disabled={!valid || busy}
        onClick={() => onSubmit(build())}
      >
        {submitLabel}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Implement `app/src/pages/SessionPage.tsx`** (replace stub):

```tsx
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { ExercisePicker } from '../components/ExercisePicker';
import { SetInputRow } from '../components/SetInputRow';
import { exerciseName, formatDay, formatSet } from '../lib/format';
import {
  useActiveWorkout,
  useAddWorkoutExercise,
  useDeleteSet,
  useLastSets,
  useLogSet,
  useRemoveWorkoutExercise,
  useUpdateWorkout,
  type ActiveWorkout,
} from '../lib/train';

function ExerciseBlock({
  workoutId,
  we,
}: {
  workoutId: string;
  we: ActiveWorkout['workoutExercises'][number];
}) {
  const { t, locale } = useI18n();
  const { data: last } = useLastSets(we.exercise.id, workoutId);
  const logSet = useLogSet(workoutId, we.id);
  const deleteSet = useDeleteSet(workoutId, we.id);
  const removeExercise = useRemoveWorkoutExercise(workoutId);

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{exerciseName(we.exercise, locale)}</strong>
        {we.sets.length === 0 && (
          <button className="btn" onClick={() => removeExercise.mutate(we.id)} aria-label={`remove-${we.id}`}>
            ✕
          </button>
        )}
      </div>

      <div className="muted">
        {last === null && t('train.noPrevious')}
        {last && (
          <>
            {t('train.lastTime')} ({formatDay(String(last.startedAt), locale)}):{' '}
            {last.sets.map((s) => formatSet(s)).join(', ')}
          </>
        )}
      </div>

      {we.sets.map((s) => (
        <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            <span className="muted">{s.position}.</span> {formatSet(s)}
          </span>
          <button className="btn" onClick={() => deleteSet.mutate(s.id)} aria-label={`delete-set-${s.position}`}>
            ✕
          </button>
        </div>
      ))}

      <SetInputRow
        exerciseType={we.exercise.type}
        submitLabel={t('train.logSet')}
        busy={logSet.isPending}
        onSubmit={(input) => logSet.mutate(input)}
      />
      {(logSet.isError || deleteSet.isError) && <p className="error-text">{t('error.generic')}</p>}
    </div>
  );
}

export function SessionPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data, isPending } = useActiveWorkout();
  const [pickerOpen, setPickerOpen] = useState(false);
  const workout = data?.workout ?? null;
  const addExercise = useAddWorkoutExercise(workout?.id ?? '');
  const update = useUpdateWorkout(workout?.id ?? '');

  if (isPending) return <p className="muted">…</p>;
  if (!workout) return <Navigate to="/train" replace />;

  const finish = () =>
    update.mutate(
      { finish: true },
      { onSuccess: () => navigate(`/train/workouts/${workout.id}`) },
    );

  return (
    <section className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('train.inProgress')}</h1>
        <button className="btn btn-primary" onClick={finish} disabled={update.isPending}>
          {t('train.finish')}
        </button>
      </div>
      <p className="muted">
        {t('train.startedAt')} {new Date(workout.startedAt).toLocaleTimeString()}
      </p>

      {workout.workoutExercises.map((we) => (
        <ExerciseBlock key={we.id} workoutId={workout.id} we={we} />
      ))}

      <button className="btn" onClick={() => setPickerOpen(true)}>
        + {t('train.addExercise')}
      </button>
      {addExercise.isError && <p className="error-text">{t('error.generic')}</p>}

      {pickerOpen && (
        <ExercisePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(ex) => {
            addExercise.mutate(ex.id);
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run** — `npm test -w app && npm run typecheck -w app` → all pass (16 app tests).

- [ ] **Step 5: Manual check** — `npm run dev`, sign in, Train → Empty workout → add Bench Press → log sets → finish. Verify ghosts appear on the second session of the same exercise.

- [ ] **Step 6: Commit**

```bash
git add app/src
git commit -m "feat: add active session screen with set logging and previous-performance ghosts"
```

---

### Task 6: WorkoutDetailPage + ExerciseHistoryPage

**Files:**
- Modify: `app/src/pages/WorkoutDetailPage.tsx`, `app/src/pages/ExerciseHistoryPage.tsx` (replace stubs)
- Test: `app/src/pages/WorkoutDetailPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `app/src/pages/WorkoutDetailPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { WorkoutDetailPage } from './WorkoutDetailPage';

const finished = {
  id: 'w1',
  startedAt: '2026-06-01T10:00:00Z',
  endedAt: '2026-06-01T11:00:00Z',
  notes: 'good day',
  templateId: null,
  workoutExercises: [
    {
      id: 'we1',
      position: 1,
      notes: null,
      exercise: {
        id: 'e1', nameEn: 'Deadlift', nameJa: 'デッドリフト', type: 'strength',
        muscleGroup: 'back', equipment: 'barbell', isArchived: false, userId: null,
      },
      sets: [
        { id: 's1', position: 1, weightKg: 120, reps: 5, rpe: 8, durationSec: null, distanceM: null },
      ],
    },
  ],
};

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/train/workouts/w1']}>
          <Routes>
            <Route path="/train/workouts/:id" element={<WorkoutDetailPage />} />
            <Route path="/train" element={<div>TRAIN HOME</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('WorkoutDetailPage', () => {
  it('renders exercises, sets, and notes', async () => {
    mockApi({ 'GET /api/workouts/w1': finished });
    renderDetail();
    expect(await screen.findByText('Deadlift')).toBeInTheDocument();
    expect(screen.getByText(/120kg × 5 @8/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('good day')).toBeInTheDocument();
  });

  it('edits a set via PATCH with full values', async () => {
    const spy = mockApi({
      'GET /api/workouts/w1': finished,
      'PATCH /api/workouts/w1/exercises/we1/sets/s1': {
        ...finished.workoutExercises[0]!.sets[0]!, weightKg: 122.5,
      },
    });
    renderDetail();
    await userEvent.click(await screen.findByLabelText('edit-set-1'));
    const weightInput = screen.getByLabelText('kg');
    await userEvent.clear(weightInput);
    await userEvent.type(weightInput, '122.5');
    await userEvent.click(screen.getByRole('button', { name: 'Update set' }));
    await waitFor(() => {
      const patch = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ weightKg: 122.5, reps: 5, rpe: 8 });
    });
  });

  it('deletes the workout after confirm and navigates home', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockApi({
      'GET /api/workouts/w1': finished,
      'DELETE /api/workouts/w1': { ok: true },
    });
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete workout' }));
    expect(await screen.findByText('TRAIN HOME')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, observe failure.** Implement `app/src/pages/WorkoutDetailPage.tsx`:

```tsx
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { SetInputRow } from '../components/SetInputRow';
import { exerciseName, formatDay, formatSet, trimNum } from '../lib/format';
import {
  useDeleteSet,
  useDeleteWorkout,
  useUpdateSet,
  useUpdateWorkout,
  useWorkout,
} from '../lib/train';

type Detail = NonNullable<NonNullable<ReturnType<typeof useWorkout>['data']>>;

function DetailExercise({ workoutId, we }: { workoutId: string; we: Detail['workoutExercises'][number] }) {
  const { t, locale } = useI18n();
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const updateSet = useUpdateSet(workoutId, we.id);
  const deleteSet = useDeleteSet(workoutId, we.id);

  return (
    <div className="card stack">
      <strong>{exerciseName(we.exercise, locale)}</strong>
      {we.sets.map((s) =>
        editingSetId === s.id ? (
          <SetInputRow
            key={s.id}
            exerciseType={we.exercise.type}
            submitLabel={t('train.updateSet')}
            busy={updateSet.isPending}
            initial={{
              weightKg: s.weightKg !== null ? trimNum(s.weightKg) : '',
              reps: s.reps !== null ? String(s.reps) : '',
              rpe: s.rpe !== null ? trimNum(s.rpe) : '',
              durationMin: s.durationSec !== null ? trimNum(s.durationSec / 60) : '',
              distanceKm: s.distanceM !== null ? trimNum(s.distanceM / 1000) : '',
            }}
            onSubmit={(input) =>
              updateSet.mutate({ setId: s.id, input }, { onSuccess: () => setEditingSetId(null) })
            }
          />
        ) : (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              <span className="muted">{s.position}.</span> {formatSet(s)}
            </span>
            <span className="row">
              <button className="btn" aria-label={`edit-set-${s.position}`} onClick={() => setEditingSetId(s.id)}>
                {t('common.edit')}
              </button>
              <button className="btn" aria-label={`delete-set-${s.position}`} onClick={() => deleteSet.mutate(s.id)}>
                ✕
              </button>
            </span>
          </div>
        ),
      )}
      {(updateSet.isError || deleteSet.isError) && <p className="error-text">{t('error.generic')}</p>}
    </div>
  );
}

export function WorkoutDetailPage() {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: workout, isPending } = useWorkout(id);
  const update = useUpdateWorkout(id);
  const del = useDeleteWorkout();
  const [notes, setNotes] = useState<string | null>(null);

  if (isPending) return <p className="muted">…</p>;
  if (!workout) return <p className="muted">{t('error.generic')}</p>;

  const saveNotes = () => {
    if (notes !== null && notes !== (workout.notes ?? '')) {
      update.mutate({ notes: notes === '' ? null : notes });
    }
  };

  return (
    <section className="stack">
      <h1>{formatDay(String(workout.startedAt), locale)}</h1>
      <p className="muted">
        {new Date(workout.startedAt).toLocaleTimeString()} –{' '}
        {workout.endedAt ? new Date(workout.endedAt).toLocaleTimeString() : t('train.inProgress')}
      </p>

      {workout.workoutExercises.map((we) => (
        <DetailExercise key={we.id} workoutId={workout.id} we={we} />
      ))}

      <label className="stack" style={{ gap: 4 }}>
        {t('train.notes')}
        <textarea
          className="input"
          rows={3}
          aria-label={t('train.notes')}
          value={notes ?? workout.notes ?? ''}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
        />
      </label>

      <button
        className="btn btn-danger"
        onClick={() => {
          if (window.confirm(t('common.confirmDelete'))) {
            del.mutate(workout.id, { onSuccess: () => navigate('/train') });
          }
        }}
      >
        {t('train.deleteWorkout')}
      </button>
    </section>
  );
}
```

- [ ] **Step 3: Implement `app/src/pages/ExerciseHistoryPage.tsx`** (replace stub):

```tsx
import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { formatDay } from '../lib/format';
import { useWorkouts } from '../lib/train';

export function ExerciseHistoryPage() {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const { data: workouts } = useWorkouts({ exerciseId: id, limit: 50 });

  return (
    <section className="stack">
      <h1>{t('train.history')}</h1>
      {workouts?.length === 0 && <p className="muted">{t('train.noWorkouts')}</p>}
      {workouts?.map((w) => (
        <Link
          key={w.id}
          to={`/train/workouts/${w.id}`}
          className="card tappable"
          style={{ textDecoration: 'none', color: 'var(--text)' }}
        >
          <strong>{formatDay(String(w.startedAt), locale)}</strong>
          <div className="muted">
            {(locale === 'ja' ? w.exerciseNamesJa : w.exerciseNames).join(' · ')} — {w.setCount}{' '}
            {t('train.sets')}
          </div>
        </Link>
      ))}
    </section>
  );
}
```

- [ ] **Step 4: Run** — `npm test -w app && npm run typecheck -w app` → all pass (19 app tests).

- [ ] **Step 5: Commit**

```bash
git add app/src
git commit -m "feat: add workout detail editing and per-exercise history"
```

---

### Task 7: TemplateEditorPage

**Files:**
- Modify: `app/src/pages/TemplateEditorPage.tsx` (replace stub)
- Test: `app/src/pages/TemplateEditorPage.test.tsx`

- [ ] **Step 1: Write the failing test** — `app/src/pages/TemplateEditorPage.test.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { TemplateEditorPage } from './TemplateEditorPage';

const exercises = [
  { id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength', muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null },
];

function renderEditor(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/train/templates/new" element={<TemplateEditorPage />} />
            <Route path="/train/templates/:id" element={<TemplateEditorPage />} />
            <Route path="/train" element={<div>TRAIN HOME</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('TemplateEditorPage', () => {
  it('creates a template with picked exercises', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'POST /api/templates': { id: 't-new', name: 'Push A', templateExercises: [] },
    });
    renderEditor('/train/templates/new');
    await userEvent.type(screen.getByLabelText('Template name'), 'Push A');
    await userEvent.click(screen.getByRole('button', { name: /Add exercise/ }));
    await userEvent.click(await screen.findByText('Bench Press'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => init?.method === 'POST' && String(init?.body ?? '').includes('Push A'));
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        name: 'Push A',
        exercises: [{ exerciseId: 'e1' }],
      });
    });
    expect(await screen.findByText('TRAIN HOME')).toBeInTheDocument();
  });

  it('loads an existing template for editing and PUTs the replacement', async () => {
    const spy = mockApi({
      'GET /api/templates': [
        {
          id: 't1',
          name: 'Pull Day',
          templateExercises: [
            { id: 'te1', position: 1, targetSets: 3, exercise: exercises[0] },
          ],
        },
      ],
      'PUT /api/templates/t1': { id: 't1', name: 'Pull Day B', templateExercises: [] },
    });
    renderEditor('/train/templates/t1');
    const name = await screen.findByLabelText('Template name');
    expect(name).toHaveValue('Pull Day');
    await userEvent.clear(name);
    await userEvent.type(name, 'Pull Day B');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = spy.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1]!.body))).toEqual({
        name: 'Pull Day B',
        exercises: [{ exerciseId: 'e1', targetSets: 3 }],
      });
    });
  });
});
```

- [ ] **Step 2: Run, observe failure.** Implement `app/src/pages/TemplateEditorPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { ExercisePicker } from '../components/ExercisePicker';
import { exerciseName } from '../lib/format';
import { useDeleteTemplate, useSaveTemplate, useTemplates, type Exercise } from '../lib/train';

type Row = { exercise: Pick<Exercise, 'id' | 'nameEn' | 'nameJa'>; targetSets?: number };

export function TemplateEditorPage() {
  const { t, locale } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: templates } = useTemplates();
  const save = useSaveTemplate(id);
  const del = useDeleteTemplate();

  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const existing = id ? templates?.find((tpl) => tpl.id === id) : undefined;

  useEffect(() => {
    if (existing && !loaded) {
      setName(existing.name);
      setRows(
        existing.templateExercises.map((te) => ({
          exercise: te.exercise,
          targetSets: te.targetSets ?? undefined,
        })),
      );
      setLoaded(true);
    }
  }, [existing, loaded]);

  const move = (index: number, delta: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      const a = next[index]!;
      next[index] = next[j]!;
      next[j] = a;
      return next;
    });
  };

  const submit = () =>
    save.mutate(
      {
        name,
        exercises: rows.map((r) => ({
          exerciseId: r.exercise.id,
          ...(r.targetSets !== undefined ? { targetSets: r.targetSets } : {}),
        })),
      },
      { onSuccess: () => navigate('/train') },
    );

  return (
    <section className="stack">
      <h1>{id ? t('train.editTemplate') : t('train.newTemplate')}</h1>

      <label className="stack" style={{ gap: 4 }}>
        {t('train.templateName')}
        <input
          className="input"
          aria-label={t('train.templateName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="stack" style={{ gap: 4 }}>
        {rows.map((row, i) => (
          <div key={`${row.exercise.id}-${i}`} className="card row" style={{ justifyContent: 'space-between' }}>
            <span>{exerciseName(row.exercise, locale)}</span>
            <span className="row">
              <input
                className="input input-num"
                inputMode="numeric"
                aria-label={t('train.targetSets')}
                placeholder={t('train.targetSets')}
                value={row.targetSets ?? ''}
                onChange={(e) =>
                  setRows((prev) =>
                    prev.map((r, j) =>
                      j === i
                        ? { ...r, targetSets: e.target.value === '' ? undefined : Number(e.target.value) }
                        : r,
                    ),
                  )
                }
              />
              <button className="btn" aria-label={`up-${i}`} onClick={() => move(i, -1)}>↑</button>
              <button className="btn" aria-label={`down-${i}`} onClick={() => move(i, 1)}>↓</button>
              <button
                className="btn"
                aria-label={`remove-${i}`}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>

      <button className="btn" onClick={() => setPickerOpen(true)}>
        + {t('train.addExercise')}
      </button>

      <div className="row">
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={save.isPending || name.trim() === '' || rows.length === 0}
        >
          {t('common.save')}
        </button>
        {id && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm(t('common.confirmDelete'))) {
                del.mutate(id, { onSuccess: () => navigate('/train') });
              }
            }}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
      {save.isError && <p className="error-text">{t('error.generic')}</p>}

      {pickerOpen && (
        <ExercisePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(ex) => {
            setRows((prev) => [...prev, { exercise: ex }]);
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}
```

- [ ] **Step 3: Run** — `npm test -w app && npm run typecheck -w app` → all pass (21 app tests).

- [ ] **Step 4: Commit**

```bash
git add app/src
git commit -m "feat: add template editor with ordering and target sets"
```

---

### Task 8: Quick-log wiring + full gate + deploy

**Files:**
- Modify: `app/src/components/QuickLogSheet.tsx`

- [ ] **Step 1: Wire "Log a set"** — in `QuickLogSheet`, enable the set action: replace the disabled `quickLog.set` button with one that starts/resumes and navigates:

```tsx
import { useNavigate } from 'react-router';
import { useStartWorkout } from '../lib/train';
```

Inside the component:

```tsx
const navigate = useNavigate();
const start = useStartWorkout();

const logSet = () => {
  start.mutate({}, {
    onSuccess: () => {
      onClose();
      navigate('/train/session');
    },
  });
};
```

Render the set action as an enabled button calling `logSet` (keep meal/weight/sleep disabled with `comingSoon` until Plan 3). `useStartWorkout` already treats 409 as "resume", so this works whether or not a session is active. NOTE: `QuickLogSheet` is rendered inside `AppLayout`, which is inside the router — `useNavigate` is available.

- [ ] **Step 2: Adjust the AuthGate test if needed** — `App.tsx` renders `QuickLogSheet` only when opened, so no fetch changes; run `npm test -w app` and fix any fallout (none expected).

- [ ] **Step 3: Full gate** — from root: `npm run typecheck && npm test && npm run build` → all green.

- [ ] **Step 4: Deploy** — `npm run deploy`.

- [ ] **Step 5: Browser smoke (user-assisted)** — at https://bodyatlas.okdtsk.dev: create a template, start a workout from it, log sets (watch ghosts on the second session), finish, edit a set from history, switch to 日本語 and confirm the catalog searches in Japanese.

- [ ] **Step 6: Update CLAUDE.md status** (Plan 2b shipped; next: Plan 3 health tracking), commit `docs: update status for workout UI`.

---

## Plan self-review (done at authoring time)

- **Spec coverage (Train tab):** start via template/repeat-last/empty ✓, active session with fast set entry + previous-session ghosts ✓, history by date (TrainPage recent + detail) and by exercise ✓, template management ✓, catalog management incl. custom + archive ✓, quick-log set action ✓. Deferred by design: trends (Plan 4), rest timers/RPE autofill (phase 2), workout_exercises.notes UI (column dormant).
- **Type consistency:** hooks derive types from RPC (`Exercise`, `Template`, `ActiveWorkout`) — components import those, never hand-write shapes. `SetInputRow` is shared by SessionPage (create) and WorkoutDetailPage (edit with `initial`).
- **Known risks flagged inline:** RPC query-param string coercion (Task 2 note), `mockApi` URL matching ignores query strings (acceptable — tests assert bodies), template editor loads from the templates list cache rather than a detail endpoint (sufficient: list embeds exercises).
