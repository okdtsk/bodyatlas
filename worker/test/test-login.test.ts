import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

// E2E_TEST_LOGIN is NOT set in the test bindings, so the endpoint must not exist.
describe('/auth/test-login', () => {
  it('is a 404 when the flag is absent', async () => {
    const res = await SELF.fetch('https://example.com/auth/test-login', { redirect: 'manual' });
    expect(res.status).toBe(404);
  });
});
