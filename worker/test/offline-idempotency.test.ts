import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('offline idempotency by clientId', () => {
  it('meals: same clientId returns the existing row (201 then 200) and lists once', async () => {
    const headers = await authed();
    const clientId = '22222222-2222-2222-2222-222222222222';
    const body = { name: 'Oats', clientId };

    const first = await SELF.fetch('https://example.com/api/meals', json(headers, body));
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };

    const second = await SELF.fetch('https://example.com/api/meals', json(headers, body));
    expect(second.status).toBe(200);
    const dup = (await second.json()) as { id: string };
    expect(dup.id).toBe(created.id);

    const list = (await (
      await SELF.fetch('https://example.com/api/meals/search?q=Oats', { headers })
    ).json()) as Array<{ name: string }>;
    expect(list.filter((r) => r.name === 'Oats')).toHaveLength(1);
  });

  it('measurements: same clientId returns the existing row (201 then 200)', async () => {
    const headers = await authed();
    const clientId = '33333333-3333-3333-3333-333333333333';
    const body = { weightKg: 70, clientId };

    const first = await SELF.fetch('https://example.com/api/measurements', json(headers, body));
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };

    const second = await SELF.fetch('https://example.com/api/measurements', json(headers, body));
    expect(second.status).toBe(200);
    const dup = (await second.json()) as { id: string };
    expect(dup.id).toBe(created.id);
  });

  it('sleep: same clientId returns the existing row (201 then 200)', async () => {
    const headers = await authed();
    const clientId = '44444444-4444-4444-4444-444444444444';
    const body = {
      bedAt: '2026-06-12T23:00:00.000Z',
      wokeAt: '2026-06-13T07:00:00.000Z',
      clientId,
    };

    const first = await SELF.fetch('https://example.com/api/sleep', json(headers, body));
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };

    const second = await SELF.fetch('https://example.com/api/sleep', json(headers, body));
    expect(second.status).toBe(200);
    const dup = (await second.json()) as { id: string };
    expect(dup.id).toBe(created.id);
  });

  it('sets: same clientId returns the existing row (201 then 200)', async () => {
    const headers = await authed();
    const clientId = '55555555-5555-5555-5555-555555555555';

    const workout = (await (
      await SELF.fetch('https://example.com/api/workouts', json(headers, {}))
    ).json()) as { id: string };
    const we = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${workout.id}/exercises`,
        json(headers, { exerciseId: 'seed-barbell-bench-press' }),
      )
    ).json()) as { id: string };

    const body = { reps: 5, clientId };
    const first = await SELF.fetch(
      `https://example.com/api/workouts/${workout.id}/exercises/${we.id}/sets`,
      json(headers, body),
    );
    expect(first.status).toBe(201);
    const created = (await first.json()) as { id: string };

    const second = await SELF.fetch(
      `https://example.com/api/workouts/${workout.id}/exercises/${we.id}/sets`,
      json(headers, body),
    );
    expect(second.status).toBe(200);
    const dup = (await second.json()) as { id: string };
    expect(dup.id).toBe(created.id);
  });

  it('sets: same clientId across DIFFERENT workout-exercises does NOT dedup (composite scope)', async () => {
    const headers = await authed();
    const clientId = '66666666-6666-6666-6666-666666666666';

    const workout = (await (
      await SELF.fetch('https://example.com/api/workouts', json(headers, {}))
    ).json()) as { id: string };
    const we1 = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${workout.id}/exercises`,
        json(headers, { exerciseId: 'seed-barbell-bench-press' }),
      )
    ).json()) as { id: string };
    const we2 = (await (
      await SELF.fetch(
        `https://example.com/api/workouts/${workout.id}/exercises`,
        json(headers, { exerciseId: 'seed-overhead-press' }),
      )
    ).json()) as { id: string };

    const body = { reps: 5, clientId };
    const r1 = await SELF.fetch(
      `https://example.com/api/workouts/${workout.id}/exercises/${we1.id}/sets`,
      json(headers, body),
    );
    expect(r1.status).toBe(201);
    const s1 = (await r1.json()) as { id: string };

    const r2 = await SELF.fetch(
      `https://example.com/api/workouts/${workout.id}/exercises/${we2.id}/sets`,
      json(headers, body),
    );
    expect(r2.status).toBe(201);
    const s2 = (await r2.json()) as { id: string };

    expect(s2.id).not.toBe(s1.id);
  });
});
