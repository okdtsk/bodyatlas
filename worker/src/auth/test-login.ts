import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { getDb, schema } from '../db';
import type { AppEnv } from '../types';
import { SESSION_COOKIE } from './middleware';
import { createSession, SESSION_TTL_SECONDS } from './session';

/** Dev/E2E-only sign-in. Mounted unconditionally but hard-gated by env var —
 *  E2E_TEST_LOGIN is set only in .dev.vars and the CI e2e job, never in production. */
export const testLoginRoutes = new Hono<AppEnv>().get('/test-login', async (c) => {
  if (c.env.E2E_TEST_LOGIN !== '1') {
    return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  }
  const db = getDb(c.env.DB);
  const existing = await db.query.users.findFirst({ where: eq(schema.users.googleSub, 'e2e-sub') });
  const userId = existing?.id ?? crypto.randomUUID();
  if (!existing) {
    await db.insert(schema.users).values({
      id: userId,
      googleSub: 'e2e-sub',
      email: 'e2e@example.com',
      name: 'E2E',
    });
  }
  const token = await createSession(c.env.SESSIONS, userId);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect('/');
});
