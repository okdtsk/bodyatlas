# BodyAtlas Design Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace BodyAtlas's three named mood themes and ad-hoc styling with one Athletic design language rendered dark/light/system, built on a real token system, WCAG-AA in both modes.

**Architecture:** A two-layer CSS custom-property system: a raw palette (`--p-dark-*`, `--p-light-*`) holding every hex exactly once, and a semantic layer (`--bg`, `--accent`, …) mapping palette entries per theme. Components reference only semantic tokens and never branch on theme. Tokens and the shared component layer land first; screens are then recomposed one per task so each is independently reviewable.

**Tech Stack:** React 19, Vite 8, TypeScript 6, Vitest 4, plain CSS (no Tailwind), `@phosphor-icons/react`, Archivo (OFL) subset, Cloudflare Worker + D1 + Drizzle.

Spec: `docs/superpowers/specs/2026-08-13-bodyatlas-design-overhaul.md`

## Global Constraints

- **Zero em-dashes (`—`) and en-dashes (`–`) in any user-visible string**, in `en.ts`, `ja.ts`, or JSX. Regular hyphen `-` only.
- **No outer glows.** `box-shadow: 0 0 Npx <accent>` is banned. Active state is fill plus edge.
- **No gradients** except the existing skeleton shimmer.
- **One radius rule:** `--radius: 10px` blocks, `--radius-sm: 6px` small elements, FAB fully round. No other radius values.
- **One accent.** Lime only. No second accent hue anywhere.
- **No emoji** in product code or copy. Icons come from `@phosphor-icons/react` via `app/src/components/icons.ts`.
- **No hand-rolled SVG icons.** Chart swatches and the progress ring are data visualisation, not icons, and are exempt.
- **Minimum touch target 44px**; 48px for set-logging controls on Session.
- **`:focus-visible` required** on every interactive element: 2px `--accent-ink`, 2px offset.
- **All motion** inside `@media (prefers-reduced-motion: no-preference)`. The skeleton shimmer is the only permitted infinite loop.
- **i18n message keys are immutable.** Values change; keys never do.
- **Never use `h-screen`-equivalent `height: 100vh`.** Use `100dvh`.
- Copy register: plain and functional. No exclamation marks in empty states.

---

### Task 1: Theme model - migration, shared enum, system resolution

**Files:**
- Create: `worker/migrations/0010_theme_modes.sql`
- Modify: `shared/src/user.ts:4`
- Modify: `shared/src/user.test.ts:8,22,35,44`
- Modify: `worker/src/db/schema.ts:11`
- Modify: `app/src/theme/ThemeProvider.tsx`
- Test: `app/src/theme/ThemeProvider.test.tsx` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `THEMES = ['dark','light','system'] as const`, `type Theme = 'dark'|'light'|'system'`, and `resolveTheme(theme: Theme, prefersDark: boolean): 'dark'|'light'` exported from `app/src/theme/ThemeProvider.tsx`. Task 2's CSS depends on `data-theme` carrying the raw `Theme` (including `'system'`), NOT the resolved value.

**Ordering constraint:** the migration must be written and applied before the Zod enum narrows. `users.theme` is `notNull default 'gym-dark'`; a stale row against a narrowed enum makes `/api/me` return 500.

- [ ] **Step 1: Write the migration**

Create `worker/migrations/0010_theme_modes.sql`:

```sql
-- Collapse the three mood themes into light/dark modes.
UPDATE `users` SET `theme` = 'dark'  WHERE `theme` = 'gym-dark';
UPDATE `users` SET `theme` = 'light' WHERE `theme` IN ('clinical-light', 'warm-journal');

-- SQLite cannot ALTER a column default in place; rebuild via the Drizzle pattern.
ALTER TABLE `users` RENAME TO `users_old`;
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`google_sub` text NOT NULL,
	`email` text NOT NULL,
	`locale` text DEFAULT 'en' NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`unit` text DEFAULT 'kg' NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL
);
INSERT INTO `users` SELECT * FROM `users_old`;
DROP TABLE `users_old`;
```

> Before running this, open `worker/migrations/0000_users.sql` and every later migration that
> touches `users` (grep: `grep -n "users" worker/migrations/*.sql`). The `CREATE TABLE` above
> must list the columns as they exist *now*, in order, including any added by migrations
> 0001-0009 (`target_kcal`, `target_protein_g`, `onboarded_at`, `offline_client_id`, AI key
> columns, and so on). Copy the current shape from `worker/src/db/schema.ts`. A mismatched
> column list silently drops user data.

- [ ] **Step 2: Apply the migration locally and verify**

Run:
```bash
npx wrangler d1 migrations apply bodyatlas --local
npx wrangler d1 execute bodyatlas --local --command "SELECT DISTINCT theme FROM users;"
```
Expected: only `dark` and/or `light` returned; no `gym-dark`, `clinical-light`, `warm-journal`.

- [ ] **Step 3: Write the failing test for the narrowed enum**

Modify `shared/src/user.test.ts`, replacing every `'gym-dark'` with `'dark'` and `'warm-journal'` with `'light'`, and add:

```ts
it('accepts the three theme modes', () => {
  for (const theme of ['dark', 'light', 'system']) {
    expect(updateMeSchema.safeParse({ theme }).success).toBe(true);
  }
});

it('rejects the retired mood themes', () => {
  for (const theme of ['gym-dark', 'clinical-light', 'warm-journal']) {
    expect(updateMeSchema.safeParse({ theme }).success).toBe(false);
  }
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w shared`
Expected: FAIL - `'dark'` rejected, retired themes accepted.

- [ ] **Step 5: Narrow the enum**

In `shared/src/user.ts:4`:

```ts
export const THEMES = ['dark', 'light', 'system'] as const;
```

In `worker/src/db/schema.ts:11`, change the default:

```ts
theme: text('theme').$type<Theme>().notNull().default('dark'),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -w shared`
Expected: PASS

- [ ] **Step 7: Write the failing test for system resolution**

Create `app/src/theme/ThemeProvider.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { resolveTheme } from './ThemeProvider';

describe('resolveTheme', () => {
  it('returns the explicit mode regardless of the OS preference', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('light', false)).toBe('light');
  });

  it('follows the OS preference when set to system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `npm test -w app -- ThemeProvider`
Expected: FAIL - `resolveTheme` is not exported.

- [ ] **Step 9: Implement resolveTheme**

Add to `app/src/theme/ThemeProvider.tsx`:

```tsx
/**
 * Resolves a stored preference to a concrete rendering mode.
 * The DOM still carries the raw preference in `data-theme` so CSS can key
 * `system` off `prefers-color-scheme` directly; this helper is for code that
 * needs to know which mode is actually showing (charts, meta theme-color).
 */
export function resolveTheme(theme: Theme, prefersDark: boolean): 'dark' | 'light' {
  if (theme === 'system') return prefersDark ? 'dark' : 'light';
  return theme;
}
```

`applyTheme` and `storedTheme` are unchanged: `storedTheme` already validates against
`THEMES` and returns `null` on a miss, so a stale `ba_theme` of `'gym-dark'` falls back
safely with no extra handling.

- [ ] **Step 10: Run tests**

Run: `npm test -w app -- ThemeProvider && npm test -w shared`
Expected: PASS

- [ ] **Step 11: Commit**

```bash
git add worker/migrations/0010_theme_modes.sql shared/src/user.ts shared/src/user.test.ts \
        worker/src/db/schema.ts app/src/theme/ThemeProvider.tsx app/src/theme/ThemeProvider.test.tsx
git commit -m "feat: collapse three mood themes into dark/light/system"
```

---

### Task 2: Colour tokens with a committed contrast test

**Files:**
- Rewrite: `app/src/styles/tokens.css`
- Test: `app/src/styles/tokens.contrast.test.ts` (create)

**Interfaces:**
- Consumes: `data-theme` values from Task 1.
- Produces: the semantic colour tokens every later task uses: `--bg`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-muted`, `--accent`, `--accent-edge`, `--accent-ink`, `--accent-contrast`, `--positive`, `--negative`, `--warning`.

Write the test **first**: the current light themes shipped broken precisely because nothing checked.

- [ ] **Step 1: Write the failing contrast test**

Create `app/src/styles/tokens.contrast.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'tokens.css'), 'utf8');

/** Pulls every `--p-<mode>-<name>: #hex;` declaration out of the raw palette. */
function palette(mode: 'dark' | 'light'): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`--p-${mode}-([a-z0-9-]+):\\s*(#[0-9a-fA-F]{6})`, 'g');
  for (const m of css.matchAll(re)) out[m[1]] = m[2].toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** [foreground, background, minimum, description] - 4.5 = AA body, 3 = AA UI component. */
const PAIRS: [string, string, number, string][] = [
  ['text', 'surface', 4.5, 'body text on a panel'],
  ['text', 'bg', 4.5, 'body text on the page'],
  ['text', 'surface-2', 4.5, 'body text on a raised surface'],
  ['muted', 'surface', 4.5, 'muted body text on a panel'],
  ['muted', 'bg', 4.5, 'muted label on the page'],
  ['muted', 'surface-2', 4.5, 'muted text on a raised surface'],
  ['accent-contrast', 'accent', 4.5, 'label on an accent fill'],
  ['accent-ink', 'surface', 4.5, 'accent as text or stroke on a panel'],
  ['accent-ink', 'bg', 4.5, 'accent as text or stroke on the page'],
  ['positive', 'surface', 4.5, 'positive delta text'],
  ['negative', 'surface', 4.5, 'error text'],
  ['warning', 'surface', 4.5, 'warning text'],
  ['border-strong', 'surface', 3, 'input boundary on a panel (WCAG 1.4.11)'],
  ['border-strong', 'bg', 3, 'input boundary on the page (WCAG 1.4.11)'],
  ['accent-edge', 'surface', 3, 'accent block edge against a panel'],
  ['accent-edge', 'bg', 3, 'accent block edge against the page'],
];

