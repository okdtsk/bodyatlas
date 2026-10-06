import { BodyAtlasMCP } from './server';
import type { Bindings } from '../types';
import { isAllowedUser } from '../auth/private-access';

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
      const props = (ctx as ExecutionContext & { props?: { userId?: string } }).props;
      if (!props?.userId || !await isAllowedUser(env, props.userId)) {
        return Response.json({ error: { code: 'forbidden', message: 'Account is not permitted' } }, { status: 403 });
      }
      const limiter = env.RL_MCP;
      if (limiter) {
        const key = props.userId!;
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
