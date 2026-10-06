import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { AppEnv } from '../types';
import { getSessionUserId } from './session';
import { isAllowedUser } from './private-access';

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
  if (!await isAllowedUser(c.env, userId)) {
    return c.json({ error: { code: 'forbidden', message: 'Account is not permitted' } }, 403);
  }
  await next();
});
