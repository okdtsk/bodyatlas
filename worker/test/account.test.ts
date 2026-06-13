import { eq } from 'drizzle-orm';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedCustomExercise, seedTemplate, seedUser, seedWorkout, sessionCookieFor } from './helpers';
import { env } from 'cloudflare:test';
import { getDb, schema } from '../src/db';

describe('GET /api/account/export', () => {
  it('returns 401 without a session', async () => {
    const res = await SELF.fetch('https://example.com/api/account/export');
    expect(res.status).toBe(401);
  });

  it("exports the user's data as a JSON attachment, excluding secrets", async () => {
    await seedUser('u1', { targetKcal: 2000 });
    await seedCustomExercise('ex1', 'u1');
    await seedWorkout('w1', 'u1', 'ex1', [{ reps: 5, weightKg: 100 }]);
    await seedTemplate('t1', 'u1', 'Push', ['ex1']);
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm1', userId: 'u1', name: 'Eggs' });
    await db.insert(schema.apiTokens).values({ id: 'tok1', userId: 'u1', name: 'cli', tokenHash: 'SECRET_HASH' });
    await db.insert(schema.aiSettings).values({
      userId: 'u1', provider: 'claude', model: 'claude-opus-4-8', encryptedKey: 'SECRET_KEY', keyIv: 'SECRET_IV',
    });

    const res = await SELF.fetch('https://example.com/api/account/export', {
      headers: { Cookie: await sessionCookieFor('u1') },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Content-Disposition')).toContain('attachment');

    const data = (await res.json()) as Record<string, any>;
    expect(data.user.email).toBe('u1@example.com');
    expect(data.user).not.toHaveProperty('googleSub');
    expect(data.workouts).toHaveLength(1);
    expect(data.workouts[0].workoutExercises[0].sets[0].reps).toBe(5);
    expect(data.templates[0].name).toBe('Push');
    expect(data.meals[0].name).toBe('Eggs');
    expect(data.exercises).toHaveLength(1);

    const blob = JSON.stringify(data);
    expect(blob).not.toContain('SECRET_HASH');
    expect(blob).not.toContain('SECRET_KEY');
    expect(blob).not.toContain('SECRET_IV');
    expect(data.apiTokens[0]).toMatchObject({ name: 'cli' });
    expect(data.apiTokens[0]).not.toHaveProperty('tokenHash');
    expect(data.aiSettings).toMatchObject({ provider: 'claude', model: 'claude-opus-4-8' });
  });

  it('never exports another user’s rows', async () => {
    await seedUser('u1');
    await seedUser('u2');
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm2', userId: 'u2', name: 'Other' });
    const res = await SELF.fetch('https://example.com/api/account/export', {
      headers: { Cookie: await sessionCookieFor('u1') },
    });
    const data = (await res.json()) as Record<string, any>;
    expect(data.meals).toHaveLength(0);
  });
});

describe('DELETE /api/account', () => {
  it('returns 401 without a session', async () => {
    const res = await SELF.fetch('https://example.com/api/account', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('deletes all the user’s rows and revokes the session', async () => {
    await seedUser('u1');
    await seedCustomExercise('ex1', 'u1');
    await seedWorkout('w1', 'u1', 'ex1', [{ reps: 5 }]);
    await seedTemplate('t1', 'u1', 'Push', ['ex1']);
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm1', userId: 'u1', name: 'Eggs' });
    await db.insert(schema.sleepRecords).values({
      id: 's1', userId: 'u1', bedAt: new Date('2026-06-01T23:00:00Z'), wokeAt: new Date('2026-06-02T07:00:00Z'),
    });
    await db.insert(schema.bodyMeasurements).values({ id: 'bm1', userId: 'u1', weightKg: 70 });
    await db.insert(schema.apiTokens).values({ id: 'tok1', userId: 'u1', name: 'cli', tokenHash: 'h' });
    await db.insert(schema.aiSettings).values({ userId: 'u1', provider: 'claude', model: 'm', encryptedKey: 'k', keyIv: 'iv' });

    const cookie = await sessionCookieFor('u1');
    const res = await SELF.fetch('https://example.com/api/account', { method: 'DELETE', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);

    expect(await db.select().from(schema.users).where(eq(schema.users.id, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.workouts).where(eq(schema.workouts.userId, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.sets)).toHaveLength(0);
    expect(await db.select().from(schema.workoutExercises)).toHaveLength(0);
    expect(await db.select().from(schema.templates).where(eq(schema.templates.userId, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.meals).where(eq(schema.meals.userId, 'u1'))).toHaveLength(0);
    expect(await db.select().from(schema.exercises).where(eq(schema.exercises.userId, 'u1'))).toHaveLength(0);

    const after = await SELF.fetch('https://example.com/api/me', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
  });

  it('does not delete another user’s data', async () => {
    await seedUser('u1');
    await seedUser('u2');
    const db = getDb(env.DB);
    await db.insert(schema.meals).values({ id: 'm2', userId: 'u2', name: 'Keep' });
    await SELF.fetch('https://example.com/api/account', { method: 'DELETE', headers: { Cookie: await sessionCookieFor('u1') } });
    expect(await db.select().from(schema.meals).where(eq(schema.meals.userId, 'u2'))).toHaveLength(1);
  });
});
