# BodyAtlas design overhaul

Status: approved (2026-08-13)
Supersedes: the "Theming & i18n" section of `2026-06-12-bodyatlas-design.md` (three named
mood themes). All other sections of that spec stand.

## Summary

A full visual overhaul of the BodyAtlas SPA. Routes, information architecture, the data
model and all i18n message **keys** are preserved. Themes, tokens, components and every
screen composition are rebuilt.

The current UI carries measurable problems, not merely taste ones: two of three themes ship
below WCAG AA on nearly every text pair, the app defines no focus styles at all, one CSS
class is referenced but never defined, and the icon system is emoji.

| Decision | Choice |
|---|---|
| Scope | Full visual overhaul; routes, IA, data model, i18n keys preserved |
| Theme model | One design language, `dark` / `light` / `system` |
| Direction | Athletic: filled colour blocking, condensed display numerals |
| Typeface | Archivo (OFL) for numerals and metric labels only; system stack for prose |
| Icons | Phosphor (`@phosphor-icons/react`, MIT), per-icon imports |
| Motion | Feedback plus considered transitions; one sanctioned loop (skeleton shimmer) |
| Dials | `DESIGN_VARIANCE 4`, `MOTION_INTENSITY 5`, `VISUAL_DENSITY 6` |

Dials depart from the `design-taste-frontend` 8/6/4 landing-page baseline because this is
product UI: a tool used six times a day should be predictable rather than asymmetric.

## Audit findings

Evidence gathered from the current `app/src` tree. Each item is fixed by this spec.

### Contrast (computed, sRGB relative luminance per WCAG 2.1)

Body text needs 4.5:1, UI component boundaries 3:1.

| Pair | gym-dark | clinical-light | warm-journal |
|---|---|---|---|
| `.muted` 13px body | 6.89 PASS | 3.71 FAIL | 2.93 FAIL |
| `.eyebrow` / `.section-title` | 7.51 PASS | 3.51 FAIL | 2.72 FAIL |
| `a{}` link colour | 15.40 PASS | 3.84 FAIL | 2.46 FAIL |
| `.delta-up` / today.done | 10.11 PASS | 3.37 FAIL | 3.10 FAIL |
| `.error-text` | 6.37 PASS | 4.38 FAIL | 3.73 FAIL |

Gym Dark is sound. Both light themes fail systematically. Warm Journal fails everything
except body copy, and its palette (`#faf6ef` ground, `#d98e4a` ochre accent, `#3d3429`
espresso text) is the beige-brass-espresso family that `design-taste-frontend` §4.2 names
as the default AI reach for warm-craft briefs.

### Defects

- `.chip` is applied at `pages/TrendsPage.tsx:279` and defined in neither `tokens.css` nor
  `base.css`. Muscle-group chips render as unstyled text.
- No `:focus` or `:focus-visible` rule exists anywhere. Keyboard and switch users get only
  the UA default, frequently invisible on `#0d0f12`.
- `.set-note` uses `font-style: italic`, which browsers synthesise as a fake oblique on
  Hiragino Sans and Noto Sans JP, producing skewed, badly-spaced Japanese.
- `.glow-card` hardcodes `border-radius: 16px` while `--radius` is `12px`, and coexists
  with a separate `.card` at 12px with no shadow. Two card systems, two radii.

### AI-slop tells

- **Emoji as the entire icon system**, on the most-visible surface. `components/AppLayout.tsx:10-13,50`
  (`☀️ 🏋️ 🍽 📈 ⚙️` in the tab bar), `components/QuickLogSheet.tsx:7-9` (`🍽 ⚖️ 🌙`),
  `components/MealFormSheet.tsx:173` (`✨`), `pages/TodayPage.tsx:129,176` (`✓`, `'★'.repeat`),
  `pages/HealthPage.tsx:150` (`▶`), `pages/SessionPage.tsx:79,117,94` (`✕`, `↗`, `↘`).
  Emoji cannot take the active-tab accent colour and render differently per platform.
