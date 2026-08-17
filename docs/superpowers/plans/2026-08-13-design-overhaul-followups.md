# Design overhaul: follow-up backlog

Raised by the final whole-branch review of `worktree-update-design` and deliberately not
fixed there. None of these is a regression against what shipped before the overhaul; they are
places the overhaul did not reach. Recorded here because the review's own notes live in a
gitignored scratch directory.

Ordered roughly by value.

## Missing motion (4 of the 9 the spec sanctions)

The spec's Motion section lists nine sanctioned motions. Five shipped: press-scale, the
180ms set-commit sweep, sheet slide-in, Today's 60ms stagger, and the skeleton shimmer. These
four did not:

- **Count-up on a changing metric** at `--dur-slow`. `--dur-slow` currently has zero
  references anywhere in `app/src`.
- **The progress ring sweeping as sets land.** `ProgressRing` has no transition on
  `strokeDashoffset`.
- **Chart lines drawing on first paint** (600ms). `LineChart.tsx` has no animation.
- **Tab-change cross-fade** at `--dur-fast`. `AppLayout.tsx` has no route transition.

Everything added must sit inside the existing `@media (prefers-reduced-motion: no-preference)`
block in `base.css`.

## The "set a target" affordance was never built

The spec's empty-value section asks for two things: omit the comparison clause when no target
is set, *and* offer a route to set one. Only the omission shipped. `TodayPage.tsx` and
`HealthPage.tsx` render a bare `1,847 kcal` with no path to Settings, so a new user has no
way to discover that targets exist.

## Token-system erosion on Health and Trends

These two screens were recomposed last and kept the most off-scale literals. The space scale
is 4/8/12/16/24/32/48; `20`, `10`, `6` and `5px` are on no scale at all.

- `HealthPage.tsx`: `marginBottom: 12`, `marginTop: 8`, `gap: 6`, `gap: 10`, `marginTop: 20`,
  `padding: '5px 12px'`, `marginTop: 6`
- `TrendsPage.tsx`: `marginBottom: 20`, `marginBottom: 12`, `gap: 6`, `marginTop: 10`,
  `gap: 8`, `marginTop: 8`

Raw `fontSize` also survives in `MacroBars.tsx` (12, and 13 which is off-scale),
`SetInputRow.tsx` (11 off-scale; and a redundant 16 that `.input` already sets),
`QuickLogSheet.tsx` (14), `SessionPage.tsx` (12), `WorkoutDetailPage.tsx` (12).

`MacroBars` is the notable one: it renders on both Today and Health, so the two hero-numeral
screens the spec wanted to agree carry untokenised type underneath.

## Two error-text systems, which is the tell the spec set out to kill

`.error-text` (`--negative` + `--fs-label`) is used in six places. But `TargetsSection`,
`AppearanceSection`, `DataSection`, `AiKeysSection` and `TrendsPage` use an inline
`style={{ color: 'var(--negative)' }}`, so errors render at 16px in Settings and 14px
everywhere else. The success banner has the same split (`color: 'var(--positive)'` inline in
three places, no class).

This is "two label systems for one job" from the spec's own audit, reintroduced in the new
Settings sections. Add `.success-text` alongside `.error-text` and use both consistently.

## Flash of dark theme for `system` users on cold load

`data-theme` is only written in `ThemeProvider`'s `useEffect`, and bare `:root` resolves to
dark, so a light-preference user on `system` sees a dark-to-light flip on every cold load.
This is newly reachable behaviour, since `system` mode did not exist before this branch.

Fix is a small inline script in `index.html`'s head that reads `localStorage.ba_theme` (or
`prefers-color-scheme` when it is `system`) and stamps `data-theme` before first paint.

## Smaller items

- `App.tsx:33` falls back to `'dark'`. `'system'` is arguably the better default now that it
  exists, and it is the spec's own stated rationale for the theme model (dim gym, bright
  office). Interacts with the FOUC item above. **This is a product call, deliberately left
  to the owner.**
- `TrendsPage.tsx` sets its own outer `padding: '16px 16px 80px'` while nested inside
  `.app-main`, which already pads. Net 32px gutters and 176px of dead bottom space on mobile.
  It is the only page with its own outer padding.
- `HealthPage.tsx` uses `data-state="active"` on the day's calorie total, which is not a
  state — it is borrowing the accent edge as decoration. Today's equivalent hero panel is a
  plain `.panel tappable`, so the two hero numerals sit on different surface treatments.
- `TrainPage.tsx` renders the template set-count as a `.chip` (no tabular figures) and the
  recent-workout set-count as `.metric`. The spec asked for tabular counts in both.
- Orphans: `--warning`, `--sp-7` and `--dur-slow` are defined and never referenced;
  `.metric-l` has zero usages (the `--fs-metric-l` token is used only by `.login-title`);
  `resolveTheme()` in `ThemeProvider.tsx` is exported and unit-tested but imported by nothing
  in product code.
- `TrendsPage.tsx` renders a hardcoded English `Settings` link label instead of `t(...)`.
- `SetInputRow` steppers are 44px, not the 48px the spec specifies for set-logging controls.
  Only the submit button got `btn-lg`.
- `e2e/visual-check.spec.ts` asserts `body` background is not transparent, but never asserts
  dark differs from light, so a regression collapsing the two palettes would pass.
- The JSX em-dash guard in `no-legacy-classes.test.ts` scans `.tsx` only, leaving
  `app/src/lib/*.ts` unguarded.
- The vendored font is the full 53KB `Archivo-Bold.woff2` rather than a digits-only subset,
  because `curl`/`wget` were unavailable in the environment that built this branch. Re-subset
  with real tooling to reach roughly 8-15KB; `app/src/styles/fonts.css` documents the state.
