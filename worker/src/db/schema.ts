import { relations } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Equipment, ExerciseType, Locale, MuscleGroup, Theme, Unit } from '@bodyatlas/shared';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  locale: text('locale').$type<Locale>().notNull().default('en'),
  theme: text('theme').$type<Theme>().notNull().default('gym-dark'),
  unit: text('unit').$type<Unit>().notNull().default('kg'),
  timezone: text('timezone').notNull().default('Asia/Tokyo'),
  targetKcal: integer('target_kcal'),
  targetProteinG: integer('target_protein_g'),
  targetFatG: integer('target_fat_g'),
  targetCarbsG: integer('target_carbs_g'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

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
    targetSets: integer('target_sets'),
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
    note: text('note'),
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