- **Outer neon glow** at `styles/base.css:257-260`: `box-shadow: 0 0 18px accent` on
  `.glow-card.is-active`.
- **Kicker above every heading**: nine `.eyebrow` uses. `TodayPage` is four cards in
  identical `eyebrow + big number` treatment, so nothing is emphasised.
- **Two label systems for one job**: `.eyebrow` (10px / 1.5px tracking / uppercase / muted)
  and `.section-title` (12px / 0.6px / uppercase / muted).
- **Em-dashes in shipped copy**: six strings in each of `i18n/en.ts` and `i18n/ja.ts`, plus
  three exclamation marks in the chirpy-assistant register.
- **Text dashes standing in for chart legend swatches** at `pages/TrendsPage.tsx:237-238,306-311`
  (`— top set`, `- - est 1RM`), which match no actual stroke at any zoom level.

### Systemic

- No type scale: twelve distinct inline `fontSize` values (11 to 32) across ~200 inline
  style objects. No space scale: literals 4/6/8/10/12/14/16/20/24.
- `--font-weight-heading: 800` and every hero numeral is also 800, so headings and metrics
  carry identical emphasis and neither wins.
- Themes can retheme colour only, never rhythm, because type and space are not tokenised.
- `pages/SettingsPage.tsx` is 627 lines with 44 inline style objects, mixing six unrelated
  concerns.

## Theme model

`THEMES` becomes `['dark', 'light', 'system']`. `system` resolves via
`prefers-color-scheme`, which the app currently never consults despite being used in a dim
gym, a dim restaurant and a bright office.

Rationale: three named mood themes is a *taste* axis, and for a single-user tool the user
picks one and never changes it, which is why the other two rotted below AA. The three real
usage contexts differ by *lighting*, not mood.

### Colour tokens

Two roles are split apart, which is what made the old light themes unfixable.

`--border` is a decorative hairline (row dividers, panel edges) with no WCAG minimum.
`--border-strong` is a control boundary (inputs, secondary buttons) and must clear 3:1 per
WCAG 1.4.11.

The accent splits three ways because lime is a **fill** colour, not a **text** colour:
text on lime is 13:1, but lime as text on white is 1.4:1 and unusable. `--accent` fills
blocks, `--accent-edge` gives those blocks a readable boundary on light surfaces, and
`--accent-ink` is the accent rendered as text or stroke.

| Token | dark (default) | light |
|---|---|---|
| `--bg` | `#0b0d10` | `#f3f4f1` |
| `--surface` | `#14171c` | `#ffffff` |
| `--surface-2` | `#1d2127` | `#e8eae4` |
| `--border` | `#2a3038` | `#d5d9cf` |
| `--border-strong` | `#646d7a` | `#767d72` |
| `--text` | `#f0f2f4` | `#14171a` |
| `--text-muted` | `#9ba4af` | `#585f66` |
| `--accent` | `#d8f34e` | `#cbe93c` |
| `--accent-edge` | `#d8f34e` | `#6f8608` |
| `--accent-ink` | `#d8f34e` | `#4a6300` |
| `--accent-contrast` | `#0b0d10` | `#14171a` |
| `--positive` | `#4ade80` | `#15803d` |
| `--negative` | `#f87171` | `#b91c1c` |
| `--warning` | `#fbbf24` | `#a16207` |

In dark mode the three accent roles deliberately collapse to the same value: lime on
`#0b0d10` is 15.6:1, so it needs no separate edge and works as text unchanged. The roles
exist so that light mode can diverge, and keeping all three tokens in both modes means
components reference one name and never branch on theme.

All 17 checked foreground/background pairs clear AA in both modes. Worst cases: 3.74:1
against a 3:1 requirement (`--accent-edge` on `--bg`, light) and 4.92:1 against a 4.5:1
requirement (`--warning` on `--surface`, light).

The lime identity from Gym Dark is deliberately preserved. It is a strong, non-default
accent; it was only ever failing because it was asked to do a job it cannot do.