describe.each(['dark', 'light'] as const)('%s palette', (mode) => {
  const p = palette(mode);

  it('defines every token the semantic layer maps', () => {
    const required = new Set(PAIRS.flatMap(([fg, bg]) => [fg, bg]));
    for (const name of required) expect(p, `--p-${mode}-${name} missing`).toHaveProperty(name);
  });

  it.each(PAIRS)('%s on %s clears %s:1 (%s)', (fg, bg, min) => {
    expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(min);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- tokens.contrast`
Expected: FAIL - no `--p-dark-*` declarations exist yet.

- [ ] **Step 3: Rewrite tokens.css**

Replace `app/src/styles/tokens.css` entirely:

```css
/*
 * Two layers:
 *   --p-<mode>-*  raw palette. Every hex appears exactly once, in this block.
 *   semantic      per-theme mapping. Components reference ONLY these.
 *
 * Verified by tokens.contrast.test.ts: all 16 pairs clear WCAG AA in both modes.
 *
 * The accent splits three ways because lime is a FILL colour, not a TEXT colour.
 * Text on lime is 13:1; lime as text on white is 1.4:1. In dark mode the three
 * roles collapse to the same value, which is intentional, so that components
 * reference one token name and never branch on theme.
 */
:root {
  --p-dark-bg: #0b0d10;
  --p-dark-surface: #14171c;
  --p-dark-surface-2: #1d2127;
  --p-dark-border: #2a3038;
  --p-dark-border-strong: #646d7a;
  --p-dark-text: #f0f2f4;
  --p-dark-muted: #9ba4af;
  --p-dark-accent: #d8f34e;
  --p-dark-accent-edge: #d8f34e;
  --p-dark-accent-ink: #d8f34e;
  --p-dark-accent-contrast: #0b0d10;
  --p-dark-positive: #4ade80;
  --p-dark-negative: #f87171;
  --p-dark-warning: #fbbf24;

  --p-light-bg: #f3f4f1;
  --p-light-surface: #ffffff;
  --p-light-surface-2: #e8eae4;
  --p-light-border: #d5d9cf;
  --p-light-border-strong: #767d72;
  --p-light-text: #14171a;
  --p-light-muted: #585f66;
  --p-light-accent: #cbe93c;
  --p-light-accent-edge: #6f8608;
  --p-light-accent-ink: #4a6300;
  --p-light-accent-contrast: #14171a;
  --p-light-positive: #15803d;
  --p-light-negative: #b91c1c;
  --p-light-warning: #a16207;
}

:root,
:root[data-theme='dark'],
:root[data-theme='system'] {
  color-scheme: dark;
  --bg: var(--p-dark-bg);
  --surface: var(--p-dark-surface);
  --surface-2: var(--p-dark-surface-2);
  --border: var(--p-dark-border);
  --border-strong: var(--p-dark-border-strong);
  --text: var(--p-dark-text);
  --text-muted: var(--p-dark-muted);
  --accent: var(--p-dark-accent);
  --accent-edge: var(--p-dark-accent-edge);
  --accent-ink: var(--p-dark-accent-ink);
  --accent-contrast: var(--p-dark-accent-contrast);
  --positive: var(--p-dark-positive);
  --negative: var(--p-dark-negative);
  --warning: var(--p-dark-warning);
}

:root[data-theme='light'] {
  color-scheme: light;
  --bg: var(--p-light-bg);
  --surface: var(--p-light-surface);
  --surface-2: var(--p-light-surface-2);
  --border: var(--p-light-border);
  --border-strong: var(--p-light-border-strong);
  --text: var(--p-light-text);
  --text-muted: var(--p-light-muted);
  --accent: var(--p-light-accent);
  --accent-edge: var(--p-light-accent-edge);
  --accent-ink: var(--p-light-accent-ink);
  --accent-contrast: var(--p-light-accent-contrast);
  --positive: var(--p-light-positive);
  --negative: var(--p-light-negative);
  --warning: var(--p-light-warning);
}

/* Same specificity as the dark rule above, but later in source, so it wins. */
@media (prefers-color-scheme: light) {
  :root[data-theme='system'] {
    color-scheme: light;
    --bg: var(--p-light-bg);
    --surface: var(--p-light-surface);
    --surface-2: var(--p-light-surface-2);
    --border: var(--p-light-border);
    --border-strong: var(--p-light-border-strong);
    --text: var(--p-light-text);
    --text-muted: var(--p-light-muted);
    --accent: var(--p-light-accent);
    --accent-edge: var(--p-light-accent-edge);
    --accent-ink: var(--p-light-accent-ink);
    --accent-contrast: var(--p-light-accent-contrast);
    --positive: var(--p-light-positive);
    --negative: var(--p-light-negative);
    --warning: var(--p-light-warning);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w app -- tokens.contrast`
Expected: PASS - 2 describe blocks, 34 assertions.

- [ ] **Step 5: Commit**

```bash
git add app/src/styles/tokens.css app/src/styles/tokens.contrast.test.ts
git commit -m "feat: AA-verified two-layer colour tokens for dark and light"
```

---

### Task 3: Type, space, shape and motion tokens plus the Archivo subset

**Files:**
- Modify: `app/src/styles/tokens.css` (append)
- Create: `app/src/styles/fonts.css`
- Create: `app/public/fonts/archivo-metric.woff2`
- Modify: `app/src/main.tsx` (import `fonts.css`)

**Interfaces:**
- Consumes: Task 2's `tokens.css`.
- Produces: `--font-metric`, `--font-ui`, `--fs-micro|label|body|title|metric|metric-l|metric-x`, `--sp-1..7`, `--radius`, `--radius-sm`, `--dur-press|fast|base|slow`, `--ease`.

- [ ] **Step 1: Fetch the Archivo subset**

Google Fonts serves a pre-subset woff2 when given `text=`. No build dependency needed.

```bash
mkdir -p app/public/fonts
CHARS='0123456789,./+-%:kgcalsetrpmh '
curl -sS -A 'Mozilla/5.0' \
  "https://fonts.googleapis.com/css2?family=Archivo:wght@700&text=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$CHARS")&display=swap" \
  -o /tmp/archivo.css
cat /tmp/archivo.css
grep -o 'https://[^)]*\.woff2' /tmp/archivo.css | head -1 | xargs curl -sS -o app/public/fonts/archivo-metric.woff2
ls -la app/public/fonts/archivo-metric.woff2
```
Expected: a woff2 well under 20KB. If the file is 0 bytes or the grep finds no URL, the API
shape changed; fall back to downloading the full Archivo variable woff2 from
`https://github.com/Omnibus-Type/Archivo` and note the larger size in the commit message.

- [ ] **Step 2: Write the @font-face declaration**

Create `app/src/styles/fonts.css`:

```css
/*
 * Archivo (SIL Open Font License 1.1) subset to digits and metric suffixes.
 * Scoped to numerals on purpose: digits are locale-independent, so EN and JA
 * render metrics identically. A full-Latin display face would give JA a system
 * fallback while EN got Archivo, making JA the second-class locale.
 */
@font-face {
  font-family: 'Archivo Metric';
  src: url('/fonts/archivo-metric.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 3: Import it before the token sheet**

In `app/src/main.tsx`, add above the existing style imports:

```tsx
import './styles/fonts.css';
```

- [ ] **Step 4: Append the non-colour tokens**

Append to `app/src/styles/tokens.css`:

```css
:root {
  /* Type. Metric numerals carry emphasis from the face and tracking, headings
     from weight. --font-weight-heading is deliberately gone: it used to be 800
     while hero numerals were also 800, so neither won. */
  --font-metric: 'Archivo Metric', ui-sans-serif, system-ui, sans-serif;
  --font-ui:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', 'Noto Sans JP',
    sans-serif;

  --fs-micro: 12px;
  --fs-label: 14px;
  --fs-body: 16px;
  --fs-title: 20px;
  --fs-metric: 28px;
  --fs-metric-l: 40px;
  --fs-metric-x: 56px;

  --lh-tight: 1.05;
  --lh-normal: 1.5;

  /* Space, 4px ramp. Replaces literals 4/6/8/10/12/14/16/20/24. */
  --sp-1: 4px;
  --sp-2: 8px;
  --sp-3: 12px;
  --sp-4: 16px;
  --sp-5: 24px;
  --sp-6: 32px;
  --sp-7: 48px;

  /* Shape. Exactly two values; the FAB is the only full-round element. */
  --radius: 10px;
  --radius-sm: 6px;

  /* Motion */
  --dur-press: 100ms;
  --dur-fast: 150ms;
  --dur-base: 220ms;
  --dur-slow: 400ms;
  --ease: cubic-bezier(0.2, 0, 0, 1);

  --tap-min: 44px;
  --tap-lg: 48px;
}

@media (max-width: 479px) {
  :root {
    --fs-metric-x: 44px;
  }
}
```

- [ ] **Step 5: Verify the font loads**

Run: `npm run dev`, open http://localhost:5173, then in the browser console:
```js
document.fonts.check("700 40px 'Archivo Metric'")
```
Expected: `true`.

- [ ] **Step 6: Commit**

```bash
git add app/src/styles/tokens.css app/src/styles/fonts.css app/public/fonts/archivo-metric.woff2 app/src/main.tsx
git commit -m "feat: type, space, shape and motion tokens with Archivo numeral subset"
```

---

### Task 4: Component layer - panel, controls, focus, label, chip

**Files:**
- Rewrite: `app/src/styles/base.css`

**Interfaces:**
- Consumes: all tokens from Tasks 2 and 3.
- Produces: `.panel` (+ `[data-state=active|muted]`), `.btn` (+ `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.btn-icon`), `.input`, `.input-num`, `.label`, `.chip`, `.metric` (+ `.metric-l`, `.metric-x`), `.stack`, `.row`, `.muted`, `.error-text`, `.set-note`, `.sheet-backdrop`, `.sheet-panel`, `.skeleton`, `.pips`/`.pip`, `.delta-up`/`.delta-down`, `.tab`, `.fab`, `.app-*`, `.segmented`.

This task deletes `.card`, `.glow-card`, `.eyebrow`, `.section-title` and `--font-weight-heading`. Screens still referencing them break until their own task lands; that is expected and is why Tasks 8-14 follow.

- [ ] **Step 1: Rewrite base.css**

Replace `app/src/styles/base.css` entirely:

```css
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: var(--fs-body);
  line-height: var(--lh-normal);
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

h1,
h2,
h3 {
  font-weight: 700;
  line-height: 1.2;
  margin: 0;
}

h1 {
  font-size: var(--fs-title);
}

a {
  color: var(--accent-ink);
}

button {
  font: inherit;
}

/* Focus. The previous stylesheet defined no focus rule at all, so keyboard and
   switch users got only the UA default, frequently invisible on #0b0d10. */
:focus-visible {
  outline: 2px solid var(--accent-ink);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}

/* ---------- numerals ---------- */

/* tabular-nums is functional, not decorative: it stops readouts jittering
   horizontally as digits change mid-session. */
.metric {
  font-family: var(--font-metric);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
  line-height: var(--lh-tight);
  font-size: var(--fs-metric);
}

.metric-l {
  font-size: var(--fs-metric-l);
}

.metric-x {
  font-size: var(--fs-metric-x);
}

.metric-unit {
  font-family: var(--font-ui);
  font-size: var(--fs-label);
  font-weight: 400;
  color: var(--text-muted);
  letter-spacing: 0;
}

/* ---------- layout ---------- */

.app-layout {
  min-height: 100dvh;
}

.app-main {
  padding: var(--sp-4);
  padding-bottom: 96px;
}

.app-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-around;
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: var(--sp-2) 0 env(safe-area-inset-bottom);
  z-index: 10;
}

.tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-1);
  min-width: var(--tap-min);
  min-height: var(--tap-min);
  font-size: var(--fs-micro);
  color: var(--text-muted);
  text-decoration: none;
}

.tab.active {
  color: var(--accent-ink);
  font-weight: 600;
}

.fab {
  position: fixed;
  right: var(--sp-4);
  bottom: 84px;
  width: 56px;
  height: 56px;
  border-radius: 50%; /* the one full-round element, per the shape rule */
  border: 1px solid var(--accent-edge);
  background: var(--accent);
  color: var(--accent-contrast);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 15;
  box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
}

@media (min-width: 768px) {
  .app-layout {
    display: grid;
    grid-template-columns: 200px 1fr;
  }

  .app-nav {
    position: sticky;
    top: 0;
    bottom: auto;
    flex-direction: column;
    justify-content: flex-start;
    gap: var(--sp-2);
    height: 100dvh;
    border-top: none;
    border-right: 1px solid var(--border);
    padding: var(--sp-5) var(--sp-3);
  }

  .tab {
    flex-direction: row;
    justify-content: flex-start;
    gap: var(--sp-3);
    font-size: var(--fs-label);
    padding: var(--sp-3);
    border-radius: var(--radius);
    width: 100%;
  }

  .tab.active {
    background: var(--surface-2);
  }

  .app-main {
    padding: var(--sp-5) var(--sp-6);
    max-width: 960px;
  }

  .fab {
    bottom: var(--sp-5);
  }
}

/* Trends is the desktop review surface and earns two columns. */
@media (min-width: 1024px) {
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--sp-5);
  }
}

