import { sql, type SQL } from 'drizzle-orm';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

/** LIKE with %q% where user-supplied q has %, _ and \ escaped. */
export function likeContains(column: AnySQLiteColumn, q: string): SQL {
  const escaped = q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return sql`${column} LIKE ${`%${escaped}%`} ESCAPE '\\'`;
}
