import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  locale: text('locale').notNull().default('en'),
  theme: text('theme').notNull().default('gym-dark'),
  unit: text('unit').notNull().default('kg'),
  timezone: text('timezone').notNull().default('Asia/Tokyo'),
  targetKcal: integer('target_kcal'),
  targetProteinG: integer('target_protein_g'),
  targetFatG: integer('target_fat_g'),
  targetCarbsG: integer('target_carbs_g'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});