/* ---------- primitives ---------- */

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--sp-3);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

/* One panel replaces .card and .glow-card. State is a data attribute so it
   cannot drift into carrying its own geometry the way .glow-card did. */
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--sp-3) var(--sp-4);
}

/* Active state is fill plus edge. NEVER a glow. */
.panel[data-state='active'] {
  background: var(--surface-2);
  border-left: 2px solid var(--accent-edge);
}

.panel[data-state='muted'] {
  opacity: 0.62;
}

.panel.tappable {
  cursor: pointer;
  display: block;
  width: 100%;
  text-align: left;
  color: inherit;
  text-decoration: none;
}

/* The one accent-fill block, used for the single most actionable thing on a
   screen. At most one per screen. */
.block-accent {
  background: var(--accent);
  border: 1px solid var(--accent-edge);
  border-radius: var(--radius);
  color: var(--accent-contrast);
  padding: var(--sp-4);
  display: block;
  width: 100%;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.block-accent .muted,
.block-accent .metric-unit {
  color: var(--accent-contrast);
  opacity: 0.72;
}

.label {
  font-size: var(--fs-label);
  font-weight: 600;
  color: var(--text-muted);
}

.muted {
  color: var(--text-muted);
  font-size: var(--fs-label);
}

.chip {
  display: inline-block;
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: var(--sp-1) var(--sp-2);
  font-size: var(--fs-micro);
  color: var(--text-muted);
}

.error-text {
  color: var(--negative);
  font-size: var(--fs-label);
}

/* Not italic: browsers synthesise a fake oblique on Hiragino Sans and Noto
   Sans JP, which renders as skewed, badly-spaced Japanese. */
.set-note {
  color: var(--text-muted);
  font-size: var(--fs-label);
}

/* ---------- controls ---------- */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--sp-2);
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-4);
  border-radius: var(--radius);
  border: 1px solid var(--border-strong);
  background: var(--surface-2);
  color: var(--text);
  cursor: pointer;
  font-weight: 600;
  white-space: nowrap;
}

.btn-primary {
  background: var(--accent);
  border-color: var(--accent-edge);
  color: var(--accent-contrast);
}

.btn-secondary {
  background: var(--surface-2);
  border-color: var(--border-strong);
  color: var(--text);
}

.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--text-muted);
}

.btn-danger {
  background: transparent;
  border-color: var(--negative);
  color: var(--negative);
}

.btn-icon {
  min-width: var(--tap-min);
  padding: var(--sp-2);
}

.btn-lg {
  min-height: var(--tap-lg);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.segmented {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 2px;
  gap: 2px;
}

.segmented button {
  min-height: 36px;
  padding: 0 var(--sp-3);
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-weight: 600;
  font-size: var(--fs-label);
}

.segmented button[aria-pressed='true'] {
  background: var(--accent);
  color: var(--accent-contrast);
}

.input {
  min-height: var(--tap-min);
  padding: var(--sp-2) var(--sp-3);
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  width: 100%;
  font-size: var(--fs-body); /* below 16px iOS Safari zooms on focus */
}

select.input,
textarea.input {
  font-size: var(--fs-body);
}

.input-num {
  width: 84px;
  text-align: center;
  font-family: var(--font-metric);
  font-variant-numeric: tabular-nums;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
}

/* ---------- sheets ---------- */

.sheet-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.55);
  display: flex;
  align-items: flex-end;
  z-index: 20;
}

.sheet-panel {
  background: var(--surface);
  border-radius: var(--radius) var(--radius) 0 0;
  border-top: 2px solid var(--accent-edge);
  padding: var(--sp-4);
  width: 100%;
  max-width: 480px;
  margin: 0 auto;
  max-height: 80dvh;
  overflow-y: auto;
}

/* ---------- indicators ---------- */

.pips {
  display: inline-flex;
  gap: 3px;
}

.pip {
  width: 14px;
  height: 4px;
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}

.pip.on {
  background: var(--accent);
}

.delta-up {
  color: var(--positive);
  font-weight: 600;
}

.delta-down {
  color: var(--text-muted);
}

.session-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: var(--sp-4);
  background: var(--bg);
  padding: var(--sp-3) 0;
  border-bottom: 1px solid var(--border);
}

.skeleton {
  background: var(--surface-2);
  border-radius: var(--radius);
}

/* ---------- motion ----------
   Everything is gated. The skeleton shimmer is the ONLY sanctioned infinite
   loop; every other animation is tied to a discrete state change. */
