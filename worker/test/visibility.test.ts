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