## Typography

Two roles:

```
--font-metric   Archivo 700, tabular-nums, tracking -0.02em   -> numbers
--font-ui       -apple-system, Hiragino Sans, Noto Sans JP    -> everything else
```

Archivo is OFL, self-hosted from the Worker with `font-display: swap`, subset to digits and
the basic Latin needed for metric suffixes (`0-9 , . / + - % : k g c a l s e t r p m h`).
Expected ~8-15KB woff2.

The available variable axes are to be confirmed when the font is vendored. If Archivo's
variable build exposes a width axis, the wider cut carries the metric treatment; if it
exposes weight only, the same effect comes from weight 700 plus the tracking already
specified. Either outcome satisfies the design; only the axis wiring differs.

Scoping the face to numerals keeps EN and JA visually identical, because digits are
locale-independent. A full-Latin display face would give JA a system-sans fallback while EN
got the display face, making JA the second-class locale.

`font-variant-numeric: tabular-nums` is functional, not decorative: it stops readouts
jittering horizontally as digits change during a session.

### Scale

```
--fs-micro     12    unit suffixes, chips, pip labels
--fs-label     14    field labels, list metadata
--fs-body      16    body copy; also the iOS input-zoom floor
--fs-title     20    screen and section headings
--fs-metric    28    secondary metrics
--fs-metric-l  40    primary panel metrics
--fs-metric-x  56    hero numeral (44 below 480px)
```

Weight stops doing double duty: metrics take emphasis from Archivo 700 plus width,
headings are UI-stack 700, labels 600, body 400. `--font-weight-heading` is deleted.

### One label style

`.eyebrow` and `.section-title` merge into a single `.label`: `--fs-label`, weight 600,
sentence case, no letter-spacing. Dropping uppercase is deliberate on three grounds: it is
the mechanical fix for the kicker tell, it reads faster at arm's length, and
`text-transform: uppercase` is inert for Japanese, so the two locales currently receive
different label treatments by accident.

## Space and shape

```
--sp-1  4    --sp-2  8    --sp-3 12    --sp-4 16
--sp-5 24    --sp-6 32    --sp-7 48
```

One documented radius rule, applied without exception:

- `--radius: 10px` for blocks (panels, buttons, inputs, sheets)
- `--radius-sm: 6px` for small elements (chips, pips, bars)
- the FAB remains a full circle

## Motion

```
--dur-press 100ms   --dur-fast 150ms   --dur-base 220ms   --dur-slow 400ms
--ease: cubic-bezier(0.2, 0, 0, 1)
```

Sanctioned:

- press feedback, `scale(0.97)` at `--dur-press`
- a set committing: accent fill sweeps the row at 180ms
- a metric changing: count-up at `--dur-slow`
- sheets: slide from bottom at `--dur-base`
- Today metrics stagger in 60ms apart on load
- the progress ring sweeps as sets land
- chart lines draw on first paint at 600ms
- tab change cross-fade at `--dur-fast`
- **skeleton shimmer**, the single sanctioned infinite loop

Forbidden: any other looping or infinite animation, scroll-driven reveals, parallax,
`window.addEventListener('scroll')`.

Everything above, shimmer included, sits inside
`@media (prefers-reduced-motion: no-preference)` and degrades to static.

## Components

### Surfaces

`.card` and `.glow-card` collapse into one `.panel`, with state as a data attribute rather
than a modifier class carrying its own geometry:

```
.panel                      --surface fill, --border, --radius
.panel[data-state=active]   --surface-2 fill + 2px --accent-edge left edge
.panel[data-state=muted]    reduced opacity, for up-next and pending rows
```

Active state is signalled by **fill and edge, never glow**. This substitution is the
central discipline of the direction: colour blocking is more legible in a dim gym than a
halo, and the outer glow is the tell that most makes the current UI read as vibe-coded.

### Controls

