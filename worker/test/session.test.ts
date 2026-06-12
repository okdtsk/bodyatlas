import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import {
  createSession,
  deleteSession,
  getSessionUserId,
} from '../src/auth/session';

describe('session store', () => {
  it('round-trips a session', async () => {
    const token = await createSession(env.SESSIONS, 'user-1');
    expect(token).toBeTruthy();
    expect(await getSessionUserId(env.SESSIONS, token)).toBe('user-1');
  });

  it('returns null for unknown tokens', async () => {
    expect(await getSessionUserId(env.SESSIONS, 'nope')).toBeNull();
  });

  it('deletes sessions', async () => {
    const token = await createSession(env.SESSIONS, 'user-1');
    await deleteSession(env.SESSIONS, token);
    expect(await getSessionUserId(env.SESSIONS, token)).toBeNull();
  });
});
