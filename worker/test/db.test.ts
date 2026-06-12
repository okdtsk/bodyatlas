import { env } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getDb, schema } from '../src/db';

describe('users table', () => {
  it('inserts and reads back a user with defaults', async () => {
    const db = getDb(env.DB);
    await db.insert(schema.users).values({
      id: 'user-1',
      googleSub: 'google-sub-1',
      email: 'a@example.com',
      name: 'Alice',
    });

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, 'user-1'),
    });

    expect(user).toMatchObject({
      email: 'a@example.com',
      locale: 'en',
      theme: 'gym-dark',
      unit: 'kg',
      timezone: 'Asia/Tokyo',
      targetKcal: null,
    });
  });
});
