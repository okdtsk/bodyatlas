import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../db';
import type { AppEnv } from '../types';
import { SESSION_COOKIE } from './middleware';
import { createSession, deleteSession, SESSION_TTL_SECONDS } from './session';

const OAUTH_COOKIE = 'ba_oauth';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64UrlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(input: string): string {
  return atob(input.replaceAll('-', '+').replaceAll('_', '/'));
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return new Uint8Array(digest);
}

function isHttps(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === 'https:';
}

/** Accepts only same-origin paths (e.g. "/authorize?..."), rejecting protocol-relative
 *  ("//evil"), backslash tricks ("/\\evil"), and absolute/off-origin URLs. Returns the
 *  normalized path+query+hash, or undefined if unsafe. */
function safeReturnTo(value: string | undefined, requestUrl: string): string | undefined {
  if (!value) return undefined;
  if (!value.startsWith('/') || value.startsWith('//')) return undefined;
  try {
    const base = new URL(requestUrl);
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return undefined;
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return undefined;
  }
}

const badRequest = (message: string) =>
  ({ error: { code: 'oauth_invalid', message } }) as const;

export const authRoutes = new Hono<AppEnv>()
  .get('/google', async (c) => {
    const state = crypto.randomUUID();
    const verifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64UrlEncode(await sha256(verifier));
    const redirectUri = new URL('/auth/google/callback', c.req.url).toString();
    // Native iOS shell flows (ASWebAuthenticationSession) are tagged so the
    // callback hands the session back via a one-time code instead of a cookie.
    const native = c.req.query('native') === '1';
    const returnTo = safeReturnTo(c.req.query('return_to'), c.req.url);

    setCookie(
      c,
      OAUTH_COOKIE,
      JSON.stringify({
        state,
        verifier,
        ...(native ? { native: true } : {}),
        ...(returnTo ? { returnTo } : {}),
      }),
      {
        httpOnly: true,
        secure: isHttps(c.req.url),
        sameSite: 'Lax',
        path: '/auth',
        maxAge: 600,
      },
    );

    const params = new URLSearchParams({
      client_id: c.env.GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  })
  .get('/google/callback', async (c) => {
    const raw = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: '/auth' });

    const code = c.req.query('code');
    const returnedState = c.req.query('state');
    if (!raw || !code || !returnedState) {
      return c.json(badRequest('Missing OAuth parameters'), 400);
    }

    let stored: { state: string; verifier: string; native?: boolean; returnTo?: string };
    try {
      stored = JSON.parse(raw) as { state: string; verifier: string; native?: boolean; returnTo?: string };
    } catch {
      return c.json(badRequest('Malformed OAuth cookie'), 400);
    }
    if (returnedState !== stored.state) {
      return c.json(badRequest('State mismatch'), 400);
    }

    const redirectUri = new URL('/auth/google/callback', c.req.url).toString();
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: c.env.GOOGLE_CLIENT_ID,
        client_secret: c.env.GOOGLE_CLIENT_SECRET,
        code,
        code_verifier: stored.verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) {
      return c.json(
        { error: { code: 'oauth_exchange_failed', message: 'Google sign-in failed' } },
        502,
      );
    }

    // The id_token arrives directly from Google's token endpoint over TLS,
    // so decoding without signature verification is safe here.
    const { id_token } = (await tokenRes.json()) as { id_token: string };
    const payload = id_token.split('.')[1];
    if (!payload) return c.json(badRequest('Malformed id_token'), 400);
    const claims = JSON.parse(base64UrlDecode(payload)) as {
      sub: string;
      email: string;
      name?: string;
    };

    const db = getDb(c.env.DB);
    const existing = await db.query.users.findFirst({
      where: eq(schema.users.googleSub, claims.sub),
    });
    const userId = existing?.id ?? crypto.randomUUID();
    const displayName = claims.name ?? claims.email;
    if (existing) {
      await db
        .update(schema.users)
        .set({ email: claims.email, name: displayName })
        .where(eq(schema.users.id, userId));
    } else {
      await db.insert(schema.users).values({
        id: userId,
        googleSub: claims.sub,
        email: claims.email,
        name: displayName,
      });
    }

    const token = await createSession(c.env.SESSIONS, userId);

    if (stored.native) {
      // Native shell: the OAuth dance ran in ASWebAuthenticationSession, whose
      // cookie jar is separate from the app's WKWebView. Hand the session back
      // via a short-lived one-time code; the WebView redeems it at
      // /auth/native/exchange to receive the session cookie in its own jar.
      const code = crypto.randomUUID();
      await c.env.SESSIONS.put(`native_auth:${code}`, token, { expirationTtl: 60 });
      return c.redirect(`com.okdtsk.bodyatlas://auth?code=${code}`);
    }

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c.req.url),
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    const dest = safeReturnTo(stored.returnTo, c.req.url) ?? '/';
    return c.redirect(new URL(dest, c.req.url).toString());
  })
  .post('/native/exchange', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(badRequest('Malformed JSON body'), 400);
    }
    const code = (body as { code?: unknown }).code;
    if (typeof code !== 'string' || code.length === 0) {
      return c.json(badRequest('Missing code'), 400);
    }

    const token = await c.env.SESSIONS.get(`native_auth:${code}`);
    if (!token) {
      // Unknown and expired codes are deliberately indistinguishable.
      return c.json(badRequest('Invalid code'), 400);
    }
    await c.env.SESSIONS.delete(`native_auth:${code}`);

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c.req.url),
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    });
    return c.json({ ok: true });
  })
  .post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(c.env.SESSIONS, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    const homeUrl = new URL('/', c.req.url).toString();
    return c.redirect(homeUrl);
  });
