# BodyAtlas Workout API Implementation Plan (Plan 2a of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The complete workout-logging backend: exercise catalog (seeded + custom), workouts/sets/templates tables with migrations, and the full `/api/exercises`, `/api/templates`, `/api/workouts` surface — typed end-to-end through Hono RPC, fully tested, deployed.

**Architecture:** Extends the deployed foundation (single Worker, Hono, D1 + Drizzle, KV sessions). All new routes mount behind the existing `requireAuth`; every query is scoped by `user_id`. Drizzle relations power nested reads (workout → exercises → sets). Multi-row writes use D1 `batch`.

**Tech Stack:** unchanged from foundation (see `docs/superpowers/plans/2026-06-12-bodyatlas-foundation.md` for conventions — bare installs, TDD, commit per task, version caveats).

**Spec:** `docs/superpowers/specs/2026-06-12-bodyatlas-design.md` (workout domain). Plan 2b adds the Train-tab UI on top of this API.

**Established facts to honor (from foundation execution):**
- vitest-pool-workers v0.16.13: no isolated storage → `worker/test/reset-db.ts` truncates per test; no `/config` subpath; `cloudflareTest` plugin form.
- `meRoutes` pattern: sub-apps are `Hono<ProtectedEnv>`, mounted after `.use(requireAuth)` in the `apiApp` chain; chaining preserves the RPC schema (compile-time guard exists in `worker/test/me.test.ts`).
- Error envelope `{ error: { code, message, details? } }`; zValidator hook returns 422 (copy the inline hook pattern from `worker/src/routes/me.ts` — accepted duplication).
- Enum-like columns are branded with `$type<...>()` from `@bodyatlas/shared` so unions flow through RPC.

---

## Domain decisions locked in this plan

