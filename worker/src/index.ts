import { Hono } from 'hono';
import { authRoutes } from './auth/google';
import { requireAuth } from './auth/middleware';
import { exercisesRoutes } from './routes/exercises';
import { meRoutes } from './routes/me';
import { templatesRoutes } from './routes/templates';
import type { AppEnv } from './types';

export const apiApp = new Hono<AppEnv>()
  .get('/health', (c) => c.json({ ok: true }))
  .use(requireAuth)
  .route('/me', meRoutes)
  .route('/exercises', exercisesRoutes)
  .route('/templates', templatesRoutes);

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

export type AppType = typeof apiApp;
export default app;
