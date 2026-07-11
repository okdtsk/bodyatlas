import { BodyAtlasMCP } from './server';
import type { Bindings } from '../types';

const base = BodyAtlasMCP.serve('/mcp', { binding: 'BODYATLAS_MCP' });

/**
 * apiHandler for the OAuth provider. The provider validates the access token and
 * sets `ctx.props` (our McpProps) BEFORE calling this handler, so we can rate-limit
 * per user. CORS preflights carry no token and mutate nothing — pass them straight
 * through so browser-based connectors work.
 */
export const mcpHandler = {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'OPTIONS') {
      const limiter = env.RL_MCP;
      if (limiter) {
        const props = (ctx as ExecutionContext & { props?: { userId?: string } }).props;
        const key = props?.userId ?? request.headers.get('Authorization') ?? 'anon';
        const { success } = await limiter.limit({ key });
        if (!success) {
          return Response.json(
            { error: { code: 'rate_limited', message: 'Too many requests.' } },
            { status: 429, headers: { 'Retry-After': '60' } },
          );
        }
      }
    }
    return base.fetch(request, env as unknown as Cloudflare.Env, ctx);
  },
};