@media (prefers-reduced-motion: no-preference) {
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  .skeleton {
    background: linear-gradient(
      90deg,
      var(--surface-2) 25%,
      var(--border) 50%,
      var(--surface-2) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }

  .btn,
  .panel.tappable,
  .block-accent {
    transition:
      transform var(--dur-press) var(--ease),
      background-color var(--dur-fast) var(--ease);
  }

  .btn:active,
  .panel.tappable:active,
  .block-accent:active {
    transform: scale(0.97);
  }

  @keyframes set-commit {
    from {
      background-color: var(--accent);
    }
    to {
      background-color: transparent;
    }
  }

  .set-committed {
    animation: set-commit 180ms var(--ease);
  }

  @keyframes rise-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .rise-in {
    animation: rise-in var(--dur-base) var(--ease) both;
  }

  @keyframes sheet-in {
    from {
      transform: translateY(100%);
    }
    to {
      transform: none;
    }
  }

  .sheet-panel {
    animation: sheet-in var(--dur-base) var(--ease);
  }
}
```

- [ ] **Step 2: Verify the app still builds**

Run: `npm run build -w app`
Expected: build succeeds. TypeScript does not check CSS class names, so screens
referencing the deleted `.card` / `.glow-card` compile but render unstyled until their
task lands.

- [ ] **Step 3: Commit**

```bash
git add app/src/styles/base.css
git commit -m "feat: rebuild component layer on tokens with focus states and fill-based active"
```

---

### Task 5: Icon module and the app shell

**Files:**
- Create: `app/src/components/icons.ts`
- Modify: `app/src/components/AppLayout.tsx`
- Modify: `app/src/components/QuickLogSheet.tsx`
- Modify: `app/package.json` (dependency)

**Interfaces:**
- Consumes: `.tab`, `.fab`, `.sheet-*` from Task 4.
- Produces: `app/src/components/icons.ts` re-exporting semantic names used by every later
  task: `IconToday`, `IconTrain`, `IconHealth`, `IconTrends`, `IconSettings`, `IconSet`,
  `IconMeal`, `IconWeight`, `IconSleep`, `IconPlus`, `IconCheck`, `IconClose`, `IconPrev`,
  `IconNext`, `IconSparkle`, `IconStar`, `IconTrendUp`, `IconTrendDown`, `IconEdit`.
  All accept Phosphor's props (`size`, `weight`, `color`, `aria-*`).

- [ ] **Step 1: Install the icon library**

Run:
```bash
npm install -w app @phosphor-icons/react
```
Expected: added to `app/package.json` dependencies. MIT licensed.

- [ ] **Step 2: Create the icon module**

Create `app/src/components/icons.ts`:

```ts
/**
 * Single mapping from semantic role to Phosphor glyph. Screens import from here,
 * never from '@phosphor-icons/react' directly, so a glyph swap is a one-line change
 * and the whole app cannot drift onto two icon families.
 *
 * Sizing convention: 24 in tabs, 20 inline, 28 on the FAB.
 * Weight convention: "fill" when active or selected, "bold" otherwise.
 */
export {
  CalendarBlank as IconToday,
  Barbell as IconTrain,
  ForkKnife as IconHealth,
  ChartLineUp as IconTrends,
  GearSix as IconSettings,
  Barbell as IconSet,
  ForkKnife as IconMeal,
  Scales as IconWeight,
  Moon as IconSleep,
  Plus as IconPlus,
  Check as IconCheck,
  X as IconClose,
  CaretLeft as IconPrev,
  CaretRight as IconNext,
  Sparkle as IconSparkle,
  Star as IconStar,
  TrendUp as IconTrendUp,
  TrendDown as IconTrendDown,
  PencilSimple as IconEdit,
} from '@phosphor-icons/react';
```

- [ ] **Step 3: Write the failing test for the tab bar**

Create `app/src/components/AppLayout.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../i18n';
import { AppLayout } from './AppLayout';

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/']}>
          <AppLayout />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('AppLayout', () => {
  it('renders no emoji in the tab bar', () => {
    renderLayout();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    // Emoji presentation, misc symbols, dingbats, and variation selectors.
    expect(nav.textContent ?? '').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it('labels the quick-log button for screen readers', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: /quick log/i })).toBeInTheDocument();
  });
});
```

> Check `app/src/i18n/index.tsx` for the provider's real name and props before running; if it
> takes no `locale` prop, drop it. Check `app/src/test/mockApi.ts` for whether the offline
> controller needs stubbing here, and follow the pattern already used in
> `app/src/components/OfflineIndicator.test.tsx`.

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test -w app -- AppLayout`
Expected: FAIL - the emoji assertion fails on `☀️🏋️🍽📈⚙️`.

- [ ] **Step 5: Replace the emoji tabs with icons**

In `app/src/components/AppLayout.tsx`, replace the `TABS` constant and the nav block:

```tsx
import type { Icon } from '@phosphor-icons/react';
import {
  IconToday, IconTrain, IconHealth, IconTrends, IconSettings, IconPlus,
} from './icons';

const TABS: { to: string; key: MessageKey; Glyph: Icon }[] = [
  { to: '/', key: 'nav.today', Glyph: IconToday },
  { to: '/train', key: 'nav.train', Glyph: IconTrain },
  { to: '/health', key: 'nav.health', Glyph: IconHealth },
  { to: '/trends', key: 'nav.trends', Glyph: IconTrends },
  { to: '/settings', key: 'nav.settings', Glyph: IconSettings },
];
```

and the nav body:

```tsx
<nav className="app-nav" aria-label="Main">
  {TABS.map(({ to, key, Glyph }) => (
    <NavLink
      key={to}
      to={to}
      end={to === '/'}
      className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
    >
      {({ isActive }) => (
        <>
          <Glyph size={24} weight={isActive ? 'fill' : 'bold'} aria-hidden />
          <span>{t(key)}</span>
        </>
      )}
    </NavLink>
  ))}
</nav>
```

and the FAB:

```tsx
<button className="fab" aria-label={t('quickLog.title')} onClick={() => setSheetOpen(true)}>
  <IconPlus size={28} weight="bold" aria-hidden />
</button>
```

Note the Settings tab moves into `TABS` rather than being appended separately, which is what
gives it the same active-weight behaviour as the other four.

- [ ] **Step 6: Replace the quick-log emoji**

In `app/src/components/QuickLogSheet.tsx`, replace the actions constant:

```tsx
import type { Icon } from '@phosphor-icons/react';
import { IconSet, IconMeal, IconWeight, IconSleep } from './icons';

const ACTIONS: { key: MessageKey; Glyph: Icon; path: string }[] = [
  { key: 'quickLog.set', Glyph: IconSet, path: '/train/session' },
  { key: 'quickLog.meal', Glyph: IconMeal, path: '/health?add=meal' },
  { key: 'quickLog.weight', Glyph: IconWeight, path: '/health?add=weight' },
  { key: 'quickLog.sleep', Glyph: IconSleep, path: '/health?add=sleep' },
];
```

> Open the file first: the existing array's key names and paths are the source of truth.
> Keep them exactly; only the icon field changes. Render each as
> `<Glyph size={20} weight="bold" aria-hidden />` beside the existing label.

- [ ] **Step 7: Run tests**

Run: `npm test -w app -- AppLayout QuickLogSheet`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/package.json package-lock.json app/src/components/icons.ts \
        app/src/components/AppLayout.tsx app/src/components/AppLayout.test.tsx \
        app/src/components/QuickLogSheet.tsx
git commit -m "feat: replace emoji icon system with Phosphor glyphs"
```

---

### Task 6: Copy cleanup and the empty-value UX fix

**Files:**
- Modify: `app/src/i18n/en.ts:52,60,155,157,165,189`
- Modify: `app/src/i18n/ja.ts:54,62,157,159,191`
- Modify: `app/src/components/MacroBars.tsx:50,57,64`
- Modify: `app/src/pages/SettingsPage.tsx:352`
- Modify: `app/src/pages/SessionPage.tsx:125`
- Modify: `app/src/pages/TrainPage.test.tsx:36`
- Test: `app/src/i18n/messages.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: no new symbols. Later tasks rely on `MacroBars` omitting the comparison clause
  when a target is `null`, rather than rendering a dash.

- [ ] **Step 1: Write the failing test banning dashes in copy**

Append to `app/src/i18n/messages.test.ts`:

```ts
import { en } from './en';
import { ja } from './ja';

describe('copy register', () => {
  it.each([['en', en], ['ja', ja]] as const)('%s uses no em or en dashes', (_name, cat) => {
    const offenders = Object.entries(cat).filter(([, v]) => /[—–]/.test(v));
    expect(offenders).toEqual([]);
  });

  it.each([['en', en], ['ja', ja]] as const)('%s empty states do not exclaim', (_name, cat) => {
    const offenders = Object.entries(cat).filter(
      ([k, v]) => (k.startsWith('empty.') || k.endsWith('.noData') || k.endsWith('.noReview')) &&
        /[!！]/.test(v),
    );
    expect(offenders).toEqual([]);
  });
});
```

> Check how `en.ts` and `ja.ts` export their catalogues (named vs default) and match it.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- messages`
Expected: FAIL - six dash offenders per catalogue, plus exclamation offenders.

- [ ] **Step 3: Fix the English copy**

In `app/src/i18n/en.ts`, replace these six values. Keys are unchanged.

```ts
'train.noWorkouts': 'No workouts yet. Log your first one.',
'train.noPrevious': 'First time. No previous data.',
'trends.noData': 'Not enough data yet. Keep logging.',
'today.restDay': 'Rest day. Start one from Train.',
'empty.train': 'Start your first workout, from a template or from scratch.',
'ai.noReview': 'No review yet. Generate one.',
```

- [ ] **Step 4: Fix the Japanese copy**

In `app/src/i18n/ja.ts`. `—` is not idiomatic Japanese punctuation either.

```ts
'train.noWorkouts': 'まだワークアウトがありません。最初の記録を始めましょう。',
'train.noPrevious': '初挑戦です。前回データはありません。',
'trends.noData': 'まだデータが足りません。記録を続けましょう。',
'today.restDay': '休養日です。Trainタブからトレーニングを開始できます。',
'ai.noReview': 'まだレビューがありません。最初のレビューを生成しましょう。',
```

> Check whether `ja.ts` has an `empty.train` key matching `en.ts:165`; if so, give it the
> same treatment. The `messages.test.ts` key-parity check will catch it either way.

- [ ] **Step 5: Remove the dash placeholders**

In `app/src/components/MacroBars.tsx`, the three sites at :50, :57, :64 currently render
`{proteinG}g / {targetProteinG != null ? `${targetProteinG}g` : '—'}`. A dash implies a
target exists and failed to load. Omit the clause instead:

```tsx
<span className="muted">
  {proteinG}g{targetProteinG != null ? ` / ${targetProteinG}g` : ''}
