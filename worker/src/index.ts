import { Hono } from 'hono';
import { authRoutes } from './auth/google';
import { testLoginRoutes } from './auth/test-login';
import { requireAuth } from './auth/middleware';
import { exercisesRoutes } from './routes/exercises';
import { measurementsRoutes } from './routes/measurements';
import { mealsRoutes } from './routes/meals';
import { meRoutes } from './routes/me';
import { sleepRoutes } from './routes/sleep';
import { templatesRoutes } from './routes/templates';
import { tokensRoutes } from './routes/tokens';
import { trendsRoutes } from './routes/trends';
import { workoutsRoutes } from './routes/workouts';
import { aiRoutes } from './routes/ai';
import { accountRoutes } from './routes/account';
import type { AppEnv, Bindings } from './types';
import { BodyAtlasMCP } from './mcp/server';
import { verifyToken } from './auth/tokens';
import { rateLimit } from './lib/rate-limit';
import { isPublicSite, robotsTxt } from './lib/visibility';

export { BodyAtlasMCP };

export const apiApp = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  .use(requireAuth)
  .use(rateLimit((env) => (env as Bindings).RL_API, (c) => c.get('userId') ?? null))
  .route('/me', meRoutes)
  .route('/exercises', exercisesRoutes)
  .route('/templates', templatesRoutes)
  .route('/workouts', workoutsRoutes)
  .route('/meals', mealsRoutes)
  .route('/sleep', sleepRoutes)
  .route('/measurements', measurementsRoutes)
  .route('/trends', trendsRoutes)
  .route('/tokens', tokensRoutes)
  .use('/ai/*', rateLimit((env) => (env as Bindings).RL_AI, (c) => c.get('userId') ?? null))
  .route('/ai', aiRoutes)
  .route('/account', accountRoutes);

const app = new Hono<AppEnv>();

// Add noindex to all worker-produced responses while the site is hidden.
app.use('*', async (c, next) => {
  await next();
  if (!isPublicSite(c.env)) {
    c.header('X-Robots-Tag', 'noindex, nofollow');
  }
});

// Public, unauthenticated robots.txt — gated by PUBLIC_SITE.
app.get('/robots.txt', (c) =>
  c.text(robotsTxt(isPublicSite(c.env)), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    // Never cache: flipping PUBLIC_SITE must take effect on the next request.
    'Cache-Control': 'no-store',
  }),
);

app.notFound((c) =>
  c.json({ error: { code: 'not_found', message: 'Not found' } }, 404),
);

app.onError((err, c) => {
  console.error('unhandled error', err);
  return c.json(
    { error: { code: 'internal', message: 'Internal server error' } },
    500,
  );
});

app.route('/api', apiApp);
app.use('/auth/*', rateLimit((env) => (env as Bindings).RL_AUTH, (c) => c.req.header('CF-Connecting-IP') ?? null));
app.route('/auth', authRoutes);
app.route('/auth', testLoginRoutes);

export type AppType = typeof apiApp;

const mcpHandler = BodyAtlasMCP.serve('/mcp', { binding: 'BODYATLAS_MCP' });

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      // CORS preflights carry no Authorization header and mutate nothing —
      // let the MCP handler answer them so browser-based connectors work.
      if (request.method === 'OPTIONS') {
        return mcpHandler.fetch(request, env, ctx);
      }
      const auth = request.headers.get('Authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const userId = token ? await verifyToken(env.DB, token) : null;
      if (!userId) {
        return Response.json(
          { error: { code: 'unauthorized', message: 'Valid bearer token required' } },
          { status: 401 },
        );
      }
      const mcpLimiter = env.RL_MCP;
      if (mcpLimiter) {
        const { success } = await mcpLimiter.limit({ key: token });
        if (!success) {
          return Response.json(
            { error: { code: 'rate_limited', message: 'Too many requests.' } },
            { status: 429, headers: { 'Retry-After': '60' } },
          );
        }
      }
      (ctx as ExecutionContext & { props: { userId: string } }).props = { userId };
      return mcpHandler.fetch(request, env, ctx);
    }
    return app.fetch(request, env, ctx);
  },
};