- **Active workout** = row with `ended_at IS NULL`. At most ONE active workout per user — `POST /api/workouts` returns 409 `active_workout_exists` (with the active id in `details`) if one exists. Finish via `PATCH /api/workouts/:id` with `{ "finish": true }` (server stamps `ended_at`).
- **Repeat last / templates:** `POST /api/workouts` accepts optional `templateId` (pre-fills exercises from the template) or `copyFromWorkoutId` (copies another workout's exercise list). "Ghost" numbers in the UI come from `GET /api/exercises/:id/last-sets`.
- **Exercises:** seed rows have `user_id NULL` and stable readable ids (`seed-bench-press`); custom rows carry the user's id. No DELETE — archive via PATCH. Search matches `name_en` and `name_ja`.
- **Sets:** one table for all exercise types — `weight_kg`, `reps`, `rpe`, `duration_sec`, `distance_m`, all nullable; validation requires at least one of reps/duration/distance. Positions are append-only (`max+1`), never renumbered.
- **FK behavior:** workout → workout_exercises → sets cascade on delete; template → template_exercises cascade; `workouts.template_id` is `set null` on template delete (history survives); `*.exercise_id` restrict (exercises are archived, never deleted).
- **Template update is full-replace** (`PUT`): name + ordered exercise list. Simpler than diffing.

## File structure (new/changed)

```
shared/src/workout.ts            # enums + zod schemas for the workout domain
shared/src/workout.test.ts
shared/src/index.ts              # + export * from './workout'
worker/src/db/schema.ts          # + 6 tables, relations, indexes
worker/migrations/0001_workout_tables.sql   # generated
worker/migrations/0002_seed_exercises.sql   # hand-written seed (custom migration)
worker/src/routes/exercises.ts
worker/src/routes/templates.ts
worker/src/routes/workouts.ts
worker/src/index.ts              # + three .route() mounts
worker/test/reset-db.ts          # updated truncation order, preserves seed
worker/test/helpers.ts           # + seedWorkout/seedTemplate/seedCustomExercise
worker/test/workout-db.test.ts
worker/test/exercises.test.ts
worker/test/templates.test.ts
worker/test/workouts.test.ts
```

---

### Task 1: Workout domain schema — 6 tables, relations, migration

**Files:**
- Modify: `worker/src/db/schema.ts`, `worker/test/reset-db.ts`, `worker/test/helpers.ts`
- Generated: `worker/migrations/0001_workout_tables.sql`
- Test: `worker/test/workout-db.test.ts`

- [ ] **Step 1: Add shared enums first** (needed by `$type<>`): create `shared/src/workout.ts` with ONLY the constants for now (schemas come in Task 3):

```ts
export const EXERCISE_TYPES = ['strength', 'bodyweight', 'cardio'] as const;
export const MUSCLE_GROUPS = [
  'chest',
  'back',
  'shoulders',
  'arms',
  'legs',
  'core',
  'full-body',
] as const;
export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'kettlebell',
  'bodyweight',
  'band',
  'cardio-machine',
  'other',
] as const;

export type ExerciseType = (typeof EXERCISE_TYPES)[number];
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];
export type Equipment = (typeof EQUIPMENT)[number];
```

Add `export * from './workout';` to `shared/src/index.ts`.

- [ ] **Step 2: Write the failing test** — `worker/test/workout-db.test.ts`

```ts
import { env } from 'cloudflare:test';
import { asc, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';
import { seedUser } from './helpers';

describe('workout tables', () => {
  it('round-trips a workout with exercises and sets via relations', async () => {
    await seedUser('user-1');
    const db = getDb(env.DB);
    await db.insert(schema.exercises).values({
      id: 'ex-rt',
      userId: 'user-1',
      nameEn: 'Roundtrip Press',
      type: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    });
    await db.insert(schema.workouts).values({ id: 'w1', userId: 'user-1' });
    await db.insert(schema.workoutExercises).values({
      id: 'we1',
      workoutId: 'w1',
      exerciseId: 'ex-rt',
      position: 1,
    });
    const detail = await db.query.workouts.findFirst({
      where: eq(schema.workouts.id, 'w1'),
      with: {
        workoutExercises: {
          orderBy: asc(schema.workoutExercises.position),
          with: { sets: true },
        },
      },
    });
    expect(detail?.workoutExercises).toHaveLength(1);
    expect(detail?.endedAt).toBeNull();
  });

  it('cascades deletes from workout to sets', async () => {
    await seedUser('user-1');
    const db = getDb(env.DB);
    await db.insert(schema.exercises).values({
      id: 'ex1',
      userId: 'user-1',
      nameEn: 'Test Press',
      type: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    });
    await db.insert(schema.workouts).values({ id: 'w1', userId: 'user-1' });
    await db.insert(schema.workoutExercises).values({
      id: 'we1',
      workoutId: 'w1',
      exerciseId: 'ex1',
      position: 1,
    });
    await db.insert(schema.sets).values({ id: 's1', workoutExerciseId: 'we1', position: 1, weightKg: 80, reps: 8 });

    await db.delete(schema.workouts).where(eq(schema.workouts.id, 'w1'));

    expect(await db.select().from(schema.sets)).toHaveLength(0);
    expect(await db.select().from(schema.workoutExercises)).toHaveLength(0);
  });
});
```

Both tests are self-contained (they insert their own exercise rows); Task 2's tests cover the seed catalog.

- [ ] **Step 3: Run to verify failure** — `npm test -w worker` → fails: `schema.workouts` undefined.

- [ ] **Step 4: Extend `worker/src/db/schema.ts`** — append below the `users` table (keep existing imports, add `real`, `index`, `relations`):

```ts
import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Equipment, ExerciseType, Locale, MuscleGroup, Theme, Unit } from '@bodyatlas/shared';

// ... users table unchanged ...

export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').references(() => users.id), // NULL = seed catalog row
    nameEn: text('name_en').notNull(),
    nameJa: text('name_ja'),
    type: text('type').$type<ExerciseType>().notNull(),
    muscleGroup: text('muscle_group').$type<MuscleGroup>().notNull(),
    equipment: text('equipment').$type<Equipment>().notNull(),
    isArchived: integer('is_archived', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => [index('idx_exercises_user').on(t.userId)],
);

export const templates = sqliteTable('templates', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const templateExercises = sqliteTable(
  'template_exercises',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    position: integer('position').notNull(),
    targetSets: integer('target_sets'),
  },
  (t) => [index('idx_template_exercises_template').on(t.templateId)],
);

export const workouts = sqliteTable(
  'workouts',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    templateId: text('template_id').references(() => templates.id, { onDelete: 'set null' }),
    startedAt: integer('started_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    endedAt: integer('ended_at', { mode: 'timestamp' }),
    notes: text('notes'),
  },
  (t) => [index('idx_workouts_user_started').on(t.userId, t.startedAt)],
);

export const workoutExercises = sqliteTable(
  'workout_exercises',
  {
    id: text('id').primaryKey(),
    workoutId: text('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    position: integer('position').notNull(),
    notes: text('notes'),
  },
  (t) => [
    index('idx_workout_exercises_workout').on(t.workoutId),
    index('idx_workout_exercises_exercise').on(t.exerciseId),
  ],
);

export const sets = sqliteTable(
  'sets',
  {
    id: text('id').primaryKey(),
    workoutExerciseId: text('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    weightKg: real('weight_kg'),
    reps: integer('reps'),
    rpe: real('rpe'),
    durationSec: integer('duration_sec'),
    distanceM: real('distance_m'),
  },
  (t) => [index('idx_sets_workout_exercise').on(t.workoutExerciseId)],
);

export const workoutsRelations = relations(workouts, ({ many }) => ({
  workoutExercises: many(workoutExercises),
}));
export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  workout: one(workouts, { fields: [workoutExercises.workoutId], references: [workouts.id] }),
  exercise: one(exercises, { fields: [workoutExercises.exerciseId], references: [exercises.id] }),
  sets: many(sets),
}));
export const setsRelations = relations(sets, ({ one }) => ({
  workoutExercise: one(workoutExercises, {
    fields: [sets.workoutExerciseId],
    references: [workoutExercises.id],
  }),
}));
export const templatesRelations = relations(templates, ({ many }) => ({
  templateExercises: many(templateExercises),
}));
export const templateExercisesRelations = relations(templateExercises, ({ one }) => ({
  template: one(templates, { fields: [templateExercises.templateId], references: [templates.id] }),
  exercise: one(exercises, { fields: [templateExercises.exerciseId], references: [exercises.id] }),
}));
```

- [ ] **Step 5: Generate the migration**

Run: `npm run db:generate -w worker -- --name workout_tables`
Expected: `worker/migrations/0001_workout_tables.sql` with 6 CREATE TABLEs, FKs (cascade/set-null as specified), and the 6 indexes. Read it and confirm.

- [ ] **Step 6: Update `worker/test/reset-db.ts`** — child-first order, preserve seed catalog:

```ts
import { env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// Child tables first so FK constraints never block deletes.
const USER_TABLES = [
  'sets',
  'workout_exercises',
  'workouts',
  'template_exercises',
  'templates',
];

beforeEach(async () => {
  for (const table of USER_TABLES) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  // Keep the seed catalog (user_id IS NULL); remove only user-created exercises.
  await env.DB.exec(`DELETE FROM exercises WHERE user_id IS NOT NULL`);
  await env.DB.exec(`DELETE FROM users`);
});
```

- [ ] **Step 7: Add workout helpers to `worker/test/helpers.ts`** (append):

```ts
export async function seedCustomExercise(
  id: string,
  userId: string,
  overrides: Partial<typeof schema.exercises.$inferInsert> = {},
) {
  const db = getDb(env.DB);
  await db.insert(schema.exercises).values({
    id,
    userId,
    nameEn: `Exercise ${id}`,
    type: 'strength',
    muscleGroup: 'chest',
    equipment: 'barbell',
    ...overrides,
  });
}

/** Creates a finished workout with one exercise and the given sets. */
export async function seedWorkout(
  id: string,
  userId: string,
  exerciseId: string,
  setValues: Array<Partial<typeof schema.sets.$inferInsert>>,
  overrides: Partial<typeof schema.workouts.$inferInsert> = {},
) {
  const db = getDb(env.DB);
  await db.insert(schema.workouts).values({
    id,
    userId,
    startedAt: new Date('2026-06-01T10:00:00Z'),
    endedAt: new Date('2026-06-01T11:00:00Z'),
    ...overrides,
  });
  await db.insert(schema.workoutExercises).values({
    id: `${id}-we1`,
    workoutId: id,
    exerciseId,
    position: 1,
  });
  if (setValues.length > 0) {
    await db.insert(schema.sets).values(
      setValues.map((v, i) => ({
        id: `${id}-s${i + 1}`,
        workoutExerciseId: `${id}-we1`,
        position: i + 1,
        ...v,
      })),
    );
  }
}

export async function seedTemplate(
  id: string,
  userId: string,
  name: string,
  exerciseIds: string[],
) {
  const db = getDb(env.DB);
  await db.insert(schema.templates).values({ id, userId, name });
  if (exerciseIds.length > 0) {
    await db.insert(schema.templateExercises).values(
      exerciseIds.map((exerciseId, i) => ({
        id: `${id}-te${i + 1}`,
        templateId: id,
        exerciseId,
        position: i + 1,
      })),
    );
  }
}
```

- [ ] **Step 8: Run tests** — `npm test -w worker && npm run typecheck -w worker` → all pass (existing 18 + 2 new).

- [ ] **Step 9: Commit**

```bash
git add shared worker
git commit -m "feat: add workout domain tables with relations and migration"
```

---

### Task 2: Seed exercise catalog (custom migration)

**Files:**
- Create: `worker/migrations/0002_seed_exercises.sql` (hand-written)
- Modify: `worker/migrations/meta/_journal.json` (via drizzle-kit custom generation)
- Test: extend `worker/test/workout-db.test.ts`

- [ ] **Step 1: Write the failing test** — append to `worker/test/workout-db.test.ts`:

```ts
import { isNull } from 'drizzle-orm';

describe('seed exercise catalog', () => {
  it('ships seed exercises with EN/JA names and survives the per-test reset', async () => {
    const db = getDb(env.DB);
    const seeds = await db.select().from(schema.exercises).where(isNull(schema.exercises.userId));
    expect(seeds.length).toBeGreaterThanOrEqual(35);

    const bench = seeds.find((e) => e.id === 'seed-barbell-bench-press');
    expect(bench).toMatchObject({
      nameEn: 'Barbell Bench Press',
      nameJa: 'ベンチプレス',
      type: 'strength',
      muscleGroup: 'chest',
      equipment: 'barbell',
    });
    const hack = seeds.find((e) => e.id === 'seed-machine-hack-squat');
    expect(hack?.nameJa).toBe('ハックスクワット');
  });
});
```

- [ ] **Step 2: Generate an empty custom migration**

Run: `npm run db:generate -w worker -- --custom --name seed_exercises`
Expected: empty `worker/migrations/0002_seed_exercises.sql` + journal entry. (If `--custom` is unsupported by the installed drizzle-kit, create the file by hand and append the journal entry mirroring the existing entries' shape.)

- [ ] **Step 3: Fill `worker/migrations/0002_seed_exercises.sql`**

```sql
INSERT INTO exercises (id, user_id, name_en, name_ja, type, muscle_group, equipment, is_archived, created_at) VALUES
('seed-barbell-bench-press', NULL, 'Barbell Bench Press', 'ベンチプレス', 'strength', 'chest', 'barbell', 0, unixepoch()),
('seed-incline-dumbbell-press', NULL, 'Incline Dumbbell Press', 'インクラインダンベルプレス', 'strength', 'chest', 'dumbbell', 0, unixepoch()),
('seed-dumbbell-fly', NULL, 'Dumbbell Fly', 'ダンベルフライ', 'strength', 'chest', 'dumbbell', 0, unixepoch()),
('seed-chest-press-machine', NULL, 'Chest Press Machine', 'チェストプレス', 'strength', 'chest', 'machine', 0, unixepoch()),
('seed-cable-crossover', NULL, 'Cable Crossover', 'ケーブルクロスオーバー', 'strength', 'chest', 'cable', 0, unixepoch()),
('seed-push-up', NULL, 'Push-Up', '腕立て伏せ', 'bodyweight', 'chest', 'bodyweight', 0, unixepoch()),
('seed-deadlift', NULL, 'Deadlift', 'デッドリフト', 'strength', 'back', 'barbell', 0, unixepoch()),
('seed-barbell-row', NULL, 'Barbell Row', 'ベントオーバーロー', 'strength', 'back', 'barbell', 0, unixepoch()),
('seed-lat-pulldown', NULL, 'Lat Pulldown', 'ラットプルダウン', 'strength', 'back', 'machine', 0, unixepoch()),
('seed-seated-cable-row', NULL, 'Seated Cable Row', 'シーテッドロー', 'strength', 'back', 'cable', 0, unixepoch()),
('seed-pull-up', NULL, 'Pull-Up', '懸垂', 'bodyweight', 'back', 'bodyweight', 0, unixepoch()),
('seed-dumbbell-row', NULL, 'One-Arm Dumbbell Row', 'ワンハンドロー', 'strength', 'back', 'dumbbell', 0, unixepoch()),
('seed-overhead-press', NULL, 'Overhead Press', 'オーバーヘッドプレス', 'strength', 'shoulders', 'barbell', 0, unixepoch()),
('seed-dumbbell-shoulder-press', NULL, 'Dumbbell Shoulder Press', 'ダンベルショルダープレス', 'strength', 'shoulders', 'dumbbell', 0, unixepoch()),
('seed-lateral-raise', NULL, 'Lateral Raise', 'サイドレイズ', 'strength', 'shoulders', 'dumbbell', 0, unixepoch()),
('seed-rear-delt-fly', NULL, 'Rear Delt Fly', 'リアレイズ', 'strength', 'shoulders', 'dumbbell', 0, unixepoch()),
('seed-face-pull', NULL, 'Face Pull', 'フェイスプル', 'strength', 'shoulders', 'cable', 0, unixepoch()),
('seed-barbell-curl', NULL, 'Barbell Curl', 'バーベルカール', 'strength', 'arms', 'barbell', 0, unixepoch()),
('seed-dumbbell-curl', NULL, 'Dumbbell Curl', 'ダンベルカール', 'strength', 'arms', 'dumbbell', 0, unixepoch()),
('seed-hammer-curl', NULL, 'Hammer Curl', 'ハンマーカール', 'strength', 'arms', 'dumbbell', 0, unixepoch()),
('seed-triceps-pushdown', NULL, 'Triceps Pushdown', 'トライセプスプッシュダウン', 'strength', 'arms', 'cable', 0, unixepoch()),
('seed-skull-crusher', NULL, 'Skull Crusher', 'スカルクラッシャー', 'strength', 'arms', 'barbell', 0, unixepoch()),
('seed-dip', NULL, 'Dip', 'ディップス', 'bodyweight', 'arms', 'bodyweight', 0, unixepoch()),
('seed-back-squat', NULL, 'Back Squat', 'バックスクワット', 'strength', 'legs', 'barbell', 0, unixepoch()),
('seed-front-squat', NULL, 'Front Squat', 'フロントスクワット', 'strength', 'legs', 'barbell', 0, unixepoch()),
('seed-leg-press', NULL, 'Leg Press', 'レッグプレス', 'strength', 'legs', 'machine', 0, unixepoch()),
('seed-machine-hack-squat', NULL, 'Machine Hack Squat', 'ハックスクワット', 'strength', 'legs', 'machine', 0, unixepoch()),
('seed-romanian-deadlift', NULL, 'Romanian Deadlift', 'ルーマニアンデッドリフト', 'strength', 'legs', 'barbell', 0, unixepoch()),
('seed-leg-extension', NULL, 'Leg Extension', 'レッグエクステンション', 'strength', 'legs', 'machine', 0, unixepoch()),
('seed-leg-curl', NULL, 'Leg Curl', 'レッグカール', 'strength', 'legs', 'machine', 0, unixepoch()),
('seed-calf-raise', NULL, 'Calf Raise', 'カーフレイズ', 'strength', 'legs', 'machine', 0, unixepoch()),
('seed-bulgarian-split-squat', NULL, 'Bulgarian Split Squat', 'ブルガリアンスクワット', 'strength', 'legs', 'dumbbell', 0, unixepoch()),
('seed-hip-thrust', NULL, 'Hip Thrust', 'ヒップスラスト', 'strength', 'legs', 'barbell', 0, unixepoch()),
('seed-plank', NULL, 'Plank', 'プランク', 'bodyweight', 'core', 'bodyweight', 0, unixepoch()),
('seed-crunch', NULL, 'Crunch', 'クランチ', 'bodyweight', 'core', 'bodyweight', 0, unixepoch()),
('seed-hanging-leg-raise', NULL, 'Hanging Leg Raise', 'ハンギングレッグレイズ', 'bodyweight', 'core', 'bodyweight', 0, unixepoch()),
('seed-ab-wheel', NULL, 'Ab Wheel Rollout', 'アブローラー', 'bodyweight', 'core', 'bodyweight', 0, unixepoch()),
('seed-cable-crunch', NULL, 'Cable Crunch', 'ケーブルクランチ', 'strength', 'core', 'cable', 0, unixepoch()),
('seed-treadmill-run', NULL, 'Treadmill Run', 'トレッドミル', 'cardio', 'full-body', 'cardio-machine', 0, unixepoch()),
('seed-cycling', NULL, 'Stationary Bike', 'バイク', 'cardio', 'legs', 'cardio-machine', 0, unixepoch()),
('seed-rowing-machine', NULL, 'Rowing Machine', 'ローイングマシン', 'cardio', 'full-body', 'cardio-machine', 0, unixepoch()),
('seed-stair-climber', NULL, 'Stair Climber', 'ステアクライマー', 'cardio', 'legs', 'cardio-machine', 0, unixepoch());
```

- [ ] **Step 4: Run tests** — `npm test -w worker` → the new seed test passes (migrations run in test setup; reset-db preserves `user_id IS NULL` rows).

- [ ] **Step 5: Commit**

```bash
git add worker/migrations worker/test
git commit -m "feat: seed exercise catalog with 42 common exercises (EN/JA)"
```

---

### Task 3: Shared workout Zod schemas

**Files:**
- Modify: `shared/src/workout.ts`
- Test: `shared/src/workout.test.ts`

- [ ] **Step 1: Write the failing test** — `shared/src/workout.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  createExerciseSchema,
  createWorkoutSchema,
  setInputSchema,
  templateInputSchema,
  updateWorkoutSchema,
} from './workout';

describe('setInputSchema', () => {
  it('accepts a strength set', () => {
    expect(setInputSchema.safeParse({ weightKg: 80, reps: 8, rpe: 8.5 }).success).toBe(true);
  });
  it('accepts a cardio set with duration only', () => {
    expect(setInputSchema.safeParse({ durationSec: 1200 }).success).toBe(true);
  });
  it('rejects an empty set', () => {
    expect(setInputSchema.safeParse({ weightKg: 80 }).success).toBe(false);
  });
  it('rejects rpe off the 0.5 grid', () => {
    expect(setInputSchema.safeParse({ reps: 8, rpe: 8.3 }).success).toBe(false);
  });
});

describe('createWorkoutSchema', () => {
  it('accepts empty, templateId, or copyFromWorkoutId — but not both sources', () => {
    expect(createWorkoutSchema.safeParse({}).success).toBe(true);
    expect(createWorkoutSchema.safeParse({ templateId: 't1' }).success).toBe(true);
    expect(createWorkoutSchema.safeParse({ copyFromWorkoutId: 'w1' }).success).toBe(true);
    expect(
      createWorkoutSchema.safeParse({ templateId: 't1', copyFromWorkoutId: 'w1' }).success,
    ).toBe(false);
  });
});

describe('templateInputSchema', () => {
  it('requires a name and at least one exercise', () => {
    expect(templateInputSchema.safeParse({ name: 'Push A', exercises: [] }).success).toBe(false);
    expect(
      templateInputSchema.safeParse({
        name: 'Push A',
        exercises: [{ exerciseId: 'seed-barbell-bench-press', targetSets: 3 }],
      }).success,
    ).toBe(true);
  });
});

describe('createExerciseSchema', () => {
  it('trims and bounds the name', () => {
    expect(createExerciseSchema.safeParse({ name: '  ', type: 'strength', muscleGroup: 'chest', equipment: 'barbell' }).success).toBe(false);
  });
});

describe('updateWorkoutSchema', () => {
  it('accepts finish and notes', () => {
    expect(updateWorkoutSchema.safeParse({ finish: true, notes: 'felt strong' }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npm test -w shared`.

- [ ] **Step 3: Implement** — append to `shared/src/workout.ts`:

```ts
import { z } from 'zod';

export const setInputSchema = z
  .object({
    weightKg: z.number().positive().max(1000).optional(),
    reps: z.number().int().positive().max(1000).optional(),
    rpe: z.number().min(1).max(10).multipleOf(0.5).optional(),
    durationSec: z.number().int().positive().max(86400).optional(),
    distanceM: z.number().positive().max(1000000).optional(),
  })
  .refine((v) => v.reps !== undefined || v.durationSec !== undefined || v.distanceM !== undefined, {
    message: 'A set needs reps, duration, or distance',
  });

export const createExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(EXERCISE_TYPES),
  muscleGroup: z.enum(MUSCLE_GROUPS),
  equipment: z.enum(EQUIPMENT),
});

export const updateExerciseSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  muscleGroup: z.enum(MUSCLE_GROUPS).optional(),
  equipment: z.enum(EQUIPMENT).optional(),
  isArchived: z.boolean().optional(),
});

export const createWorkoutSchema = z
  .object({
    templateId: z.string().optional(),
    copyFromWorkoutId: z.string().optional(),
  })
  .refine((v) => !(v.templateId && v.copyFromWorkoutId), {
    message: 'Provide templateId or copyFromWorkoutId, not both',
  });

export const updateWorkoutSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  finish: z.boolean().optional(),
});

export const templateInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  exercises: z
    .array(
      z.object({
        exerciseId: z.string(),
        targetSets: z.number().int().positive().max(20).optional(),
      }),
    )
    .min(1)
    .max(30),
});

export const addWorkoutExerciseSchema = z.object({ exerciseId: z.string() });

export type SetInput = z.infer<typeof setInputSchema>;
export type CreateExercise = z.infer<typeof createExerciseSchema>;
export type UpdateExercise = z.infer<typeof updateExerciseSchema>;
export type CreateWorkout = z.infer<typeof createWorkoutSchema>;
export type UpdateWorkout = z.infer<typeof updateWorkoutSchema>;
export type TemplateInput = z.infer<typeof templateInputSchema>;
```

(Keep the existing constants at the top of the file; the `import { z }` line goes first.)

- [ ] **Step 4: Run tests** — `npm test -w shared && npm run typecheck -w shared` → PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat: add workout domain validation schemas"
```

---

### Task 4: `/api/exercises` — search, create custom, update/archive, last-sets

**Files:**
- Create: `worker/src/routes/exercises.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/exercises.test.ts`

- [ ] **Step 1: Write the failing tests** — `worker/test/exercises.test.ts`

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedCustomExercise, seedUser, seedWorkout, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

describe('/api/exercises', () => {
  it('lists seed + own custom exercises, not other users’ customs', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedCustomExercise('mine', 'user-1', { nameEn: 'My Special Press' });
    await seedCustomExercise('theirs', 'user-2', { nameEn: 'Their Press' });

    const res = await SELF.fetch('https://example.com/api/exercises', { headers });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.some((e) => e.id === 'mine')).toBe(true);
    expect(list.some((e) => e.id === 'theirs')).toBe(false);
    expect(list.some((e) => e.id === 'seed-barbell-bench-press')).toBe(true);
  });

  it('searches by Japanese name', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/exercises?q=ベンチ', { headers });
    const list = (await res.json()) as Array<{ id: string }>;
    expect(list.map((e) => e.id)).toContain('seed-barbell-bench-press');
    expect(list.every((e) => e.id !== 'seed-back-squat')).toBe(true);
  });

  it('creates a custom exercise', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/exercises', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Zercher Squat', type: 'strength', muscleGroup: 'legs', equipment: 'barbell' }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; nameEn: string; userId: string };
    expect(created.nameEn).toBe('Zercher Squat');
    expect(created.userId).toBe('user-1');
  });

  it('archives own custom exercise but rejects patching seed rows', async () => {
    const headers = await authed();
    await seedCustomExercise('mine', 'user-1');
    const ok = await SELF.fetch('https://example.com/api/exercises/mine', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: true }),
    });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { isArchived: boolean }).isArchived).toBe(true);

    const seed = await SELF.fetch('https://example.com/api/exercises/seed-barbell-bench-press', {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ isArchived: true }),
    });
    expect(seed.status).toBe(404);
  });

  it('returns the most recent sets for an exercise via last-sets', async () => {
    const headers = await authed();
    await seedWorkout('w-old', 'user-1', 'seed-barbell-bench-press', [{ weightKg: 75, reps: 8 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
      endedAt: new Date('2026-05-01T11:00:00Z'),
    });
    await seedWorkout('w-new', 'user-1', 'seed-barbell-bench-press', [
      { weightKg: 80, reps: 8 },
      { weightKg: 80, reps: 7 },
    ]);

    const res = await SELF.fetch(
      'https://example.com/api/exercises/seed-barbell-bench-press/last-sets',
      { headers },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { workoutId: string; sets: Array<{ weightKg: number }> } | null;
    expect(body?.workoutId).toBe('w-new');
    expect(body?.sets).toHaveLength(2);
  });

  it('last-sets excludes a given workout (the active one)', async () => {
    const headers = await authed();
    await seedWorkout('w-prev', 'user-1', 'seed-deadlift', [{ weightKg: 120, reps: 5 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
    });
    await seedWorkout('w-active', 'user-1', 'seed-deadlift', [], { endedAt: null });

    const res = await SELF.fetch(
      'https://example.com/api/exercises/seed-deadlift/last-sets?excludeWorkoutId=w-active',
      { headers },
    );
    const body = (await res.json()) as { workoutId: string } | null;
    expect(body?.workoutId).toBe('w-prev');
  });

  it('last-sets returns null when never performed', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/exercises/seed-dip/last-sets', { headers });
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — 404s everywhere.

- [ ] **Step 3: Implement** — `worker/src/routes/exercises.ts`

```ts
import { zValidator } from '@hono/zod-validator';
import { createExerciseSchema, updateExerciseSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, isNull, like, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Exercise not found' } } as const;

export const exercisesRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const q = c.req.query('q');
    const includeArchived = c.req.query('includeArchived') === 'true';
    const rows = await db
      .select()
      .from(schema.exercises)
      .where(
        and(
          or(isNull(schema.exercises.userId), eq(schema.exercises.userId, c.get('userId'))),
          includeArchived ? undefined : eq(schema.exercises.isArchived, false),
          q
            ? or(
                like(schema.exercises.nameEn, `%${q}%`),
                like(schema.exercises.nameJa, `%${q}%`),
              )
            : undefined,
        ),
      )
      .orderBy(asc(schema.exercises.nameEn));
    return c.json(rows);
  })
  .post(
    '/',
    zValidator('json', createExerciseSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const input = c.req.valid('json');
      const db = getDb(c.env.DB);
      const id = crypto.randomUUID();
      await db.insert(schema.exercises).values({
        id,
        userId: c.get('userId'),
        nameEn: input.name,
        type: input.type,
        muscleGroup: input.muscleGroup,
        equipment: input.equipment,
      });
      const created = await db.query.exercises.findFirst({ where: eq(schema.exercises.id, id) });
      return c.json(created, 201);
    },
  )
  .patch(
    '/:id',
    zValidator('json', updateExerciseSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const id = c.req.param('id');
      // Only the owner's custom rows are editable; seed rows (userId NULL) 404.
      const existing = await db.query.exercises.findFirst({
        where: and(eq(schema.exercises.id, id), eq(schema.exercises.userId, c.get('userId'))),
      });
      if (!existing) return c.json(notFound, 404);
      const patch = c.req.valid('json');
      const { name, ...rest } = patch;
      if (Object.keys(patch).length > 0) {
        await db
          .update(schema.exercises)
          .set({ ...rest, ...(name !== undefined ? { nameEn: name } : {}) })
          .where(eq(schema.exercises.id, id));
      }
      const updated = await db.query.exercises.findFirst({ where: eq(schema.exercises.id, id) });
      return c.json(updated);
    },
  )
  .get('/:id/last-sets', async (c) => {
    const db = getDb(c.env.DB);
    const exerciseId = c.req.param('id');
    const excludeWorkoutId = c.req.query('excludeWorkoutId');
    const [lastOccurrence] = await db
      .select({
        workoutExerciseId: schema.workoutExercises.id,
        workoutId: schema.workouts.id,
        startedAt: schema.workouts.startedAt,
      })
      .from(schema.workoutExercises)
      .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
      .where(
        and(
          eq(schema.workouts.userId, c.get('userId')),
          eq(schema.workoutExercises.exerciseId, exerciseId),
          excludeWorkoutId ? ne(schema.workouts.id, excludeWorkoutId) : undefined,
        ),
      )
      .orderBy(desc(schema.workouts.startedAt))
      .limit(1);
    if (!lastOccurrence) return c.json(null);
    const lastSets = await db
      .select()
      .from(schema.sets)
      .where(eq(schema.sets.workoutExerciseId, lastOccurrence.workoutExerciseId))
      .orderBy(asc(schema.sets.position));
    return c.json({
      workoutId: lastOccurrence.workoutId,
      startedAt: lastOccurrence.startedAt,
      sets: lastSets,
    });
  });
```

- [ ] **Step 4: Mount** — in `worker/src/index.ts`, extend the `apiApp` chain (order matters for RPC types; keep `/health` → `requireAuth` first):

```ts
import { exercisesRoutes } from './routes/exercises';

export const apiApp = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  .use(requireAuth)
  .route('/me', meRoutes)
  .route('/exercises', exercisesRoutes);
```

- [ ] **Step 5: Run tests** — `npm test -w worker && npm run typecheck -w worker` → all pass.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "feat: add exercises API with search, custom creation, and last-sets"
```

---

### Task 5: `/api/templates` — CRUD with full-replace update

**Files:**
- Create: `worker/src/routes/templates.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/templates.test.ts`

- [ ] **Step 1: Write the failing tests** — `worker/test/templates.test.ts`

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedTemplate, seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('/api/templates', () => {
  it('creates a template with ordered exercises and lists it', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/templates',
      json(headers, {
        name: 'Push Day A',
        exercises: [
          { exerciseId: 'seed-barbell-bench-press', targetSets: 3 },
          { exerciseId: 'seed-overhead-press', targetSets: 3 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      name: string;
      templateExercises: Array<{ position: number; exercise: { id: string } }>;
    };
    expect(created.templateExercises.map((te) => te.exercise.id)).toEqual([
      'seed-barbell-bench-press',
      'seed-overhead-press',
    ]);

    const list = await SELF.fetch('https://example.com/api/templates', { headers });
    expect(((await list.json()) as unknown[]).length).toBe(1);
  });

  it('rejects a template referencing a nonexistent exercise', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/templates',
      json(headers, { name: 'Bad', exercises: [{ exerciseId: 'nope' }] }),
    );
    expect(res.status).toBe(422);
  });

  it('replaces the exercise list on PUT', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Pull Day', ['seed-deadlift', 'seed-pull-up']);
    const res = await SELF.fetch(
      'https://example.com/api/templates/t1',
      json(headers, { name: 'Pull Day B', exercises: [{ exerciseId: 'seed-barbell-row' }] }, 'PUT'),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as {
      name: string;
      templateExercises: Array<{ exercise: { id: string } }>;
    };
    expect(updated.name).toBe('Pull Day B');
    expect(updated.templateExercises.map((te) => te.exercise.id)).toEqual(['seed-barbell-row']);
  });

  it('scopes templates to the owner', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedTemplate('t2', 'user-2', 'Theirs', ['seed-deadlift']);
    const res = await SELF.fetch('https://example.com/api/templates/t2', { headers });
    expect(res.status).toBe(404);
  });

  it('deletes a template', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Push', ['seed-barbell-bench-press']);
    const res = await SELF.fetch('https://example.com/api/templates/t1', { ...{ headers }, method: 'DELETE' });
    expect(res.status).toBe(200);
    const gone = await SELF.fetch('https://example.com/api/templates/t1', { headers });
    expect(gone.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — `worker/src/routes/templates.ts`

```ts
import { zValidator } from '@hono/zod-validator';
import { templateInputSchema, type TemplateInput } from '@bodyatlas/shared';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema, type Db } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Template not found' } } as const;

const validateJson = zValidator('json', templateInputSchema, (result, c) => {
  if (!result.success) return c.json(validationError(result.error.issues), 422);
});

async function loadTemplate(db: Db, userId: string, id: string) {
  return db.query.templates.findFirst({
    where: and(eq(schema.templates.id, id), eq(schema.templates.userId, userId)),
    with: {
      templateExercises: {
        orderBy: asc(schema.templateExercises.position),
        with: { exercise: true },
      },
    },
  });
}

/** All referenced exercises must exist and be visible to the user (seed or own). */
async function exercisesVisible(db: Db, userId: string, input: TemplateInput): Promise<boolean> {
  const ids = input.exercises.map((e) => e.exerciseId);
  const found = await db
    .select({ id: schema.exercises.id })
    .from(schema.exercises)
    .where(
      and(
        inArray(schema.exercises.id, ids),
        or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
      ),
    );
  return found.length === new Set(ids).size;
}

function exerciseRows(templateId: string, input: TemplateInput) {
  return input.exercises.map((e, i) => ({
    id: crypto.randomUUID(),
    templateId,
    exerciseId: e.exerciseId,
    position: i + 1,
    targetSets: e.targetSets ?? null,
  }));
}

export const templatesRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const rows = await db.query.templates.findMany({
      where: eq(schema.templates.userId, c.get('userId')),
      orderBy: desc(schema.templates.createdAt),
      with: {
        templateExercises: {
          orderBy: asc(schema.templateExercises.position),
          with: { exercise: true },
        },
      },
    });
    return c.json(rows);
  })
  .post('/', validateJson, async (c) => {
    const input = c.req.valid('json');
    const db = getDb(c.env.DB);
    if (!(await exercisesVisible(db, c.get('userId'), input))) {
      return c.json(validationError([{ message: 'Unknown exerciseId' }]), 422);
    }
    const id = crypto.randomUUID();
    const rows = exerciseRows(id, input);
    await db.batch([
      db.insert(schema.templates).values({ id, userId: c.get('userId'), name: input.name }),
      ...rows.map((r) => db.insert(schema.templateExercises).values(r)),
    ] as [Parameters<Db['batch']>[0][number], ...Parameters<Db['batch']>[0]]);
    return c.json(await loadTemplate(db, c.get('userId'), id), 201);
  })
  .get('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const tpl = await loadTemplate(db, c.get('userId'), c.req.param('id'));
    if (!tpl) return c.json(notFound, 404);
    return c.json(tpl);
  })
  .put('/:id', validateJson, async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.templates.findFirst({
      where: and(eq(schema.templates.id, id), eq(schema.templates.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    const input = c.req.valid('json');
    if (!(await exercisesVisible(db, c.get('userId'), input))) {
      return c.json(validationError([{ message: 'Unknown exerciseId' }]), 422);
    }
    const rows = exerciseRows(id, input);
    await db.batch([
      db.update(schema.templates).set({ name: input.name }).where(eq(schema.templates.id, id)),
      db.delete(schema.templateExercises).where(eq(schema.templateExercises.templateId, id)),
      ...rows.map((r) => db.insert(schema.templateExercises).values(r)),
    ] as [Parameters<Db['batch']>[0][number], ...Parameters<Db['batch']>[0]]);
    return c.json(await loadTemplate(db, c.get('userId'), id));
  })
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const id = c.req.param('id');
    const existing = await db.query.templates.findFirst({
      where: and(eq(schema.templates.id, id), eq(schema.templates.userId, c.get('userId'))),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.templates).where(eq(schema.templates.id, id)); // cascades to template_exercises
    return c.json({ ok: true });
  });
```

(If the `db.batch` tuple-typing cast is awkward with the installed Drizzle version, a simpler accepted form is `await db.batch([first, ...rest] as any)` with a one-line comment — correctness is covered by tests. Prefer the typed form if it compiles.)

- [ ] **Step 4: Mount** — add `.route('/templates', templatesRoutes)` to the `apiApp` chain.

- [ ] **Step 5: Run tests** — all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "feat: add templates API with full-replace updates"
```

---

### Task 6: `/api/workouts` — create (empty/template/copy), active, list, detail, finish, delete

**Files:**
- Create: `worker/src/routes/workouts.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/workouts.test.ts`

- [ ] **Step 1: Write the failing tests** — `worker/test/workouts.test.ts`

```ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedTemplate, seedUser, seedWorkout, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

type WorkoutDetail = {
  id: string;
  endedAt: string | null;
  workoutExercises: Array<{ id: string; exercise: { id: string }; sets: unknown[] }>;
};

describe('/api/workouts', () => {
  it('creates an empty active workout and reports it via /active', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    expect(res.status).toBe(201);
    const created = (await res.json()) as WorkoutDetail;
    expect(created.endedAt).toBeNull();

    const active = await SELF.fetch('https://example.com/api/workouts/active', { headers });
    expect(((await active.json()) as { workout: WorkoutDetail | null }).workout?.id).toBe(created.id);
  });

  it('refuses a second active workout with 409', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    const second = await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string; details: { workoutId: string } } };
    expect(body.error.code).toBe('active_workout_exists');
    expect(body.error.details.workoutId).toBeTruthy();
  });

  it('pre-fills exercises from a template', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Push A', ['seed-barbell-bench-press', 'seed-overhead-press']);
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, { templateId: 't1' }));
    const created = (await res.json()) as WorkoutDetail;
    expect(created.workoutExercises.map((we) => we.exercise.id)).toEqual([
      'seed-barbell-bench-press',
      'seed-overhead-press',
    ]);
  });

  it('copies the exercise list from a previous workout', async () => {
    const headers = await authed();
    await seedWorkout('w-old', 'user-1', 'seed-deadlift', [{ weightKg: 120, reps: 5 }]);
    const res = await SELF.fetch(
      'https://example.com/api/workouts',
      json(headers, { copyFromWorkoutId: 'w-old' }),
    );
    const created = (await res.json()) as WorkoutDetail;
    expect(created.workoutExercises.map((we) => we.exercise.id)).toEqual(['seed-deadlift']);
    expect(created.workoutExercises[0]?.sets).toHaveLength(0); // structure copied, sets are not
  });

  it('finishes a workout via PATCH and clears /active', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch('https://example.com/api/workouts', json(headers, {}))
    ).json()) as WorkoutDetail;

    const patched = await SELF.fetch(
      `https://example.com/api/workouts/${created.id}`,
      json(headers, { finish: true, notes: 'good session' }, 'PATCH'),
    );
    const finished = (await patched.json()) as { endedAt: string | null; notes: string };
    expect(finished.endedAt).not.toBeNull();
    expect(finished.notes).toBe('good session');

    const active = await SELF.fetch('https://example.com/api/workouts/active', { headers });
    expect(((await active.json()) as { workout: unknown }).workout).toBeNull();
  });

  it('lists workouts newest-first with set counts and filters by exercise', async () => {
    const headers = await authed();
    await seedWorkout('w1', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }], {
      startedAt: new Date('2026-05-01T10:00:00Z'),
    });
    await seedWorkout('w2', 'user-1', 'seed-back-squat', [{ weightKg: 90, reps: 5 }, { weightKg: 90, reps: 5 }], {
      startedAt: new Date('2026-06-01T10:00:00Z'),
    });

    const res = await SELF.fetch('https://example.com/api/workouts', { headers });
    const list = (await res.json()) as Array<{ id: string; setCount: number; exerciseNames: string[] }>;
    expect(list.map((w) => w.id)).toEqual(['w2', 'w1']);
    expect(list[0]?.setCount).toBe(2);
    expect(list[0]?.exerciseNames).toContain('Back Squat');

    const filtered = await SELF.fetch('https://example.com/api/workouts?exerciseId=seed-deadlift', { headers });
    expect(((await filtered.json()) as Array<{ id: string }>).map((w) => w.id)).toEqual(['w1']);
  });

  it('scopes detail to the owner and deletes with cascade', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    expect((await SELF.fetch('https://example.com/api/workouts/w-theirs', { headers })).status).toBe(404);

    await seedWorkout('w-mine', 'user-1', 'seed-deadlift', [{ weightKg: 100, reps: 5 }]);
    const del = await SELF.fetch('https://example.com/api/workouts/w-mine', { headers, method: 'DELETE' });
    expect(del.status).toBe(200);
    expect((await SELF.fetch('https://example.com/api/workouts/w-mine', { headers })).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — `worker/src/routes/workouts.ts` (core; nested set routes added in Task 7):

```ts
import { zValidator } from '@hono/zod-validator';
import { createWorkoutSchema, updateWorkoutSchema } from '@bodyatlas/shared';
import { and, asc, desc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { getDb, schema, type Db } from '../db';
import type { ProtectedEnv } from '../types';

const validationError = (issues: unknown) =>
  ({ error: { code: 'validation', message: 'Invalid request body', details: issues } }) as const;
const notFound = { error: { code: 'not_found', message: 'Workout not found' } } as const;

export async function loadWorkoutDetail(db: Db, userId: string, id: string) {
  return db.query.workouts.findFirst({
    where: and(eq(schema.workouts.id, id), eq(schema.workouts.userId, userId)),
    with: {
      workoutExercises: {
        orderBy: asc(schema.workoutExercises.position),
        with: { exercise: true, sets: { orderBy: asc(schema.sets.position) } },
      },
    },
  });
}

async function findActive(db: Db, userId: string) {
  return db.query.workouts.findFirst({
    where: and(eq(schema.workouts.userId, userId), isNull(schema.workouts.endedAt)),
  });
}

export const workoutsRoutes = new Hono<ProtectedEnv>()
  .get('/', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const { from, to, exerciseId } = c.req.query();
    const limit = Math.min(Number(c.req.query('limit') ?? 30) || 30, 100);

    let idFilter: string[] | undefined;
    if (exerciseId) {
      const rows = await db
        .selectDistinct({ workoutId: schema.workoutExercises.workoutId })
        .from(schema.workoutExercises)
        .where(eq(schema.workoutExercises.exerciseId, exerciseId));
      idFilter = rows.map((r) => r.workoutId);
      if (idFilter.length === 0) return c.json([]);
    }

    const rows = await db.query.workouts.findMany({
      where: and(
        eq(schema.workouts.userId, userId),
        from ? gte(schema.workouts.startedAt, new Date(from)) : undefined,
        to ? lte(schema.workouts.startedAt, new Date(to)) : undefined,
        idFilter ? inArray(schema.workouts.id, idFilter) : undefined,
      ),
      orderBy: desc(schema.workouts.startedAt),
      limit,
      with: {
        workoutExercises: {
          orderBy: asc(schema.workoutExercises.position),
          with: { exercise: true, sets: true },
        },
      },
    });

    return c.json(
      rows.map((w) => ({
        id: w.id,
        startedAt: w.startedAt,
        endedAt: w.endedAt,
        notes: w.notes,
        templateId: w.templateId,
        exerciseNames: w.workoutExercises.map((we) => we.exercise.nameEn),
        exerciseNamesJa: w.workoutExercises.map((we) => we.exercise.nameJa ?? we.exercise.nameEn),
        setCount: w.workoutExercises.reduce((n, we) => n + we.sets.length, 0),
      })),
    );
  })
  .get('/active', async (c) => {
    const db = getDb(c.env.DB);
    const active = await findActive(db, c.get('userId'));
    if (!active) return c.json({ workout: null });
    return c.json({ workout: await loadWorkoutDetail(db, c.get('userId'), active.id) });
  })
  .post(
    '/',
    zValidator('json', createWorkoutSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const userId = c.get('userId');
      const input = c.req.valid('json');

      const active = await findActive(db, userId);
      if (active) {
        return c.json(
          {
            error: {
              code: 'active_workout_exists',
              message: 'A workout is already in progress',
              details: { workoutId: active.id },
            },
          },
          409,
        );
      }

      let exerciseIds: string[] = [];
      let templateId: string | null = null;
      if (input.templateId) {
        const tpl = await db.query.templates.findFirst({
          where: and(eq(schema.templates.id, input.templateId), eq(schema.templates.userId, userId)),
          with: { templateExercises: { orderBy: asc(schema.templateExercises.position) } },
        });
        if (!tpl) return c.json({ error: { code: 'not_found', message: 'Template not found' } }, 404);
        templateId = tpl.id;
        exerciseIds = tpl.templateExercises.map((te) => te.exerciseId);
      } else if (input.copyFromWorkoutId) {
        const source = await loadWorkoutDetail(db, userId, input.copyFromWorkoutId);
        if (!source) return c.json(notFound, 404);
        exerciseIds = source.workoutExercises.map((we) => we.exercise.id);
      }

      const id = crypto.randomUUID();
      const inserts = [
        db.insert(schema.workouts).values({ id, userId, templateId }),
        ...exerciseIds.map((exerciseId, i) =>
          db.insert(schema.workoutExercises).values({
            id: crypto.randomUUID(),
            workoutId: id,
            exerciseId,
            position: i + 1,
          }),
        ),
      ];
      await db.batch(inserts as [(typeof inserts)[number], ...typeof inserts]);
      return c.json(await loadWorkoutDetail(db, userId, id), 201);
    },
  )
  .get('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const detail = await loadWorkoutDetail(db, c.get('userId'), c.req.param('id'));
    if (!detail) return c.json(notFound, 404);
    return c.json(detail);
  })
  .patch(
    '/:id',
    zValidator('json', updateWorkoutSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const userId = c.get('userId');
      const id = c.req.param('id');
      const existing = await db.query.workouts.findFirst({
        where: and(eq(schema.workouts.id, id), eq(schema.workouts.userId, userId)),
      });
      if (!existing) return c.json(notFound, 404);
      const input = c.req.valid('json');
      await db
        .update(schema.workouts)
        .set({
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          ...(input.finish ? { endedAt: new Date() } : {}),
        })
        .where(eq(schema.workouts.id, id));
      return c.json(await loadWorkoutDetail(db, userId, id));
    },
  )
  .delete('/:id', async (c) => {
    const db = getDb(c.env.DB);
    const userId = c.get('userId');
    const id = c.req.param('id');
    const existing = await db.query.workouts.findFirst({
      where: and(eq(schema.workouts.id, id), eq(schema.workouts.userId, userId)),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.workouts).where(eq(schema.workouts.id, id)); // cascades
    return c.json({ ok: true });
  });
```

ROUTE-ORDER NOTE: `/active` must be registered BEFORE `/:id` (shown above) or `active` would match as an id.

- [ ] **Step 4: Mount** — add `.route('/workouts', workoutsRoutes)` to the `apiApp` chain.

- [ ] **Step 5: Run tests** — all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add worker
git commit -m "feat: add workouts API with single-active rule, template and copy creation"
```

---

### Task 7: Nested workout exercises & sets routes

**Files:**
- Modify: `worker/src/routes/workouts.ts`
- Test: append to `worker/test/workouts.test.ts`

- [ ] **Step 1: Write the failing tests** — append:

```ts
describe('/api/workouts nested exercises and sets', () => {
  async function startWorkout(headers: Record<string, string>): Promise<WorkoutDetail> {
    const res = await SELF.fetch('https://example.com/api/workouts', json(headers, {}));
    return (await res.json()) as WorkoutDetail;
  }

  it('adds an exercise, logs sets with incrementing positions, edits and deletes a set', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);

    const weRes = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises`,
      json(headers, { exerciseId: 'seed-barbell-bench-press' }),
    );
    expect(weRes.status).toBe(201);
    const we = (await weRes.json()) as { id: string; position: number };
    expect(we.position).toBe(1);

    const s1 = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
        json(headers, { weightKg: 80, reps: 8, rpe: 8 }),
      )
    ).json()) as { id: string; position: number };
    const s2 = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
        json(headers, { weightKg: 80, reps: 7 }),
      )
    ).json()) as { id: string; position: number };
    expect([s1.position, s2.position]).toEqual([1, 2]);

    const patched = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets/${s2.id}`,
      json(headers, { weightKg: 82.5, reps: 6 }, 'PATCH'),
    );
    expect(((await patched.json()) as { weightKg: number }).weightKg).toBe(82.5);

    const del = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets/${s1.id}`,
      { headers, method: 'DELETE' },
    );
    expect(del.status).toBe(200);

    const detail = (await (
      await SELF.fetch(`https://example.com/api/workouts/${w.id}`, { headers })
    ).json()) as WorkoutDetail;
    expect(detail.workoutExercises[0]?.sets).toHaveLength(1);
  });

  it('rejects an invalid set payload with 422', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises`,
        json(headers, { exerciseId: 'seed-deadlift' }),
      )
    ).json()) as { id: string };
    const res = await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
      json(headers, { weightKg: 80 }), // no reps/duration/distance
    );
    expect(res.status).toBe(422);
  });

  it("cannot touch another user's workout via nested routes", async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedWorkout('w-theirs', 'user-2', 'seed-deadlift', []);
    const res = await SELF.fetch(
      'https://example.com/api/workouts/w-theirs/exercises',
      json(headers, { exerciseId: 'seed-deadlift' }),
    );
    expect(res.status).toBe(404);
  });

  it('removes a workout exercise together with its sets', async () => {
    const headers = await authed();
    const w = await startWorkout(headers);
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${w.id}/exercises`,
        json(headers, { exerciseId: 'seed-dip' }),
      )
    ).json()) as { id: string };
    await SELF.fetch(
      `https://example.com/api/workouts/${w.id}/exercises/${we.id}/sets`,
      json(headers, { reps: 10 }),
    );
    const del = await SELF.fetch(`https://example.com/api/workouts/${w.id}/exercises/${we.id}`, {
      headers,
      method: 'DELETE',
    });
    expect(del.status).toBe(200);
    const detail = (await (
      await SELF.fetch(`https://example.com/api/workouts/${w.id}`, { headers })
    ).json()) as WorkoutDetail;
    expect(detail.workoutExercises).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — extend the `workoutsRoutes` chain in `worker/src/routes/workouts.ts` (insert BEFORE `.get('/:id', ...)` to keep route matching unambiguous; keep the whole thing one chained expression for RPC types). Add imports: `addWorkoutExerciseSchema, setInputSchema` from `@bodyatlas/shared`, and add `or` plus `isNull` to the existing `drizzle-orm` import (used by the exercise-visibility check below):

