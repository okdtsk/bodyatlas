import { Hono } from 'hono';
import { authRoutes } from './auth/google';
import { requireAuth } from './auth/middleware';
import { exercisesRoutes } from './routes/exercises';
import { measurementsRoutes } from './routes/measurements';
import { mealsRoutes } from './routes/meals';
import { meRoutes } from './routes/me';
import { sleepRoutes } from './routes/sleep';
import { templatesRoutes } from './routes/templates';
import { trendsRoutes } from './routes/trends';
import { workoutsRoutes } from './routes/workouts';
import type { AppEnv } from './types';

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
  .route('/trends', trendsRoutes);

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
