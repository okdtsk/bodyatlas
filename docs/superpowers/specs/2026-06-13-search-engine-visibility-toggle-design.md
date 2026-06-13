# Search-Engine Visibility Toggle — Design Spec

Date: 2026-06-13
Status: Approved

## Goal

Keep BodyAtlas out of public search engines (Google, Bing, etc.) while it is a
personal-only app, and make flipping it to publicly indexable a one-line,
version-controlled change.

## Context

- All user data is already private: every `/api/*` route is behind `requireAuth`
  (KV session), and Google sign-in is additionally gated by the OAuth client
  being in **testing** status with a fixed test-user list (family accounts only).
  No application-level email allowlist is needed — that gate is sufficient and an
  allowlist would merely duplicate it (out of scope).
- The only thing a crawler can reach anonymously is the SPA login/landing shell
  (`app/index.html`) plus a few unauthenticated `/auth/*` endpoints.
- The SPA shell is served as a **static asset** by Cloudflare Workers Assets
  (`worker/wrangler.jsonc` → `assets`), not by Worker code. `run_worker_first` is
  currently scoped to `/api/*`, `/auth/*`, `/mcp`, `/mcp/*` to keep asset serving
  fast. This constrains the design: a Worker response header cannot attach to a
  response the Worker never produces.

## The one switch

A single Worker var controls visibility:

```jsonc
// worker/wrangler.jsonc
"vars": { "PUBLIC_SITE": "false" }
```

- `"false"` (default, now) → site is hidden from search engines.
- `"true"` → site is publicly indexable.

Read at request time from `env.PUBLIC_SITE`. Flipping to public = change the
string and `npm run deploy`. No rebuild logic, no code edits. (Publishing the
Google OAuth consent screen, to open sign-in beyond the test users, is a separate
Google Cloud Console action outside this codebase.)

`PUBLIC_SITE` is added to the `Bindings` type in `worker/src/types.ts` as
`PUBLIC_SITE?: string` and treated as public only when the value is exactly
`"true"` (anything else → hidden, fail-safe).

## Mechanism — division of labor

Two layers, each covering the surface it can actually reach:

### 1. `robots.txt` — covers the static SPA shell (primary)

A Worker-served route at `/robots.txt`, added to `run_worker_first` so the Worker
answers it before the asset layer:

- hidden → `User-agent: *\nDisallow: /\n`
- public → `User-agent: *\nAllow: /\n`

`Disallow: /` keeps the static shell (and every client-routed path under it) out
of crawling. For a personal app with no inbound links, this is the effective
mechanism that keeps the shell out of search results.

Response served as `text/plain`. No-store is fine; default caching acceptable.

### 2. `X-Robots-Tag` header — covers Worker routes (defense in depth)

When hidden, a Hono middleware on the top-level `app` sets
`X-Robots-Tag: noindex, nofollow` on all Worker-produced responses
(`/api/*`, `/auth/*`, `/robots.txt`). When public, the header is omitted.

This is belt-and-suspenders: these routes return JSON / redirects and are not
meaningfully indexable, but `noindex` is honored even when a URL is discovered
via an external link, so it costs nothing to add.

### Explicitly NOT doing

- **No `<meta name="robots">` in `index.html`.** It is a static asset; making it
  conditional needs a build step or a Worker-served shell, and `robots.txt`
  already covers the shell. Avoid coupling two edits to one switch.
- **No `run_worker_first: true`** (full asset intercept). Keeps hashed JS/CSS
  asset serving fast; `robots.txt` + crawl-disallow is sufficient.

## Files touched

- `worker/wrangler.jsonc` — add `vars.PUBLIC_SITE = "false"`; add `/robots.txt`
  to `assets.run_worker_first`.
- `worker/src/types.ts` — add `PUBLIC_SITE?: string` to `Bindings`.
- `worker/src/index.ts` — register a public `GET /robots.txt` handler (before
  `requireAuth`, on the top-level `app`); add the `X-Robots-Tag` middleware on
  the top-level `app`.
- A small helper (e.g. `worker/src/lib/visibility.ts`) exporting
  `isPublicSite(env)` so the route and middleware share one source of truth.

## Testing (vitest, workers pool)

- `robots.txt` returns `Disallow: /` when `PUBLIC_SITE` is unset / `"false"` /
  any non-`"true"` value.
- `robots.txt` returns `Allow: /` when `PUBLIC_SITE === "true"`.
- A representative response (e.g. `/api/health` and `/robots.txt`) carries
  `X-Robots-Tag: noindex, nofollow` when hidden, and does NOT when public.
- `isPublicSite` treats only the exact string `"true"` as public.

## Out of scope

- Application-level email allowlist (covered by Google OAuth testing status).
- Hiding/replacing the landing page content for anonymous visitors.
- Sitemap generation for the public phase.
