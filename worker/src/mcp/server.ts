import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { Bindings } from '../types';
import { registerTools } from './tools';

export type McpProps = { userId: string };

// Env uses Cloudflare.Env (the global interface) as the type parameter so it
// satisfies the McpAgent constraint regardless of test-time augmentations
// (e.g. TEST_MIGRATIONS). We cast this.env to Bindings when we need typed
// access to our own bindings.
export class BodyAtlasMCP extends McpAgent<Cloudflare.Env, Record<string, never>, McpProps> {
  server = new McpServer({ name: 'bodyatlas', version: '1.0.0' });

  async init(): Promise<void> {
    const bindings = this.env as unknown as Bindings;
    registerTools(this.server, bindings.DB, () => this.props!.userId, bindings);
  }
}