- `primary`: `--accent` fill, 1px `--accent-edge`, `--accent-contrast` text
- `secondary`: `--surface-2` fill, `--border-strong`
- `ghost`, `danger`: as today, retokenised
- minimum touch target **44px** (current `.btn` computes to ~40px)
- set-logging controls on Session: **48px**
- `:focus-visible` on every interactive element: 2px `--accent-ink` ring, 2px offset
- `.chip`, newly defined: `--surface-2` fill, `--radius-sm`, `--fs-micro`, muted text

### Icons

Phosphor, per-icon imports so the bundle tree-shakes. 24px in tabs, 20px inline, 28px on
the FAB. `weight="fill"` when active, `weight="bold"` otherwise, giving the tab bar a real
active state that also takes `--accent`. Icons beside a text label carry `aria-hidden`;
standalone icons carry `aria-label`.

| Surface | Icons |
|---|---|
| Tabs | `CalendarBlank`, `Barbell`, `ForkKnife`, `ChartLineUp`, `GearSix` |
| Quick-log | `Barbell`, `ForkKnife`, `Scales`, `Moon` |
| Inline | `Plus`, `Check`, `X`, `CaretLeft`, `CaretRight`, `Sparkle`, `Star`, `TrendUp`, `TrendDown` |

### Charts

Strokes move to `--accent-ink` so they survive light mode. The text-dash legends become
inline SVG swatches drawing the actual stroke and dash pattern they describe. The `dataviz`
skill is to be loaded before chart work rather than improvising palettes.

## Screen composition

### Today

Currently four cards in identical `eyebrow + big number` treatment: no hierarchy, and no
answer to "what now?". Three tiers replace them.

1. The actionable thing, full-width accent-fill block. Active workout renders
   `Resume · <template>, <n> sets in`; finished renders `Check` plus what was trained; idle
   renders `Start a workout`.
2. Calories as hero numeral at `--fs-metric-x`, macro bars beneath.
3. Weight and Sleep, 2-up at `--fs-metric`, glanceable secondaries.

Labels appear only where the number is ambiguous. Weight and Sleep keep one; the calorie
hero does not, because `1,847 / 2,300 kcal` states what it is. Kickers on this screen drop
from four to two.

### Session

The screen used mid-set, and the one that most rewards the direction.

- The header becomes **sticky**: `ProgressRing`, elapsed time and Finish stay pinned, where
  today they scroll away exactly when wanted.
- Active `ExerciseBlock` takes the accent edge; up-next stays muted.
- Per-set delete buttons are currently full `.btn` chrome on every row, making a logged set
  as loud as the action to log one. They become icon-only ghost `X` at 44px.
- `SetInputRow` steppers go to 48px.
- Logging a set sweeps an accent fill across the row and advances the ring.

### Train

Active workout reuses Today's accent-fill block component. Start actions become a 2-up grid
of large targets rather than a wrapped button row. Templates and recent workouts become
`.panel` lists with tabular-figure counts. Section labels drop from three uppercase to two
sentence-case.

### Trends

This is the desktop review surface and currently ignores that: four stacked `.glow-card`s
each wrapping a `.section-title`, which is a card nested in a card. Sections become
hairline-separated, and desktop gains a 2-column grid above 1024px. The range picker
becomes a segmented control rather than four buttons with `btn-primary` marking the active
one.

### Health

Day navigation `▶`/`◀` become Phosphor carets at 44px. The daily total becomes the hero
numeral, matching Today so the two screens agree. Meal rows keep time/name/kcal with
tabular figures.

### Settings

627 lines and 44 inline style objects split into six section components under
`pages/settings/`: `Appearance`, `Targets`, `AiKeys`, `HealthSync`, `Connector`, `Data`.
This is structural, not cosmetic: the file mixes six unrelated concerns and is the hardest
place in the app to change safely. `Appearance` gains the light/dark/system control.

### Login

The one screen where centred composition is correct, so it stays centred. Inline style
objects move to classes; it gains a focus ring; the sign-in button becomes standard
`primary`.

