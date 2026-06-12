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
import type { AppEnv, Bindings } from './types';
import { BodyAtlasMCP } from './mcp/server';
import { verifyToken } from './auth/tokens';

export { BodyAtlasMCP };

export const apiApp = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  .use(requireAuth)
  .route('/me', meRoutes)
  .route('/exercises', exercisesRoutes)
  .route('/templates', templatesRoutes)
  .route('/workouts', workoutsRoutes)
  .route('/meals', mealsRoutes)
  .route('/sleep', sleepRoutes)
  .route('/measurements', measurementsRoutes)
  .route('/trends', trendsRoutes)
  .route('/tokens', tokensRoutes);

const app = new Hono<AppEnv>();

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
app.route('/auth', authRoutes);
app.route('/auth', testLoginRoutes);

export type AppType = typeof apiApp;

const mcpHandler = BodyAtlasMCP.serve('/mcp', { binding: 'BODYATLAS_MCP' });

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      const auth = request.headers.get('Authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      const userId = token ? await verifyToken(env.DB, token) : null;
      if (!userId) {
        return Response.json(
          { error: { code: 'unauthorized', message: 'Valid bearer token required' } },
          { status: 401 },
        );
      }
      (ctx as ExecutionContext & { props: { userId: string } }).props = { userId };
      return mcpHandler.fetch(request, env, ctx);
    }
    return app.fetch(request, env, ctx);
  },
};
