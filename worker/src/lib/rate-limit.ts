import type { Context, MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../types';

/**
 * Build a rate-limit middleware over a limiter binding.
 * - getBinding picks the limiter from the env (may be undefined locally/in tests).
 * - getKey derives the bucket key (user id, IP, token). Returning null fails OPEN
 *   (allow) so a missing key never blocks legitimate traffic.
 * No-ops when the binding is absent (local dev / tests). Enforced only on deployed
 * Cloudflare.
 */
export function rateLimit(
  getBinding: (env: unknown) => RateLimiter | undefined,
  getKey: (c: Context) => string | null,
): MiddlewareHandler {
  return async (c, next) => {
    const binding = getBinding(c.env);
    const key = getKey(c);
    if (binding && key) {
      const { success } = await binding.limit({ key });
      if (!success) {
        return c.json(
          { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
          429,
          { 'Retry-After': '60' },
        );
      }
    }
    await next();
  };
}
