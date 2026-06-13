import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { rateLimit } from '../src/lib/rate-limit';
import type { RateLimiter } from '../src/types';

function appWith(getKey: (c: any) => string | null) {
  const app = new Hono();
  app.use('*', rateLimit((env) => (env as any).LIM as RateLimiter | undefined, getKey));
  app.get('/', (c) => c.text('ok'));
  return app;
}

const allow: RateLimiter = { limit: async () => ({ success: true }) };
const deny: RateLimiter = { limit: async () => ({ success: false }) };

describe('rateLimit middleware', () => {
  it('passes through when under the limit', async () => {
    const res = await appWith(() => 'k').request('/', {}, { LIM: allow });
    expect(res.status).toBe(200);
  });

  it('returns 429 with Retry-After when over the limit', async () => {
    const res = await appWith(() => 'k').request('/', {}, { LIM: deny });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(await res.json()).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('calls the limiter with the derived key', async () => {
    const spy = vi.fn(async () => ({ success: true }));
    await appWith(() => 'user-42').request('/', {}, { LIM: { limit: spy } });
    expect(spy).toHaveBeenCalledWith({ key: 'user-42' });
  });

  it('fails open (allows) when no key can be derived', async () => {
    const spy = vi.fn(async () => ({ success: false }));
    const res = await appWith(() => null).request('/', {}, { LIM: { limit: spy } });
    expect(res.status).toBe(200);
    expect(spy).not.toHaveBeenCalled();
  });

  it('no-ops (allows) when the binding is absent', async () => {
    const res = await appWith(() => 'k').request('/', {}, {}); // no LIM in env
    expect(res.status).toBe(200);
  });
});
