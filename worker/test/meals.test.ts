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

describe('/api/meals', () => {
  it('creates a meal with defaults and lists it within a day range', async () => {
    const headers = await authed();
    const created = (await (
      await SELF.fetch(
        'https://example.com/api/meals',
        json(headers, { name: 'チキンサラダ', calories: 480, proteinG: 42, eatenAt: '2026-06-12T12:10:00.000Z' }),
      )
    ).json()) as { id: string; isFavorite: boolean };
    expect(created.isFavorite).toBe(false);

    const list = (await (
      await SELF.fetch(
        'https://example.com/api/meals?from=2026-06-12T00:00:00.000Z&to=2026-06-13T00:00:00.000Z',
        { headers },
      )
    ).json()) as Array<{ name: string }>;
    expect(list).toHaveLength(1);

    const outside = (await (
      await SELF.fetch(
        'https://example.com/api/meals?from=2026-06-13T00:00:00.000Z&to=2026-06-14T00:00:00.000Z',
        { headers },
      )
    ).json()) as unknown[];
    expect(outside).toHaveLength(0);
  });

  it('search dedupes by name with latest nutrition and pins favorites', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン', calories: 120, eatenAt: '2026-06-01T08:00:00.000Z' }));
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン', calories: 130, eatenAt: '2026-06-10T08:00:00.000Z' }));
    const oat = (await (
      await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'オートミール', calories: 350, eatenAt: '2026-06-11T08:00:00.000Z' }))
    ).json()) as { id: string };
    await SELF.fetch(`https://example.com/api/meals/${oat.id}/favorite`, json(headers, { isFavorite: true }, 'PATCH'));

    const results = (await (
      await SELF.fetch('https://example.com/api/meals/search?q=', { headers })
    ).json()) as Array<{ name: string; calories: number | null; isFavorite: boolean }>;
    expect(results).toHaveLength(2); // deduped プロテイン + オートミール
    expect(results[0]?.name).toBe('オートミール'); // favorite pinned first
    expect(results.find((r) => r.name === 'プロテイン')?.calories).toBe(130); // latest wins
  });

  it('search filters by query matching the name', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン' }));
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'オートミール' }));
    const results = (await (
      await SELF.fetch('https://example.com/api/meals/search?q=プロテ', { headers })
    ).json()) as Array<{ name: string }>;
    expect(results.map((r) => r.name)).toEqual(['プロテイン']);
  });

  it('treats LIKE metacharacters in the query as literals', async () => {
    const headers = await authed();
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: '100%ジュース' }));
    await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'プロテイン' }));

    const exact = (await (
      await SELF.fetch(`https://example.com/api/meals/search?q=${encodeURIComponent('100%')}`, { headers })
    ).json()) as Array<{ name: string }>;
    expect(exact.map((r) => r.name)).toEqual(['100%ジュース']);

    // '%' alone must match only names containing a literal '%', not act as match-all.
    const literalPercent = (await (
      await SELF.fetch(`https://example.com/api/meals/search?q=${encodeURIComponent('%')}`, { headers })
    ).json()) as Array<{ name: string }>;
    expect(literalPercent.map((r) => r.name)).toEqual(['100%ジュース']);
  });

  it('updates and deletes a meal, scoped to the owner', async () => {
    const headers = await authed();
    await seedUser('user-2');
    const theirs = (await (
      await SELF.fetch('https://example.com/api/meals', json({ Cookie: await sessionCookieFor('user-2') }, { name: 'Their meal' }))
    ).json()) as { id: string };

    const mine = (await (
      await SELF.fetch('https://example.com/api/meals', json(headers, { name: 'Lunch', calories: 600 }))
    ).json()) as { id: string };

    const updated = (await (
      await SELF.fetch(`https://example.com/api/meals/${mine.id}`, json(headers, { name: 'Lunch', calories: 650 }, 'PUT'))
    ).json()) as { calories: number };
    expect(updated.calories).toBe(650);

    expect((await SELF.fetch(`https://example.com/api/meals/${theirs.id}`, json(headers, { name: 'x' }, 'PUT'))).status).toBe(404);
    expect((await SELF.fetch(`https://example.com/api/meals/${mine.id}`, { headers, method: 'DELETE' })).status).toBe(200);
  });

  it('rejects an invalid meal with 422', async () => {
    const headers = await authed();
    const res = await SELF.fetch('https://example.com/api/meals', json(headers, { name: '', calories: -1 }));
    expect(res.status).toBe(422);
  });
});
