import { env } from 'cloudflare:test';
import { beforeEach } from 'vitest';

// Extend as tables are added in later plans; child tables first once FKs exist.
const TABLES = ['users'];

beforeEach(async () => {
  for (const table of TABLES) {
    await env.DB.exec(`DELETE FROM ${table}`);
  }
});
