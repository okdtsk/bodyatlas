import { SELF, env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { generateToken, sha256Hex } from '../src/auth/tokens';
import { getDb, schema } from '../src/db';
import { seedUser } from './helpers';

describe('MCP bearer gate', () => {
  it('returns 401 JSON envelope with no Authorization header', async () => {
    const res = await SELF.fetch('http://localhost/mcp', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 with garbage bearer token', async () => {
    const res = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer garbage_not_real' },
    });
    expect(res.status).toBe(401);
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 with ba_-prefixed token not in DB', async () => {
    const fakeToken = generateToken();
    const res = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${fakeToken}` },
    });
    expect(res.status).toBe(401);
  });

  it('passes the gate (status !== 401) with a valid token', async () => {
    await seedUser('user-mcp-1');
    const db = getDb(env.DB);
    const token = generateToken();
    const hash = await sha256Hex(token);
    await db.insert(schema.apiTokens).values({
      id: 'tok-mcp-1',
      userId: 'user-mcp-1',
      name: 'mcp-test-token',
      tokenHash: hash,
    });

    const res = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '0' },
        },
      }),
    });

    // The gate passed — the MCP DO handles the request from here.
    // We only assert that auth succeeded (not 401).
    // The DO transport may return 400/404/200 depending on session state;
    // all are acceptable as long as the gate is not blocking.
    expect(res.status).not.toBe(401);
  });
});