</span>
```

Apply the same shape to fat and carbs.

In `app/src/pages/SettingsPage.tsx:352`, replace `<option value="">—</option>` with
`<option value="">{t('common.none')}</option>` and add the key to both catalogues
(`'common.none': 'None'` / `'common.none': '未設定'`).

In `app/src/pages/SessionPage.tsx:125`, the pending-set row renders `'—'` when reps are
absent. Render the unit-less count or nothing:

```tsx
<span>{op.payload.reps != null ? `${String(op.payload.reps)} ${t('field.reps')}` : ''}</span>
```

- [ ] **Step 6: Update the assertion that pins the old string**

In `app/src/pages/TrainPage.test.tsx:36`:

```tsx
expect(screen.getByText('No workouts yet. Log your first one.')).toBeInTheDocument();
```

- [ ] **Step 7: Run the full app suite**

Run: `npm test -w app`
Expected: PASS. Any other test asserting a changed string fails here; update it to the new
value rather than reverting the copy.

- [ ] **Step 8: Commit**

```bash
git add app/src/i18n app/src/components/MacroBars.tsx app/src/pages/SettingsPage.tsx \
        app/src/pages/SessionPage.tsx app/src/pages/TrainPage.test.tsx
git commit -m "fix: plain copy register and drop dash placeholders for unset targets"
```

---

### Task 7: TodayPage recomposition

**Files:**
- Rewrite: `app/src/pages/TodayPage.tsx`
- Modify: `app/src/pages/TodayPage.test.tsx`

**Interfaces:**
- Consumes: `.block-accent`, `.panel`, `.metric*`, `.label`, `.rise-in` (Task 4); `IconCheck`,
  `IconStar` (Task 5); `MacroBars` target-omission behaviour (Task 6).
- Produces: nothing consumed downstream.

The current screen is four cards in identical `eyebrow + big number` treatment: no hierarchy,
and no answer to "what now?". Three tiers replace them. All data hooks, the `isSameDay`
helper and the loading/empty logic are unchanged; only presentation moves.

- [ ] **Step 1: Write the failing test for hierarchy**

Replace the presentation assertions in `app/src/pages/TodayPage.test.tsx` (keep the existing
fixtures and the local-time comment at :24):

```tsx
it('renders the actionable block first and the calorie hero second', () => {
  renderToday(); // existing helper in this file
  const main = screen.getByRole('region', { name: /today/i });
  const order = Array.from(main.querySelectorAll('.block-accent, .metric-x'));
  expect(order.length).toBeGreaterThanOrEqual(2);
  expect(order[0]).toHaveClass('block-accent');
  expect(order[1]).toHaveClass('metric-x');
});

