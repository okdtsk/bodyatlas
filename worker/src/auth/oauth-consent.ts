import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { eq } from 'drizzle-orm';
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import { getDb, schema } from '../db';
import { SESSION_COOKIE } from './middleware';
import { getSessionUserId } from './session';
import type { AppEnv } from '../types';

const CONSENT_TTL_SECONDS = 600;

const b64urlEncode = (s: string) =>
  btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const b64urlDecode = (s: string) =>
  atob(s.replaceAll('-', '+').replaceAll('_', '/'));

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

function consentHtml(opts: {
  clientName: string;
  reqB64: string;
  csrf: string;
  locale: string;
}): string {
  const ja = opts.locale === 'ja';
  const title = ja ? 'アクセスを許可' : 'Authorize access';
  const body = ja
    ? `<strong>${escapeHtml(opts.clientName)}</strong> が bodyatlas のデータ（食事・ワークアウト・体重・睡眠の記録と参照）へのアクセスを求めています。`
    : `<strong>${escapeHtml(opts.clientName)}</strong> wants to access your bodyatlas data: log meals, workouts, weight, and sleep, and read your recent workouts and trends.`;
  const approve = ja ? '許可する' : 'Approve';
  const deny = ja ? '拒否' : 'Deny';
  return `<!doctype html><html lang="${ja ? 'ja' : 'en'}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · bodyatlas</title>
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#e7e9ee;
    display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px}
  .card{max-width:420px;width:100%;background:#171a21;border:1px solid #262b36;
    border-radius:14px;padding:28px}
  h1{font-size:1.15rem;margin:0 0 16px} p{line-height:1.55;color:#c4c8d2}
  .row{display:flex;gap:12px;margin-top:24px}
  button{flex:1;padding:12px;border-radius:10px;border:1px solid #2c3340;font-size:1rem;cursor:pointer}
  .approve{background:#3b82f6;border-color:#3b82f6;color:#fff} .deny{background:transparent;color:#e7e9ee}
</style></head><body><div class="card">
<h1>${title}</h1><p>${body}</p>
<form method="post" action="/authorize">
  <input type="hidden" name="req" value="${opts.reqB64}">
  <input type="hidden" name="csrf" value="${escapeHtml(opts.csrf)}">
  <div class="row">
    <button class="deny" name="decision" value="deny" type="submit">${deny}</button>
    <button class="approve" name="decision" value="approve" type="submit">${approve}</button>
  </div>
</form></div></body></html>`;
}

export const oauthConsentRoutes = new Hono<AppEnv>()
  .get('/authorize', async (c) => {
    const oauthReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);

    const token = getCookie(c, SESSION_COOKIE);
    const userId = token ? await getSessionUserId(c.env.SESSIONS, token) : null;
    if (!userId) {
      const returnTo = '/authorize' + new URL(c.req.url).search;
      return c.redirect(`/auth/google?return_to=${encodeURIComponent(returnTo)}`);
    }

    const client = await c.env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
    const clientName = client?.clientName ?? oauthReq.clientId;

    const csrf = crypto.randomUUID();
    await c.env.SESSIONS.put(`consent:${csrf}`, userId, {
      expirationTtl: CONSENT_TTL_SECONDS,
    });

    const user = await getDb(c.env.DB).query.users.findFirst({
      where: eq(schema.users.id, userId),
    });
    const reqB64 = b64urlEncode(JSON.stringify(oauthReq));
    return c.html(
      consentHtml({ clientName, reqB64, csrf, locale: user?.locale ?? 'en' }),
    );
  })
  .post('/authorize', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    const userId = token ? await getSessionUserId(c.env.SESSIONS, token) : null;
    if (!userId) return c.text('Sign in required', 401);

    const form = await c.req.parseBody();
    const csrf = typeof form.csrf === 'string' ? form.csrf : '';
    const reqRaw = typeof form.req === 'string' ? form.req : '';
    const decision = typeof form.decision === 'string' ? form.decision : 'deny';

    // One-time CSRF token bound to this user.
    const csrfUser = csrf ? await c.env.SESSIONS.get(`consent:${csrf}`) : null;
    if (!csrfUser || csrfUser !== userId) return c.text('Invalid request', 403);
    await c.env.SESSIONS.delete(`consent:${csrf}`);

    let oauthReq: AuthRequest;
    try {
      oauthReq = JSON.parse(b64urlDecode(reqRaw)) as AuthRequest;
    } catch {
      return c.text('Invalid request', 400);
    }

    if (decision !== 'approve') {
      const url = new URL(oauthReq.redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (oauthReq.state) url.searchParams.set('state', oauthReq.state);
      return c.redirect(url.toString());
    }

    const scope = oauthReq.scope?.length ? oauthReq.scope : ['mcp'];
    const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId,
      scope,
      metadata: {},
      props: { userId },
    });
    return c.redirect(redirectTo);
  });
