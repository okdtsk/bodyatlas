import { Hono } from 'hono';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { authRoutes } from './auth/google';
import { testLoginRoutes } from './auth/test-login';
import { requireAuth } from './auth/middleware';
import { exercisesRoutes } from './routes/exercises';
import { measurementsRoutes } from './routes/measurements';
import { mealsRoutes } from './routes/meals';
import { meRoutes } from './routes/me';
import { sleepRoutes } from './routes/sleep';
import { templatesRoutes } from './routes/templates';
import { trendsRoutes } from './routes/trends';
import { workoutsRoutes } from './routes/workouts';
import { aiRoutes } from './routes/ai';
import { accountRoutes } from './routes/account';
import type { AppEnv, Bindings } from './types';
import { BodyAtlasMCP } from './mcp/server';
import { mcpHandler } from './mcp/handler';
import { oauthConsentRoutes } from './auth/oauth-consent';
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
app.route('/', oauthConsentRoutes);

export type AppType = typeof apiApp;

export default new OAuthProvider<Bindings>({
  apiRoute: '/mcp',
  apiHandler: mcpHandler as ExportedHandler<Bindings> & Pick<Required<ExportedHandler<Bindings>>, 'fetch'>,
  // Hono app handles the SPA, /api, /auth, and the /authorize consent UI.
  defaultHandler: app as unknown as ExportedHandler<Bindings>,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: ['mcp'],
});
