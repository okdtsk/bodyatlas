import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isPublicSite, robotsTxt } from '../src/lib/visibility';

describe('isPublicSite', () => {
  it('is public only when PUBLIC_SITE is exactly "true"', () => {
    expect(isPublicSite({ PUBLIC_SITE: 'true' })).toBe(true);
  });

  it('is hidden for "false", undefined, and any other value (fail-safe)', () => {
    expect(isPublicSite({ PUBLIC_SITE: 'false' })).toBe(false);
    expect(isPublicSite({})).toBe(false);
    expect(isPublicSite({ PUBLIC_SITE: 'TRUE' })).toBe(false);
    expect(isPublicSite({ PUBLIC_SITE: '1' })).toBe(false);
  });
});

describe('robotsTxt', () => {
  it('disallows all crawling when hidden', () => {
    expect(robotsTxt(false)).toBe('User-agent: *\nDisallow: /\n');
  });

  it('allows all crawling when public', () => {
    expect(robotsTxt(true)).toBe('User-agent: *\nAllow: /\n');
  });
});

// In the test env PUBLIC_SITE comes from wrangler.jsonc vars = "false" (hidden).
describe('robots.txt route (hidden default)', () => {
  it('serves Disallow: / as text/plain', async () => {
    const res = await SELF.fetch('https://example.com/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    expect(await res.text()).toBe('User-agent: *\nDisallow: /\n');
  });

  it('carries the X-Robots-Tag noindex header', async () => {
    const res = await SELF.fetch('https://example.com/robots.txt');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('is served no-store so a visibility flip takes effect immediately', async () => {
    const res = await SELF.fetch('https://example.com/robots.txt');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });
});

describe('X-Robots-Tag on worker routes (hidden default)', () => {
  it('adds noindex to API responses', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
