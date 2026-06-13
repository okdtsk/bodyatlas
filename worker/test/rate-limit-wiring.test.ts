import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { seedUser, sessionCookieFor } from './helpers';

describe('rate-limit wiring', () => {
  it('authed /api/me still works (limiter no-ops without a binding)', async () => {
    await seedUser('rl1');
    const res = await SELF.fetch('https://example.com/api/me', { headers: { Cookie: await sessionCookieFor('rl1') } });
    expect(res.status).toBe(200);
  });
});
