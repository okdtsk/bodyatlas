/** Visibility is read at request time from the PUBLIC_SITE Worker var. */
export function isPublicSite(env: { PUBLIC_SITE?: string }): boolean {
  // Fail safe: only the exact string "true" opens the site. Anything else hides.
  return env.PUBLIC_SITE === 'true';
}

/** robots.txt body for the given visibility. */
export function robotsTxt(isPublic: boolean): string {
  return isPublic
    ? 'User-agent: *\nAllow: /\n'
    : 'User-agent: *\nDisallow: /\n';
}
