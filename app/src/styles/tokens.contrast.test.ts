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
  for (const m of css.matchAll(re)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

function luminance(hex: string): number {
  const ch = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
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
    expect(ratio(p[fg]!, p[bg]!)).toBeGreaterThanOrEqual(min);
  });
});