```ts
  // --- nested: workout exercises ---
  .post(
    '/:id/exercises',
    zValidator('json', addWorkoutExerciseSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const userId = c.get('userId');
      const workout = await db.query.workouts.findFirst({
        where: and(eq(schema.workouts.id, c.req.param('id')), eq(schema.workouts.userId, userId)),
      });
      if (!workout) return c.json(notFound, 404);
      const { exerciseId } = c.req.valid('json');
      const exercise = await db.query.exercises.findFirst({
        where: and(
          eq(schema.exercises.id, exerciseId),
          or(isNull(schema.exercises.userId), eq(schema.exercises.userId, userId)),
        ),
      });
      if (!exercise) return c.json(validationError([{ message: 'Unknown exerciseId' }]), 422);
      const existing = await db
        .select({ position: schema.workoutExercises.position })
        .from(schema.workoutExercises)
        .where(eq(schema.workoutExercises.workoutId, workout.id))
        .orderBy(desc(schema.workoutExercises.position))
        .limit(1);
      const we = {
        id: crypto.randomUUID(),
        workoutId: workout.id,
        exerciseId,
        position: (existing[0]?.position ?? 0) + 1,
      };
      await db.insert(schema.workoutExercises).values(we);
      return c.json({ ...we, exercise }, 201);
    },
  )
  .delete('/:id/exercises/:weId', async (c) => {
    const db = getDb(c.env.DB);
    const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
    if (!we) return c.json(notFound, 404);
    await db.delete(schema.workoutExercises).where(eq(schema.workoutExercises.id, we.id)); // cascades to sets
    return c.json({ ok: true });
  })
  // --- nested: sets ---
  .post(
    '/:id/exercises/:weId/sets',
    zValidator('json', setInputSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
      if (!we) return c.json(notFound, 404);
      const input = c.req.valid('json');
      const last = await db
        .select({ position: schema.sets.position })
        .from(schema.sets)
        .where(eq(schema.sets.workoutExerciseId, we.id))
        .orderBy(desc(schema.sets.position))
        .limit(1);
      const set = {
        id: crypto.randomUUID(),
        workoutExerciseId: we.id,
        position: (last[0]?.position ?? 0) + 1,
        weightKg: input.weightKg ?? null,
        reps: input.reps ?? null,
        rpe: input.rpe ?? null,
        durationSec: input.durationSec ?? null,
        distanceM: input.distanceM ?? null,
      };
      await db.insert(schema.sets).values(set);
      return c.json(set, 201);
    },
  )
  .patch(
    '/:id/exercises/:weId/sets/:setId',
    zValidator('json', setInputSchema, (result, c) => {
      if (!result.success) return c.json(validationError(result.error.issues), 422);
    }),
    async (c) => {
      const db = getDb(c.env.DB);
      const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
      if (!we) return c.json(notFound, 404);
      const setId = c.req.param('setId');
      const existing = await db.query.sets.findFirst({
        where: and(eq(schema.sets.id, setId), eq(schema.sets.workoutExerciseId, we.id)),
      });
      if (!existing) return c.json(notFound, 404);
      const input = c.req.valid('json');
      await db
        .update(schema.sets)
        .set({
          weightKg: input.weightKg ?? null,
          reps: input.reps ?? null,
          rpe: input.rpe ?? null,
          durationSec: input.durationSec ?? null,
          distanceM: input.distanceM ?? null,
        })
        .where(eq(schema.sets.id, setId));
      const updated = await db.query.sets.findFirst({ where: eq(schema.sets.id, setId) });
      return c.json(updated);
    },
  )
  .delete('/:id/exercises/:weId/sets/:setId', async (c) => {
    const db = getDb(c.env.DB);
    const we = await ownedWorkoutExercise(db, c.get('userId'), c.req.param('id'), c.req.param('weId'));
    if (!we) return c.json(notFound, 404);
    const setId = c.req.param('setId');
    const existing = await db.query.sets.findFirst({
      where: and(eq(schema.sets.id, setId), eq(schema.sets.workoutExerciseId, we.id)),
    });
    if (!existing) return c.json(notFound, 404);
    await db.delete(schema.sets).where(eq(schema.sets.id, setId));
    return c.json({ ok: true });
  })
```

