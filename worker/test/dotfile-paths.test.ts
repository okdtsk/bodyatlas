import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import wranglerConfig from '../wrangler.jsonc?raw';

const BASE = 'https://app.local';

describe('dotfile paths', () => {
  // The test pool does not apply the production SPA fallback, so the routing
  // that keeps these paths away from index.html is asserted on the config.
  it.each(['/.*', '/*/.*'])('routes %s to the Worker before static assets', (pattern) => {
    expect(wranglerConfig).toContain(`"${pattern}"`);
  });

  it.each(['/.env', '/.env.production', '/.git/config', '/.aws/credentials', '/app/.env', '/js../.git/config'])(
    'returns 404 from the Worker for %s',
    async (path) => {
      const res = await SELF.fetch(`${BASE}${path}`);
      expect(res.status).toBe(404);
    },
  );

  it('still serves OAuth discovery under /.well-known', async () => {
    const res = await SELF.fetch(`${BASE}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
  });
});
