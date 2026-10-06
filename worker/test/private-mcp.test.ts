import { env } from 'cloudflare:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vitest';
import { registerTools } from '../src/mcp/tools';
import type { Bindings } from '../src/types';
import { seedUser } from './helpers';

it('audits a real MCP tool call and rejects the same connection after its user is disallowed', async () => {
  await seedUser('mcp-owner');
  await env.DB.exec('DELETE FROM security_audit_events');
  const bindings: Bindings = { ...env, ALLOWED_EMAILS: 'mcp-owner@example.com' };
  const server = new McpServer({ name: 'private-test', version: '1' });
  registerTools(server, env.DB, () => 'mcp-owner', bindings);
  const client = new Client({ name: 'private-test-client', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const allowed = await client.callTool({ name: 'get_today', arguments: {} });
    expect(allowed.isError).not.toBe(true);
    bindings.ALLOWED_EMAILS = 'different@example.com';
    const denied = await client.callTool({ name: 'get_today', arguments: {} });
    expect(denied.isError).toBe(true);
    expect(denied.content).toEqual([{ type: 'text', text: 'Account is not permitted' }]);
    const rows = await env.DB.prepare('SELECT actor_id, action, category, operation, status FROM security_audit_events ORDER BY occurred_at').all();
    expect(rows.results).toEqual([
      { actor_id: 'mcp-owner', action: 'mcp_tool', category: 'mcp', operation: 'get_today', status: 200 },
      { actor_id: 'mcp-owner', action: 'mcp_tool', category: 'mcp', operation: 'get_today', status: 403 },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