And the shared ownership helper (place above the route chain):

```ts
/** Loads a workout_exercise only if its workout belongs to the user. */
async function ownedWorkoutExercise(db: Db, userId: string, workoutId: string, weId: string) {
  const [row] = await db
    .select({ id: schema.workoutExercises.id })
    .from(schema.workoutExercises)
    .innerJoin(schema.workouts, eq(schema.workoutExercises.workoutId, schema.workouts.id))
    .where(
      and(
        eq(schema.workoutExercises.id, weId),
        eq(schema.workoutExercises.workoutId, workoutId),
        eq(schema.workouts.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}
```

PATCH semantics note: set updates are FULL-VALUE updates (the whole set payload is re-sent; unspecified numeric fields become null). This matches the UI (the edit form always holds the full row) and keeps the schema single-purpose.

- [ ] **Step 4: Run tests** — all pass; typecheck clean. Also confirm the RPC guard still compiles (`npm run typecheck -w app`).

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "feat: add nested workout exercise and set routes"
```

---

### Task 8: Deploy — remote migrations + production push

- [ ] **Step 1: Full local gate**

Run from root: `npm run typecheck && npm test && npm run build`
Expected: everything green (expect ~45+ worker tests total).

- [ ] **Step 2: Apply migrations to production D1**

```bash
npx wrangler d1 migrations apply bodyatlas --remote --config worker/wrangler.jsonc
```

Expected: `0001_workout_tables.sql` and `0002_seed_exercises.sql` applied.

- [ ] **Step 3: Deploy**

```bash
npm run deploy
```

- [ ] **Step 4: Smoke test** (API only — UI comes in Plan 2b). With a browser session at https://bodyatlas.okdtsk.dev signed in, open the dev tools console and run:

```js
await (await fetch('/api/exercises?q=bench')).json()
```

Expected: array containing the seeded bench press entries.

- [ ] **Step 5: Commit any straggling changes and update CLAUDE.md status line** (Plan 2a shipped; 2b pending), commit as `docs: update status for workout API`.

---

## Plan self-review (done at authoring time)

- **Spec coverage (workout API scope):** exercises (seed+custom, search EN/JA, archive) ✓, templates (CRUD, ordered exercises, target sets) ✓, workouts (sessions, single-active, template/copy creation, finish, list filters by date range and exercise) ✓, sets (weight/reps/RPE + cardio fields, validation) ✓, repeat-last support (copyFromWorkoutId + last-sets ghosts) ✓, user scoping everywhere (tested) ✓. UI deliberately in Plan 2b; trends in Plan 4.
- **Known risk spots:** `db.batch` tuple typing (fallback noted in Task 5), `drizzle-kit generate --custom` flag (fallback noted in Task 2), relations query API shapes. All have inline fallbacks.
- **Type consistency:** `loadWorkoutDetail`/`ownedWorkoutExercise` helpers defined where used; `Db` type exported by foundation's `worker/src/db/index.ts`; route order `/active` before `/:id` flagged.
