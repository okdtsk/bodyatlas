-- Collapse the three mood themes into light/dark modes.
UPDATE `users` SET `theme` = 'dark'  WHERE `theme` = 'gym-dark';
UPDATE `users` SET `theme` = 'light' WHERE `theme` IN ('clinical-light', 'warm-journal');

-- The column default is deliberately NOT changed here. SQLite cannot ALTER a
-- default in place, and the table rebuild it would need is not expressible in a
-- D1 migration: `ALTER TABLE users RENAME` rewrites every REFERENCES clause
-- pointing at `users` (meals, sleep_records, body_measurements, workouts,
-- templates, exercises, ai_settings) while foreign keys are on, and they cannot
-- be turned off — Wrangler runs migrations inside a transaction, where
-- `PRAGMA foreign_keys=OFF` is a no-op and `PRAGMA defer_foreign_keys` only
-- moves the DROP TABLE violation to COMMIT.
--
-- `users.theme` therefore still carries DEFAULT 'gym-dark' at the SQL level.
-- Nothing reads it: Drizzle binds the column default from the schema as a
-- parameter whenever an insert omits the column, so every row created through
-- `db.insert(users)` — the only way rows are created — carries the 'dark' from
-- `worker/src/db/schema.ts`. The SQL default is dead weight, not a fallback.
