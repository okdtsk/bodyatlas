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

describe('/api/measurements', () => {
  it('creates weight-only, lists by range, updates, deletes', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch(
        'https://example.com/api/measurements',
        json(headers, { weightKg: 72.4, measuredAt: '2026-06-12T00:00:00.000Z' }),
      )
    ).json()) as { id: string; bodyFatPct: number | null };
    expect(created.bodyFatPct).toBeNull();

    const list = (await (
      await SELF.fetch(
        'https://example.com/api/measurements?from=2026-06-11T15:00:00.000Z&to=2026-06-12T15:00:00.000Z',
        { headers },
      )
    ).json()) as unknown[];
    expect(list).toHaveLength(1);

    const updated = (await (
      await SELF.fetch(
        `https://example.com/api/measurements/${created.id}`,
        json(headers, { weightKg: 72.2, bodyFatPct: 18.5, measuredAt: '2026-06-12T00:00:00.000Z' }, 'PUT'),
      )
    ).json()) as { bodyFatPct: number };
    expect(updated.bodyFatPct).toBe(18.5);

    expect((await SELF.fetch(`https://example.com/api/measurements/${created.id}`, { headers, method: 'DELETE' })).status).toBe(200);
  });

  it('rejects an empty measurement with 422', async () => {
    const headers = await authed();
    expect((await SELF.fetch('https://example.com/api/measurements', json(headers, {}))).status).toBe(422);
  });
});
