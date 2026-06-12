import { Hono } from 'hono';
import type { AppEnv } from './types';

export const apiApp = new Hono<AppEnv>().get('/health', (c) => c.json({ ok: true }));

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  console.error('unhandled error', err);
  return c.json(
    { error: { code: 'internal', message: 'Internal server error' } },
    500,
  );
});

app.route('/api', apiApp);

export type AppType = typeof apiApp;
export default app;
