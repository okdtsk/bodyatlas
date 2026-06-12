import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { getSessionUserId } from './session';

export const SESSION_COOKIE = 'ba_session';

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const userId = token ? await getSessionUserId(c.env.SESSIONS, token) : null;
  if (!userId) {
    return c.json(
      { error: { code: 'unauthorized', message: 'Sign in required' } },
      401,
    );
  }
  c.set('userId', userId);
  await next();
});