### Re-skinned without recomposition

`WorkoutDetail`, `ExerciseHistory`, `Exercises`, `TemplateEditor`, `Onboarding`, `Privacy`.
Their layouts are sound; they move onto the new tokens and components.

## Copy

Message **keys** are preserved throughout; only values change.

| Key | From | To |
|---|---|---|
| `train.noWorkouts` | No workouts yet — start your first one! | No workouts yet. Log your first one. |
| `train.noPrevious` | First time — no previous data | First time. No previous data. |
| `trends.noData` | Not enough data yet — keep logging! | Not enough data yet. Keep logging. |
| `today.restDay` | Rest day — start one from Train | Rest day. Start one from Train. |
| `empty.train` | Start your first workout — from a template or from scratch. | Start your first workout, from a template or from scratch. |
| `ai.noReview` | No review yet — generate your first one! | No review yet. Generate one. |

The JA catalogue receives equivalent edits; `—` is not idiomatic Japanese punctuation
either.

### The empty-value placeholder becomes a UX fix

Five sites render `/ — kcal` or a bare `—` when a target is unset: `pages/TodayPage.tsx:92`,
`pages/HealthPage.tsx:162`, `components/MacroBars.tsx:50,57,64`, `pages/SettingsPage.tsx:352`,
`pages/SessionPage.tsx:125`.

`1,847 / — kcal` is worse than useless: it implies a target exists and failed to load. Where
no target is set the comparison clause is omitted entirely (`1,847 kcal`) and the panel
offers a "set a target" affordance. The Settings `<option>` gets a real label.

## Migration

`worker/migrations/0010_theme_modes.sql` remaps `gym-dark → dark`, `clinical-light → light`,
`warm-journal → light`. (The highest existing migration is `0009_drop_api_tokens.sql`; the
`meta/` snapshots lag at `0004` and are not the source of truth for numbering.)

**Ordering constraint:** the migration must land before the Zod enum in `shared/src/user.ts`
narrows. `users.theme` is `notNull default 'gym-dark'` and validated by
`z.enum(THEMES)`; a stale row against a narrowed enum makes `/api/me` return 500. The column
default changes to `'dark'` in the same migration.

Stale `localStorage.ba_theme` needs no handling: `storedTheme()` in
`theme/ThemeProvider.tsx` already validates against `THEMES` and returns `null` on a miss,
falling back cleanly.

## Testing and verification

Test fallout is expected and in scope. `pages/TrainPage.test.tsx:36` asserts the exact
em-dash string, and every test querying an emoji or a changed class name will need updating.

New: `app/src/styles/tokens.contrast.test.ts` parses `tokens.css` and asserts every
foreground/background pair clears its WCAG threshold in both modes. The current light themes
shipped broken because nothing checked; this makes the fix permanent rather than one-time.

Definition of done:

- `npm test` green, including the new contrast test
- the 3 Playwright E2E specs green
- the kill-ai-slop scanner re-run, count dropped, anything deliberately left is named with
  its reason
- a visual pass in both modes, at a mobile viewport and desktop, against the running app

A passing scan is not the same as a better screen; the visual pass is not optional.

## Out of scope

- Routes, information architecture, tab structure
- The data model, API surface, and all i18n message keys
- Worker, MCP, AI-coach and offline-queue logic, except the one theme migration
- The iOS native shell, beyond inheriting the redesigned web UI
- Any new product feature

## Risks

| Risk | Mitigation |
|---|---|
| Athletic is the fitness-app category default and can drift back into glow slop | Glow, gradient and second-radius are banned by name; `.panel` state is fill-plus-edge only |
| Broad diff across nearly every `.tsx` makes review hard | Land tokens and components first, then screens one at a time |
| Web font fails to load in the Capacitor remote-URL shell | `font-display: swap` with the system stack as the metric fallback; numerals degrade legibly |
| Migration and enum narrowing land out of order | Migration ships first; documented as a hard ordering constraint |
