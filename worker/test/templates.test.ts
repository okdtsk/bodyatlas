import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedTemplate, seedUser, sessionCookieFor } from './helpers';

async function authed(userId = 'user-1') {
  await seedUser(userId);
  return { Cookie: await sessionCookieFor(userId) };
}

const json = (headers: Record<string, string>, body: unknown, method = 'POST') => ({
  method,
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('/api/templates', () => {
  it('creates a template with ordered exercises and lists it', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/templates',
      json(headers, {
        name: 'Push Day A',
        exercises: [
          { exerciseId: 'seed-barbell-bench-press', targetSets: 3 },
          { exerciseId: 'seed-overhead-press', targetSets: 3 },
        ],
      }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as {
      id: string;
      name: string;
      templateExercises: Array<{ position: number; exercise: { id: string } }>;
    };
    expect(created.templateExercises.map((te) => te.exercise.id)).toEqual([
      'seed-barbell-bench-press',
      'seed-overhead-press',
    ]);

    const list = await SELF.fetch('https://example.com/api/templates', { headers });
    expect(((await list.json()) as unknown[]).length).toBe(1);
  });

  it('rejects a template referencing a nonexistent exercise', async () => {
    const headers = await authed();
    const res = await SELF.fetch(
      'https://example.com/api/templates',
      json(headers, { name: 'Bad', exercises: [{ exerciseId: 'nope' }] }),
    );
    expect(res.status).toBe(422);
  });

  it('replaces the exercise list on PUT', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Pull Day', ['seed-deadlift', 'seed-pull-up']);
    const res = await SELF.fetch(
      'https://example.com/api/templates/t1',
      json(headers, { name: 'Pull Day B', exercises: [{ exerciseId: 'seed-barbell-row' }] }, 'PUT'),
    );
    expect(res.status).toBe(200);
    const updated = (await res.json()) as {
      name: string;
      templateExercises: Array<{ exercise: { id: string } }>;
    };
    expect(updated.name).toBe('Pull Day B');
    expect(updated.templateExercises.map((te) => te.exercise.id)).toEqual(['seed-barbell-row']);
  });

  it('scopes templates to the owner', async () => {
    const headers = await authed();
    await seedUser('user-2');
    await seedTemplate('t2', 'user-2', 'Theirs', ['seed-deadlift']);
    const res = await SELF.fetch('https://example.com/api/templates/t2', { headers });
    expect(res.status).toBe(404);
  });

  it('deletes a template', async () => {
    const headers = await authed();
    await seedTemplate('t1', 'user-1', 'Push', ['seed-barbell-bench-press']);
    const res = await SELF.fetch('https://example.com/api/templates/t1', { ...{ headers }, method: 'DELETE' });
    expect(res.status).toBe(200);
    const gone = await SELF.fetch('https://example.com/api/templates/t1', { headers });
    expect(gone.status).toBe(404);
  });
});
