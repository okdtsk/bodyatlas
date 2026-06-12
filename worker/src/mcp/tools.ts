import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

export function registerTools(
  server: McpServer,
  _db: D1Database,
  getUserId: () => string,
): void {
  server.registerTool(
    'ping',
    {
      description: 'Health check — returns ok and the authenticated userId.',
      inputSchema: {},
    },
    async () => {
      const userId = getUserId();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, userId }) }],
      };
    },
  );
}
