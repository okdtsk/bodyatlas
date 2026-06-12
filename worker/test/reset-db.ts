import { env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// Child tables first so FK constraints never block deletes.
const USER_TABLES = [
  'sets',
  'workout_exercises',
  'workouts',
  'template_exercises',
  'templates',
  'meals',
  'sleep_records',
  'body_measurements',
];

beforeEach(async () => {
  for (const table of USER_TABLES) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
  // Keep the seed catalog (user_id IS NULL); remove only user-created exercises.
  await env.DB.exec(`DELETE FROM exercises WHERE user_id IS NOT NULL`);
  await env.DB.exec(`DELETE FROM users`);
});