it('uses at most two labels on the screen', () => {
  renderToday();
  expect(screen.getByRole('region', { name: /today/i }).querySelectorAll('.label').length)
    .toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- TodayPage`
Expected: FAIL - no `.block-accent` element, four `.eyebrow` elements.

- [ ] **Step 3: Rewrite the render body**

Keep every hook, `isSameDay`, and the derived values exactly as they are. Replace the
returned JSX:

```tsx
return (
  <section aria-label={t('nav.today')}>
    {isEmpty && <p className="muted" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>{t('empty.today')}</p>}

    <div className="stack" style={{ gap: 'var(--sp-3)' }}>
      {/* Tier 1 - the one actionable thing. Exactly one accent block per screen. */}
      {activeWorkout ? (
        <Link to="/train/session" className="block-accent rise-in">
          <strong style={{ fontSize: 'var(--fs-title)' }}>{t('train.resume')}</strong>
          <div className="muted">{t('train.inProgress')}</div>
        </Link>
      ) : doneToday ? (
        <div className="panel rise-in" data-state="active">
          <div className="row">
            <IconCheck size={20} weight="bold" aria-hidden />
            <strong>{t('today.done')}</strong>
          </div>
          {latestWorkout && (
            <div className="muted">
              {(locale === 'ja' ? latestWorkout.exerciseNamesJa : latestWorkout.exerciseNames)?.join(', ')}
            </div>
          )}
        </div>
      ) : (
        <Link to="/train" className="block-accent rise-in">
          <strong style={{ fontSize: 'var(--fs-title)' }}>{t('train.start')}</strong>
          <div className="muted">{t('today.restDay')}</div>
        </Link>
      )}

      {/* Tier 2 - the hero metric. No label: the number states what it is. */}
      <Link to="/health" className="panel tappable rise-in" style={{ animationDelay: '60ms' }}>
        {mealsQuery.isPending ? (
          <Skeleton height={72} />
        ) : (
          <>
            <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)' }}>
              <span className="metric metric-x">{totalKcal.toLocaleString()}</span>
              <span className="metric-unit">
                {me?.targetKcal != null ? `/ ${me.targetKcal.toLocaleString()} ` : ''}
                kcal {t('today.eaten')}
              </span>
            </div>
            <MacroBars
              proteinG={totalProtein} fatG={totalFat} carbsG={totalCarbs}
              targetProteinG={me?.targetProteinG} targetFatG={me?.targetFatG}
              targetCarbsG={me?.targetCarbsG}
            />
          </>
        )}
      </Link>

      {/* Tier 3 - glanceable secondaries, 2-up. These keep their labels because
          "72.4" and "7h 20m" are ambiguous without one. */}
      <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'stretch' }}>
        <Link to="/health" className="panel tappable rise-in" style={{ flex: 1, animationDelay: '120ms' }}>
          <div className="label">{t('today.weight')}</div>
          {measurementsQuery.isPending ? (
            <Skeleton height={40} />
          ) : latestWeight?.weightKg != null ? (
            <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)' }}>
              <span className="metric">{latestWeight.weightKg}</span>
              <span className="metric-unit">kg</span>
              {sparklinePoints.length > 1 && <Sparkline points={sparklinePoints} />}
            </div>
          ) : (
            <p className="muted">{t('today.noWeight')}</p>
          )}
        </Link>

        <Link to="/health" className="panel tappable rise-in" style={{ flex: 1, animationDelay: '180ms' }}>
          <div className="label">{t('today.sleep')}</div>
          {sleepQuery.isPending ? (
            <Skeleton height={40} />
          ) : lastSleep ? (
            <>
              <span className="metric">{sleepDurationLabel(lastSleep.bedAt, lastSleep.wokeAt)}</span>
              {lastSleep.quality != null && (
                <div className="row" style={{ gap: 2 }} aria-label={`${t('field.quality')}: ${lastSleep.quality}/5`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <IconStar
                      key={n} size={14} weight={n <= lastSleep.quality! ? 'fill' : 'regular'}
                      color={n <= lastSleep.quality! ? 'var(--accent-ink)' : 'var(--text-muted)'}
                      aria-hidden
                    />
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="muted">{t('today.noSleep')}</p>
          )}
        </Link>
      </div>
    </div>
  </section>
);
```

Add `import { IconCheck, IconStar } from '../components/icons';` and pull `locale` from
`useI18n()`. The `field.quality` key must exist in both catalogues; if it does not, add
`'field.quality': 'Quality'` / `'field.quality': '睡眠の質'`.

- [ ] **Step 4: Run tests**

Run: `npm test -w app -- TodayPage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/TodayPage.tsx app/src/pages/TodayPage.test.tsx app/src/i18n
git commit -m "feat: recompose Today into three tiers with one accent block"
```

---

### Task 8: SessionPage recomposition

**Files:**
- Modify: `app/src/pages/SessionPage.tsx`
- Modify: `app/src/components/SetInputRow.tsx`
- Modify: `app/src/pages/SessionPage.test.tsx`

**Interfaces:**
- Consumes: `.session-header` (now sticky), `.panel[data-state]`, `.btn-icon`, `.btn-lg`,
  `.set-committed` (Task 4); `IconClose`, `IconTrendUp`, `IconTrendDown` (Task 5).
- Produces: nothing consumed downstream.

The screen used mid-set. Business logic (`activeIndex` derivation, ring totals, the
persist-input-after-logging behaviour at :130) is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `app/src/pages/SessionPage.test.tsx`:

```tsx
it('renders no glyph characters as buttons', () => {
  renderSession(); // existing helper in this file
  expect(document.body.textContent ?? '').not.toMatch(/[✕✖↗↘]/u);
});

it('gives set-logging controls a 48px target', () => {
  renderSession();
  expect(screen.getByRole('button', { name: /log set/i })).toHaveClass('btn-lg');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- SessionPage`
Expected: FAIL - `✕` present, no `btn-lg`.

- [ ] **Step 3: Make the header sticky and retokenise it**

In `SessionPage`, replace the header block (currently :183-193). `.session-header` already
carries `position: sticky` from Task 4, so this is markup only:

```tsx
<div className="session-header">
  <ProgressRing done={totalDone} total={totalPlanned} />
  <div className="stack" style={{ gap: 'var(--sp-1)', flex: 1 }}>
    <span className="label">{elapsedMin} {t('train.elapsedMin')}</span>
    <button className="btn btn-primary" onClick={finish} disabled={update.isPending}>
      {t('train.finish')}
    </button>
  </div>
</div>
```

- [ ] **Step 4: Replace the glyph buttons in ExerciseBlock**

The remove-exercise button (:70-80) and per-set delete (:115-117) are currently full `.btn`
chrome, making a logged set as loud as the action to log one. Both become icon-only ghosts:

```tsx
<button
  className="btn btn-ghost btn-icon"
  aria-label={`remove-${we.id}`}
  onClick={() => {
    if (we.sets.length === 0 || window.confirm(t('common.confirmDelete'))) {
      removeExercise.mutate(we.id);
    }
  }}
>
  <IconClose size={20} weight="bold" aria-hidden />
</button>
```

and for each set row:

```tsx
<button
  className="btn btn-ghost btn-icon"
  onClick={() => deleteSet.mutate(s.id)}
  aria-label={`delete-set-${s.position}`}
>
  <IconClose size={18} weight="bold" aria-hidden />
</button>
```

The `aria-label` values are preserved verbatim - existing tests query by them.

- [ ] **Step 5: Replace the delta arrows**

Replace the `↗`/`↘` at :94:

```tsx
<span className={delta > 0 ? 'delta-up' : 'delta-down'}>
  {delta > 0 ? <IconTrendUp size={16} weight="bold" aria-hidden />
             : <IconTrendDown size={16} weight="bold" aria-hidden />}
  {delta > 0 ? '+' : ''}{delta}kg {t('train.vsLast')}
</span>
```

- [ ] **Step 6: Swap card classes and add the commit animation**

In `ExerciseBlock`, replace the `cardClass` computation:

```tsx
const state = isActive ? 'active' : isUpNext ? 'muted' : undefined;
```

and the wrapper:

```tsx
<div className="panel stack" data-state={state}>
```

Wrap each logged set row so a newly-committed set flashes. Track the most recent set id:

```tsx
const [justLogged, setJustLogged] = useState<string | null>(null);
```

pass `{ onSuccess: (created) => setJustLogged(created.id) }` to the existing
`logSet.mutate(input)` call, and give the row
`className={s.id === justLogged ? 'row set-committed' : 'row'}`.

> Check the return type of `useLogSet` in `app/src/lib/train.ts` first. If the mutation does
> not resolve to the created set, use `we.sets[we.sets.length - 1]?.id` in an effect keyed on
> `we.sets.length` instead. Do not change the hook's signature for this.

- [ ] **Step 7: Enlarge the set-logging controls**

In `app/src/components/SetInputRow.tsx`, add `btn-lg` to the submit button's className and
`btn-lg` to any stepper buttons, keeping their existing labels and handlers untouched.

- [ ] **Step 8: Run tests**

Run: `npm test -w app -- SessionPage SetInputRow`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/SessionPage.tsx app/src/pages/SessionPage.test.tsx app/src/components/SetInputRow.tsx
git commit -m "feat: sticky session header, icon controls, 48px logging targets"
```

---

### Task 9: TrainPage recomposition

**Files:**
- Modify: `app/src/pages/TrainPage.tsx`
- Modify: `app/src/pages/TrainPage.test.tsx`

**Interfaces:**
- Consumes: `.block-accent`, `.panel`, `.label`, `.chip`, `.btn-lg` (Task 4); `IconEdit`,
  `IconPlus` (Task 5).

- [ ] **Step 1: Write the failing test**

Add to `app/src/pages/TrainPage.test.tsx`:

```tsx
it('uses at most two labels', () => {
  renderTrain(); // existing helper
  expect(document.querySelectorAll('.label').length).toBeLessThanOrEqual(2);
});

it('has no uppercase section titles left', () => {
  renderTrain();
  expect(document.querySelectorAll('.section-title, .eyebrow').length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- TrainPage`
Expected: FAIL - three `.section-title` and one `.eyebrow` present.

- [ ] **Step 3: Replace the active-workout card with the accent block**

```tsx
{active && (
  <Link to="/train/session" className="block-accent">
    <strong style={{ fontSize: 'var(--fs-title)' }}>{t('train.resume')}</strong>
    <div className="muted">
      {t('train.startedAt')} {new Date(active.startedAt).toLocaleTimeString()}
    </div>
  </Link>
)}
```

- [ ] **Step 4: Make the start actions a 2-up grid**

Replace the wrapped button row (:47-60):

```tsx
<div className="label">{t('train.start')}</div>
<div style={{ display: 'grid', gridTemplateColumns: lastWorkoutId ? '1fr 1fr' : '1fr', gap: 'var(--sp-3)' }}>
  <button className="btn btn-primary btn-lg" onClick={() => begin({})} disabled={start.isPending}>
    {t('train.empty')}
  </button>
  {lastWorkoutId && (
    <button className="btn btn-secondary btn-lg" onClick={() => begin({ copyFromWorkoutId: lastWorkoutId })} disabled={start.isPending}>
      {t('train.repeatLast')}
    </button>
  )}
</div>
```

- [ ] **Step 5: Retokenise the template and recent lists**

Templates: change `glow-card row` to `panel row`, and render the exercise count as a chip
rather than a middle-dot run:

```tsx
<div key={tpl.id} className="panel row" style={{ justifyContent: 'space-between' }}>
  <button
    className="btn btn-ghost"
    style={{ flex: 1, justifyContent: 'flex-start' }}
    onClick={() => begin({ templateId: tpl.id })}
    disabled={start.isPending}
  >
    <strong>{tpl.name}</strong>
    <span className="chip">{tpl.templateExercises.length}</span>
  </button>
  <Link className="btn btn-ghost btn-icon" to={`/train/templates/${tpl.id}`} aria-label={t('common.edit')}>
    <IconEdit size={20} weight="bold" aria-hidden />
  </Link>
</div>
```

Recent workouts: change `glow-card tappable` to `panel tappable`, drop the `—` separator at
:102, and set the count in tabular figures:

```tsx
<div className="muted">
  {(locale === 'ja' ? w.exerciseNamesJa : w.exerciseNames).join(', ')}
  {' '}<span className="metric" style={{ fontSize: 'var(--fs-label)' }}>{w.setCount}</span>
  {' '}{t('train.sets')}
</div>
```

Replace the remaining two `.section-title` divs with `.label`, and replace the trailing
`→` at :110 with nothing (the link text is enough) or `IconNext`.

- [ ] **Step 6: Run tests**

Run: `npm test -w app -- TrainPage`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/TrainPage.tsx app/src/pages/TrainPage.test.tsx
git commit -m "feat: recompose Train with accent block and 2-up start actions"
```

---

### Task 10: HealthPage recomposition

**Files:**
- Modify: `app/src/pages/HealthPage.tsx`
- Modify: `app/src/pages/HealthPage.test.tsx`

**Interfaces:**
- Consumes: `.panel`, `.metric*`, `.label` (Task 4); `IconPrev`, `IconNext` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
it('renders caret icons rather than glyph characters for day navigation', () => {
  renderHealth(); // existing helper
  expect(document.body.textContent ?? '').not.toMatch(/[▶◀▸◂]/u);
  expect(screen.getByRole('button', { name: 'next-day' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- HealthPage`
Expected: FAIL - `▶` present.

- [ ] **Step 3: Replace the day-nav glyphs**

At :144-151 and its `prev-day` counterpart. Keep the `aria-label` values verbatim; existing
tests query them.

```tsx
<button className="btn btn-ghost btn-icon" aria-label="prev-day" onClick={() => setSelectedDate((d) => addDays(d, -1))}>
  <IconPrev size={20} weight="bold" aria-hidden />
</button>
```
```tsx
<button className="btn btn-ghost btn-icon" aria-label="next-day" onClick={() => setSelectedDate((d) => addDays(d, 1))}>
  <IconNext size={20} weight="bold" aria-hidden />
</button>
```

- [ ] **Step 4: Make the daily total match Today's hero treatment**

Replace the daily-total card (:154-175):

```tsx
<div className="panel" data-state="active" style={{ marginBottom: 'var(--sp-4)' }}>
  <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
    <span className="metric metric-x">{totalKcal.toLocaleString()}</span>
    <span className="metric-unit">
      {me?.targetKcal != null ? `/ ${me.targetKcal.toLocaleString()} ` : ''}
      {t('health.calories')}
    </span>
  </div>
  <KcalBar value={totalKcal} target={me?.targetKcal} />
  <MacroBars
    proteinG={totalProtein} fatG={totalFat} carbsG={totalCarbs}
    targetProteinG={me?.targetProteinG} targetFatG={me?.targetFatG} targetCarbsG={me?.targetCarbsG}
  />
</div>
```

The `.eyebrow` at :156 is dropped: the hero number states what it is, matching Today.

- [ ] **Step 5: Retokenise the remaining classes**

Replace every `.section-title` with `.label`, `.card`/`.glow-card` with `.panel`, and the
`.eyebrow` at :317 with `.label`. Give the meal-row time and kcal values `className="metric"`
with `fontSize: 'var(--fs-label)'` so columns align.

`KcalBar` at :54 and `MacroBars` at :27 use `transition: 'width 0.2s'` inline. Replace with
`transition: 'width var(--dur-base) var(--ease)'` and confirm the reduced-motion gate: since
these are inline styles they are not covered by the media query in `base.css`. Move the bar
fill styling into a `.bar-fill` class in `base.css` under the existing
`@media (prefers-reduced-motion: no-preference)` block and apply the class instead.

- [ ] **Step 6: Run tests**

Run: `npm test -w app -- HealthPage`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/HealthPage.tsx app/src/pages/HealthPage.test.tsx \
        app/src/components/MacroBars.tsx app/src/styles/base.css
git commit -m "feat: recompose Health with hero total and caret day navigation"
```

---

### Task 11: TrendsPage recomposition and real chart legends

**Files:**
- Modify: `app/src/pages/TrendsPage.tsx`
- Create: `app/src/components/charts/LegendSwatch.tsx`
- Modify: `app/src/components/charts/LineChart.tsx`
- Modify: `app/src/components/charts/Sparkline.tsx`
- Modify: `app/src/pages/TrendsPage.test.tsx`

**Interfaces:**
- Consumes: `.panel`, `.segmented`, `.chip`, `.grid-2` (Task 4).
- Produces: `LegendSwatch({ stroke, dashed, label }: { stroke: string; dashed: boolean; label: string })`.

**Before starting:** load the `dataviz` skill. Chart colour and mark decisions follow it
rather than being improvised here.

- [ ] **Step 1: Write the failing test**

```tsx
it('renders legend swatches rather than text dashes', () => {
  renderTrends(); // existing helper
  expect(document.body.textContent ?? '').not.toMatch(/[—]|- -/);
  expect(document.querySelectorAll('.legend-swatch').length).toBeGreaterThan(0);
});

it('renders the range picker as a segmented control', () => {
  renderTrends();
  expect(document.querySelector('.segmented')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- TrendsPage`
Expected: FAIL - `— top set` and `- - est 1RM` present, no `.segmented`.

- [ ] **Step 3: Build the legend swatch**

Create `app/src/components/charts/LegendSwatch.tsx`:

```tsx
/**
 * Draws the actual stroke and dash pattern it describes. The previous legend used
 * a text em-dash and two hyphens, which matched no real stroke at any zoom level.
 */
export function LegendSwatch({
  stroke,
  dashed,
  label,
}: {
  stroke: string;
  dashed: boolean;
  label: string;
}) {
  return (
    <span className="row legend-swatch" style={{ gap: 'var(--sp-2)' }}>
      <svg width="20" height="8" aria-hidden focusable="false">
        <line
          x1="0" y1="4" x2="20" y2="4"
          stroke={stroke} strokeWidth="2"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      </svg>
      <span className="muted">{label}</span>
    </span>
  );
}
```

- [ ] **Step 4: Replace both legend blocks**

At :236-239:

```tsx
<div className="row" style={{ gap: 'var(--sp-4)', marginTop: 'var(--sp-2)' }}>
  <LegendSwatch stroke="var(--accent-ink)" dashed={false} label={t('trends.topSet')} />
  <LegendSwatch stroke="var(--text-muted)" dashed label={t('trends.est1rm')} />
</div>
```

At :305-314:

```tsx
<div className="row" style={{ gap: 'var(--sp-4)', marginTop: 'var(--sp-2)' }}>
  <LegendSwatch
    stroke="var(--accent-ink)" dashed={false}
    label={`${t('trends.kcalPerDay')}${nutritionBodySeries.lastKcal !== null ? ` ${nutritionBodySeries.lastKcal}` : ''}`}
  />
  <LegendSwatch
    stroke="var(--positive)" dashed
    label={`${t('trends.weightLine')}${nutritionBodySeries.lastWeight !== null ? ` ${nutritionBodySeries.lastWeight}kg` : ''}`}
  />
</div>
```

Change the `LineChart` series strokes from `var(--accent)` to `var(--accent-ink)` at :300 so
they survive light mode, and do the same for any stroke default inside `LineChart.tsx` and
`Sparkline.tsx`.

- [ ] **Step 5: Replace the range picker with a segmented control**

At :196-206:

```tsx
<div className="segmented" role="group" aria-label={t('trends.range')}>
  {RANGES.map((r) => (
    <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
      {t(`trends.range.${r}`)}
    </button>
  ))}
</div>
```

> `RANGES` is the existing array in this file; keep its name and contents. Add a
> `'trends.range'` key to both catalogues for the group label if it does not exist.

- [ ] **Step 6: Unnest the sections**

The four sections are `.glow-card` wrappers each containing a `.section-title`, which is a
card inside a card. Replace each wrapper with a plain `<section>` separated by a hairline,
and wrap the four in the desktop grid:

```tsx
<div className="grid-2">
  <section style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-4)', marginBottom: 'var(--sp-5)' }}>
    <div className="label">{t('trends.strength')}</div>
    {/* existing body unchanged */}
  </section>
  {/* ...the other three, same shape... */}
</div>
```

Bar fills at :261-269 and :333-341 keep their inline geometry but take their colour from
`var(--accent)`; move the transition into the `.bar-fill` class added in Task 10.

- [ ] **Step 7: Run tests**

Run: `npm test -w app -- TrendsPage`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/TrendsPage.tsx app/src/pages/TrendsPage.test.tsx \
        app/src/components/charts/
git commit -m "feat: recompose Trends with real legend swatches and desktop grid"
```

---

### Task 12: Split SettingsPage and add the theme control

**Files:**
- Create: `app/src/pages/settings/AppearanceSection.tsx`
- Create: `app/src/pages/settings/TargetsSection.tsx`
- Create: `app/src/pages/settings/AiKeysSection.tsx`
- Create: `app/src/pages/settings/HealthSyncSection.tsx`
- Create: `app/src/pages/settings/ConnectorSection.tsx`
- Create: `app/src/pages/settings/DataSection.tsx`
- Modify: `app/src/pages/SettingsPage.tsx` (becomes a shell)
- Modify: `app/src/SettingsPage.test.tsx`, `app/src/AiSettings.test.tsx`, `app/src/ConnectorSettings.test.tsx`

**Interfaces:**
- Consumes: `.panel`, `.segmented`, `.field`, `.label` (Task 4); `Theme` and `THEMES` (Task 1).
- Produces: six section components, each a default-free named export taking no props and
  owning its own hooks.

627 lines and 44 inline style objects mixing six unrelated concerns. This is the hardest file
in the app to change safely; the split is structural, not cosmetic.

- [ ] **Step 1: Read the file and map the section boundaries**

Run: `grep -n 'Section\|<h2\|section-title\|{/\*' app/src/pages/SettingsPage.tsx`

Record which line ranges belong to appearance (locale, theme, unit, timezone), targets
(kcal, protein, fat, carbs), AI keys, Apple Health (:470 onward, native-only), the MCP
connector, and data (export, delete). Move each range verbatim into its own file, carrying
its hooks with it. Behaviour must not change in this step.

- [ ] **Step 2: Write the failing test for the theme control**

Add to `app/src/SettingsPage.test.tsx`:

```tsx
it('offers the three theme modes', async () => {
  renderSettings(); // existing helper
  const group = screen.getByRole('group', { name: /theme/i });
  for (const name of [/dark/i, /light/i, /system/i]) {
    expect(within(group).getByRole('button', { name })).toBeInTheDocument();
  }
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -w app -- SettingsPage`
Expected: FAIL - no group named theme.

- [ ] **Step 4: Build the appearance section**

Create `app/src/pages/settings/AppearanceSection.tsx`:

```tsx
import { THEMES, type Theme } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../../i18n';
import { useMe, useUpdateMe } from '../../lib/useMe';
import { applyTheme } from '../../theme/ThemeProvider';

export function AppearanceSection() {
  const { t } = useI18n();
  const { data: me } = useMe();
  const update = useUpdateMe();

  const setTheme = (theme: Theme) => {
    applyTheme(theme); // paint immediately; the mutation persists it
    update.mutate({ theme });
  };

  return (
    <section className="panel stack">
      <h2 className="label">{t('settings.appearance')}</h2>

      <div className="field">
        <span className="label">{t('settings.theme')}</span>
        <div className="segmented" role="group" aria-label={t('settings.theme')}>
          {THEMES.map((theme) => (
            <button
              key={theme}
              aria-pressed={me?.theme === theme}
              onClick={() => setTheme(theme)}
            >
              {t(`settings.theme.${theme}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>

      {/* locale, unit and timezone controls move here verbatim from SettingsPage */}
    </section>
  );
}
```

Add to both catalogues:
```ts
'settings.theme.dark': 'Dark',    // ja: 'ダーク'
'settings.theme.light': 'Light',  // ja: 'ライト'
'settings.theme.system': 'System',// ja: 'システム'
```

> Confirm the mutation hook's real name in `app/src/lib/useMe.ts` before writing
> `useUpdateMe`; the file may expose it under a different name.

- [ ] **Step 5: Create the other five sections**

Move each recorded range into its own file with the same pattern: a named export, a
`<section className="panel stack">` wrapper, an `<h2 className="label">` heading, and the
hooks that range used. Replace inline style objects with tokens and `.field` as you go.
Do not change any handler, endpoint, or field name - `SettingsPage` form field names are
load-bearing for analytics and autofill.

- [ ] **Step 6: Reduce SettingsPage to a shell**

```tsx
import { useI18n } from '../i18n';
import { AppearanceSection } from './settings/AppearanceSection';
import { TargetsSection } from './settings/TargetsSection';
import { AiKeysSection } from './settings/AiKeysSection';
import { HealthSyncSection } from './settings/HealthSyncSection';
import { ConnectorSection } from './settings/ConnectorSection';
import { DataSection } from './settings/DataSection';

export function SettingsPage() {
  const { t } = useI18n();
  return (
    <section className="stack" aria-label={t('nav.settings')}>
      <h1>{t('nav.settings')}</h1>
      <AppearanceSection />
      <TargetsSection />
      <AiKeysSection />
      <HealthSyncSection />
      <ConnectorSection />
      <DataSection />
    </section>
  );
}
```

`HealthSyncSection` keeps its existing native-only guard internally (`isNativeShell()`), so
the shell stays unconditional.

- [ ] **Step 7: Run the settings suites**

Run: `npm test -w app -- SettingsPage AiSettings ConnectorSettings`
Expected: PASS. These suites query by label and role, so they should survive the move; where
one breaks on a changed class name, update the query rather than the markup.

- [ ] **Step 8: Commit**

```bash
git add app/src/pages/SettingsPage.tsx app/src/pages/settings/ app/src/i18n \
        app/src/SettingsPage.test.tsx app/src/AiSettings.test.tsx app/src/ConnectorSettings.test.tsx
git commit -m "refactor: split SettingsPage into six sections and add theme control"
```

---

### Task 13: Login and the remaining re-skins

**Files:**
- Modify: `app/src/pages/LoginPage.tsx`
- Modify: `app/src/pages/WorkoutDetailPage.tsx`
- Modify: `app/src/pages/ExerciseHistoryPage.tsx`
- Modify: `app/src/pages/ExercisesPage.tsx`
- Modify: `app/src/pages/TemplateEditorPage.tsx`
- Modify: `app/src/pages/PrivacyPage.tsx`
- Modify: `app/src/components/OnboardingWizard.tsx`
- Modify: `app/src/components/MealFormSheet.tsx:173`
- Modify: `app/src/components/SleepFormSheet.tsx`
- Modify: `app/src/components/MeasurementFormSheet.tsx`
- Modify: `app/src/components/ExercisePicker.tsx`
- Modify: `app/src/components/OfflineIndicator.tsx`
- Modify: `app/src/components/PendingBadge.tsx`

**Interfaces:**
- Consumes: everything from Tasks 4 and 5.
- Produces: nothing.

These layouts are sound; they move onto the new tokens without recomposition.

- [ ] **Step 1: Write the failing repo-wide test**

Create `app/src/styles/no-legacy-classes.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
  });
}

const files = tsxFiles(src);

describe('legacy design system', () => {
  it.each([
    ['glow-card', /className=["'`][^"'`]*\bglow-card\b/],
    ['card (superseded by panel)', /className=["'`][^"'`]*\bcard\b(?![-\w])/],
    ['eyebrow', /className=["'`][^"'`]*\beyebrow\b/],
    ['section-title', /className=["'`][^"'`]*\bsection-title\b/],
  ])('no file still uses %s', (_label, pattern) => {
    const offenders = files.filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(src, 'src'))).toEqual([]);
  });

  it('no product source contains emoji', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    const offenders = files.filter((f) => emoji.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => f.replace(src, 'src'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w app -- no-legacy-classes`
Expected: FAIL - listing every file in this task's Files block.

- [ ] **Step 3: Retokenise LoginPage**

Move the inline style objects to classes. The centred composition is correct here and stays.

```tsx
export function LoginPage() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // handleNativeSignIn is unchanged, including the 'canceled' branch at :38-44.

  return (
    <main className="login-main">
      <h1 className="login-title">{t('app.name')}</h1>
      <p className="muted" style={{ maxWidth: '40ch' }}>{t('login.welcome')}</p>
      {isNativeShell() ? (
        <button type="button" className="btn btn-primary btn-lg" onClick={handleNativeSignIn} disabled={busy}>
          {t('login.signIn')}
        </button>
      ) : (
        <a className="btn btn-primary btn-lg" href="/auth/google">{t('login.signIn')}</a>
      )}
      {error && <p className="error-text" style={{ maxWidth: '40ch' }}>{error}</p>}
      <Link className="muted" to="/privacy">{t('privacy.link')}</Link>
    </main>
  );
}
```

Add to `base.css`:

```css
.login-main {
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-4);
  padding: var(--sp-5);
  text-align: center;
}

.login-title {
  font-size: var(--fs-metric-l);
  letter-spacing: -0.02em;
}
```

- [ ] **Step 4: Replace the sparkle emoji**

In `app/src/components/MealFormSheet.tsx:173`:

```tsx
{estimateMeal.isPending ? (
  t('ai.estimating')
) : (
  <><IconSparkle size={18} weight="fill" aria-hidden /> {t('ai.estimate')}</>
)}
```

- [ ] **Step 5: Sweep the remaining files**

In each remaining file: `glow-card` and `card` become `panel`, `eyebrow` and `section-title`
become `label`, inline colour and spacing literals become tokens, and any glyph character
used as a control becomes the matching icon from `components/icons.ts`. Do not change
handlers, hooks, endpoints, `aria-label` values, or form field names.

- [ ] **Step 6: Run the full suite**

Run: `npm test -w app`
Expected: PASS, including `no-legacy-classes`.

- [ ] **Step 7: Commit**

```bash
git add app/src
git commit -m "refactor: move remaining screens and sheets onto the token system"
```

---

### Task 14: Verification and cleanup

**Files:**
- Modify: `CLAUDE.md`
- Possibly modify: any file the checks flag

**Interfaces:**
- Consumes: everything.
- Produces: a verified branch ready for a PR.

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: PASS across `shared`, `worker` and `app`. Do not proceed past a failure; fix it.

- [ ] **Step 2: Run the E2E specs**

Run: `npm run test:e2e`
Expected: 3 specs PASS.

> Confirm the script name in the root `package.json` first. E2E needs `E2E_TEST_LOGIN` and
> the local D1 with the Task 1 migration applied.

- [ ] **Step 3: Re-run the slop scanner**

Run:
```bash
node ~/.claude/skills/kill-ai-slop/scripts/scan.mjs app
```
Expected: far below the 29-hit baseline. The remaining legitimate hits are
`border-radius: 50%` on the FAB (documented shape rule) and the skeleton shimmer transition
(the one sanctioned loop). Pin both in source so future scans stay clean:

```css
/* deslop-ignore-next-line 19 - the FAB is the single full-round element, per the shape rule */
border-radius: 50%;
```

Any other hit is either fixed or reported with a reason. Do not silence a hit you have not
read.

- [ ] **Step 4: Verify the contrast test still guards both modes**

Run: `npm test -w app -- tokens.contrast`
Expected: PASS, 34 assertions.

- [ ] **Step 5: Visual pass in both modes**

Run: `npm run dev`

Check at a 390x844 mobile viewport and at 1440 wide, in dark, light, and system:
- Today: one accent block, hero numeral, 2-up secondaries, at most two labels
- Session: header stays pinned while scrolling; logging a set flashes the row and advances the ring
- Train, Health, Trends, Settings, Login
- Tab through every screen and confirm the focus ring is visible in both modes
- Set the OS to light while `system` is selected and confirm the app follows without reload
- Enable Reduce Motion at the OS level and confirm animations stop, shimmer included

A passing scan is not the same as a better screen. This step is not optional.

- [ ] **Step 6: Update CLAUDE.md**

Replace the theming line in the Current Status section:

```markdown
- **Design overhaul shipped**: one Athletic design language rendered dark / light / system
  (replacing Gym Dark / Clinical Light / Warm Journal). Two-layer CSS tokens in
  `app/src/styles/tokens.css` (raw `--p-<mode>-*` palette, semantic mapping per theme),
  guarded by `app/src/styles/tokens.contrast.test.ts` which fails the build if any pair
  drops below WCAG AA. Archivo subset for numerals only (`--font-metric`); Phosphor icons
  via `app/src/components/icons.ts`. Active state is fill plus edge, never glow.
```

- [ ] **Step 7: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: record the design overhaul in CLAUDE.md"
git push -u origin worktree-update-design
gh pr create --title "feat: design overhaul - one Athletic language, dark/light/system" --body "$(cat <<'PRBODY'
Implements `docs/superpowers/specs/2026-08-13-bodyatlas-design-overhaul.md`.

Replaces three named mood themes with one design language rendered dark / light / system.
Both light themes previously shipped below WCAG AA on nearly every text pair; the new
palette clears AA on all 16 checked pairs in both modes, and a committed contrast test
keeps it that way.

Also: Phosphor icons replacing 11 emoji, Archivo scoped to numerals so EN and JA stay
consistent, a type/space/shape scale replacing ~200 ad-hoc inline styles, focus states
where there were none, fill-and-edge active states in place of the outer glow, and
SettingsPage split from 627 lines into six sections.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_015AYubcZqeCYsoJSDdDYhaR
PRBODY
)"
```

---

## Self-Review

**Spec coverage.** Theme model → Task 1. Colour tokens + contrast test → Task 2. Typography,
space, shape, motion tokens + Archivo → Task 3. Components, controls, focus, `.chip` → Task 4.
Icons → Task 5. Copy + empty-value fix → Task 6. Today → 7. Session → 8. Train → 9. Health →
10. Trends + legends → 11. Settings split → 12. Login + re-skins → 13. Verification,
`CLAUDE.md`, PR → 14. Every spec section maps to a task.

**Known gaps, deliberately left:** the spec's `--fs-metric-l` step is defined in Task 3 and
used only by `.login-title` in Task 13; that is a scale step, not dead code. `LineChart` and
`Sparkline` receive stroke-token changes in Task 11 but are not otherwise recomposed, matching
the spec's "re-skinned without recomposition" list.

**Type consistency.** `Theme` is `'dark'|'light'|'system'` from Task 1 onward and is used with
that spelling in Tasks 2 and 12. `resolveTheme` is defined once (Task 1) and referenced
nowhere else, which is correct: CSS keys `system` off `prefers-color-scheme` directly, so the
helper exists for chart and meta-theme-colour consumers. Icon names in Task 5's `icons.ts`
match every consuming import in Tasks 7-13. `LegendSwatch`'s signature in Task 11 matches both
call sites.

**Verification-first ordering.** Tasks 2, 6 and 13 write a guard test before the change it
guards, so a regression in a later task fails loudly rather than silently.
