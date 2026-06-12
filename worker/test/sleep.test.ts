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

describe('/api/sleep', () => {
  it('creates, lists by woke-day range, updates, deletes', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch(
        'https://example.com/api/sleep',
        json(headers, { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:00:00.000Z', quality: 4 }),
      )
    ).json()) as { id: string };

    const inDay = (await (
      await SELF.fetch(
        'https://example.com/api/sleep?from=2026-06-11T15:00:00.000Z&to=2026-06-12T15:00:00.000Z',
        { headers },
      )
    ).json()) as unknown[];
    expect(inDay).toHaveLength(1); // woke_at inside range (bed_at outside is fine)

    const updated = (await (
      await SELF.fetch(
        `https://example.com/api/sleep/${created.id}`,
        json(headers, { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:30:00.000Z', quality: 5 }, 'PUT'),
      )
    ).json()) as { quality: number };
    expect(updated.quality).toBe(5);

    expect((await SELF.fetch(`https://example.com/api/sleep/${created.id}`, { headers, method: 'DELETE' })).status).toBe(200);
  });

  it('rejects wokeAt before bedAt with 422 and scopes to owner', async () => {
    const headers = await authed();
    const bad = await SELF.fetch(
      'https://example.com/api/sleep',
      json(headers, { bedAt: '2026-06-11T22:00:00.000Z', wokeAt: '2026-06-11T14:00:00.000Z' }),
    );
    expect(bad.status).toBe(422);

    await seedUser('user-2');
    const theirs = (await (
      await SELF.fetch(
        'https://example.com/api/sleep',
        json({ Cookie: await sessionCookieFor('user-2') }, { bedAt: '2026-06-11T14:40:00.000Z', wokeAt: '2026-06-11T22:00:00.000Z' }),
      )
    ).json()) as { id: string };
    expect((await SELF.fetch(`https://example.com/api/sleep/${theirs.id}`, { headers, method: 'DELETE' })).status).toBe(404);
  });
});
