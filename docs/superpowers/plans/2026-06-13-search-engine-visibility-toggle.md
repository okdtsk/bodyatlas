# Search-Engine Visibility Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hide BodyAtlas from search engines while it is personal-only, behind one version-controlled Worker var (`PUBLIC_SITE`) that flips to publicly-indexable in one line.

**Architecture:** A pure helper module decides visibility from `env.PUBLIC_SITE` (only `"true"` ⇒ public). The Worker serves a gated `/robots.txt` (`Disallow: /` when hidden, primary mechanism for the static SPA shell) and a top-level Hono middleware adds `X-Robots-Tag: noindex, nofollow` to Worker-produced responses (`/api`, `/auth`, `/robots.txt`) when hidden — defense in depth.

**Tech Stack:** Cloudflare Workers (Hono), Workers Assets (`run_worker_first`), vitest workers pool (`SELF.fetch`).

Spec: `docs/superpowers/specs/2026-06-13-search-engine-visibility-toggle-design.md`

---

## File Structure

- Create: `worker/src/lib/visibility.ts` — pure helpers `isPublicSite(env)` and `robotsTxt(isPublic)`. Single source of truth for the toggle.
- Create: `worker/test/visibility.test.ts` — unit tests (both states) + integration tests (hidden default via `SELF`).
- Modify: `worker/src/types.ts` — add `PUBLIC_SITE?: string` to `Bindings`.
- Modify: `worker/wrangler.jsonc` — add `vars.PUBLIC_SITE = "false"`; add `/robots.txt` to `assets.run_worker_first`.
- Modify: `worker/src/index.ts` — register public `GET /robots.txt` and the `X-Robots-Tag` middleware on the top-level `app`.

---

### Task 1: Visibility helper module + unit tests

**Files:**
- Create: `worker/src/lib/visibility.ts`
- Test: `worker/test/visibility.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `worker/test/visibility.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace worker -- visibility`
Expected: FAIL — cannot resolve `../src/lib/visibility`.

- [ ] **Step 3: Write the helper**

Create `worker/src/lib/visibility.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace worker -- visibility`
Expected: PASS (4 unit tests in this run; integration tests added in Task 3).

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/visibility.ts worker/test/visibility.test.ts
git commit -m "feat: add search-engine visibility helper"
```

---

### Task 2: Wire PUBLIC_SITE into config and types

**Files:**
- Modify: `worker/src/types.ts`
- Modify: `worker/wrangler.jsonc`

- [ ] **Step 1: Add the binding type**

In `worker/src/types.ts`, add `PUBLIC_SITE?: string` to the `Bindings` type. After this change the relevant section reads:

```ts
export type Bindings = {
  DB: D1Database;
  SESSIONS: KVNamespace;
  BODYATLAS_MCP: DurableObjectNamespace;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AI_KEY_SECRET: string;
  E2E_TEST_LOGIN?: string;
  PUBLIC_SITE?: string;
  RL_API?: RateLimiter;
  RL_AI?: RateLimiter;
  RL_AUTH?: RateLimiter;
  RL_MCP?: RateLimiter;
};
```

- [ ] **Step 2: Add the var and the robots.txt worker-first route**

In `worker/wrangler.jsonc`:

1. Add `"/robots.txt"` to `assets.run_worker_first` so the Worker answers it before the asset layer:

```jsonc
  "assets": {
    "directory": "./public-stub",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/auth/*", "/mcp", "/mcp/*", "/robots.txt"]
  },
```

2. Add a top-level `vars` block (place it next to `compatibility_flags`, before `assets`):

```jsonc
  "vars": { "PUBLIC_SITE": "false" },
```

- [ ] **Step 3: Verify config parses and types compile**

Run: `npm test --workspace worker -- visibility`
Expected: PASS (unchanged — confirms wrangler.jsonc still parses; the pool loads it).
Run: `npx tsc --noEmit -p worker/tsconfig.json` (if a tsconfig exists there; otherwise `npm run -w worker build` dry path)
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add worker/src/types.ts worker/wrangler.jsonc
git commit -m "feat: add PUBLIC_SITE var (default hidden) and robots.txt worker-first route"
```

---

### Task 3: Serve gated robots.txt and X-Robots-Tag header

**Files:**
- Modify: `worker/src/index.ts`
- Test: `worker/test/visibility.test.ts` (append integration tests)

- [ ] **Step 1: Write the failing integration tests**

Append to `worker/test/visibility.test.ts`:

```ts
import { SELF } from 'cloudflare:test';

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
});

describe('X-Robots-Tag on worker routes (hidden default)', () => {
  it('adds noindex to API responses', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });
});
```

Add the `SELF` import to the existing top imports instead of duplicating if your runner complains about the second import line; either form is valid in vitest ESM, but prefer a single import at the top:

```ts
import { SELF } from 'cloudflare:test';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --workspace worker -- visibility`
Expected: FAIL — `/robots.txt` returns the SPA fallback (status 200 but body is the asset HTML, not `Disallow`), and `X-Robots-Tag` is null.

- [ ] **Step 3: Implement the route and middleware**

In `worker/src/index.ts`:

1. Add the import near the other lib imports:

```ts
import { isPublicSite, robotsTxt } from './lib/visibility';
```

2. Register the middleware and route on the top-level `app`, immediately after `const app = new Hono<AppEnv>();` and BEFORE `app.notFound(...)`:

```ts
// Add noindex to all worker-produced responses while the site is hidden.
app.use('*', async (c, next) => {
  await next();
  if (!isPublicSite(c.env)) {
    c.header('X-Robots-Tag', 'noindex, nofollow');
  }
});

// Public, unauthenticated robots.txt — gated by PUBLIC_SITE.
app.get('/robots.txt', (c) =>
  c.text(robotsTxt(isPublicSite(c.env)), 200, {
    'Content-Type': 'text/plain; charset=utf-8',
  }),
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --workspace worker -- visibility`
Expected: PASS (4 unit + 3 integration).

- [ ] **Step 5: Run the full worker suite (no regressions)**

Run: `npm test --workspace worker`
Expected: PASS — existing auth/mcp/health tests unaffected (the middleware only adds a response header while hidden; no route behavior changes).

- [ ] **Step 6: Commit**

```bash
git add worker/src/index.ts worker/test/visibility.test.ts
git commit -m "feat: serve gated robots.txt and noindex header while hidden"
```

---

## Manual verification (after deploy, optional)

After `npm run deploy`:

```bash
curl -s https://bodyatlas.okdtsk.dev/robots.txt          # => User-agent: * / Disallow: /
curl -sI https://bodyatlas.okdtsk.dev/api/health | grep -i x-robots-tag   # => X-Robots-Tag: noindex, nofollow
```

To go public later: set `"PUBLIC_SITE": "true"` in `worker/wrangler.jsonc`, `npm run deploy` (and separately publish the Google OAuth consent screen).

---

## Self-Review

- **Spec coverage:** one-switch var (Task 2), robots.txt gating (Tasks 1+3), X-Robots-Tag on worker routes (Task 3), fail-safe `"true"`-only semantics (Task 1), tests for both states (Tasks 1+3). No allowlist / meta-tag / landing-page work — matches spec's "out of scope."
- **Placeholders:** none — every code/command step is concrete.
- **Type consistency:** `isPublicSite(env)` and `robotsTxt(isPublic)` signatures identical across Tasks 1 and 3; `PUBLIC_SITE?: string` matches usage.
