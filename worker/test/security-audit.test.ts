import { env, SELF } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';
import { purgeSecurityAudit } from '../src/lib/security-audit';

it('records reads without copying query strings, cookies, or response data', async () => {
  await env.DB.exec('CREATE TABLE IF NOT EXISTS security_audit_events (id TEXT PRIMARY KEY, occurred_at INTEGER NOT NULL, actor_id TEXT, action TEXT NOT NULL, category TEXT NOT NULL, operation TEXT, status INTEGER NOT NULL)');
  await env.DB.exec('DELETE FROM security_audit_events');
  await seedUser('audit-owner');
  const cookie = await sessionCookieFor('audit-owner');
  const res = await SELF.fetch('https://example.com/api/me?api_key=never-log-this', { headers: { Cookie: cookie } });
  expect(res.status).toBe(200);
  const rows = await env.DB.prepare('SELECT * FROM security_audit_events').all();
  expect(rows.results).toHaveLength(1);
  expect(rows.results[0]).toMatchObject({ actor_id: 'audit-owner', action: 'read', category: 'me', status: 200 });
  expect(JSON.stringify(rows.results)).not.toContain('never-log-this');
  expect(JSON.stringify(rows.results)).not.toContain(cookie);
});

it('expires only audit records older than 365 days', async () => {
  await env.DB.exec('DELETE FROM security_audit_events');
  const now = Date.UTC(2026, 9, 6);
  const old = now - 366 * 86400000;
  const recent = now - 364 * 86400000;
  await env.DB.prepare("INSERT INTO security_audit_events (id, occurred_at, actor_id, action, category, status) VALUES ('old', ?, NULL, 'read', 'me', 401), ('recent', ?, NULL, 'read', 'me', 401)").bind(old, recent).run();
  await purgeSecurityAudit(env.DB, now);
  const rows = await env.DB.prepare('SELECT id FROM security_audit_events').all();
  expect(rows.results).toEqual([{ id: 'recent' }]);
});
