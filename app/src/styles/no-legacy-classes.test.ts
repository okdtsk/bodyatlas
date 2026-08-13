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

/**
 * Strips comments before scanning for user-visible violations, so a dash
 * mentioned inside a `//` or `/* *\/` explanation never trips the em/en-dash
 * guard below — comments are not shown to a user, only JSX text and string
 * literals are. Line comments are stripped only when the `//` is NOT part of
 * `://`, so a URL rendered as JSX text (e.g. the MCP connector card) survives
 * intact instead of being read as a comment to end-of-line.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');
}

describe('legacy design system', () => {
  it.each([
    ['glow-card', /className=["'`][^"'`]*\bglow-card\b/],
    ['card (superseded by panel)', /className=["'`][^"'`]*\bcard\b(?![-\w])/],
    // deslop-ignore-next-line 10 -- forbidden-class pattern, not an instance of the class
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

  it('no product source contains an em or en dash outside comments', () => {
    const dash = /[—–]/;
    const offenders = files.filter((f) => dash.test(stripComments(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => f.replace(src, 'src'))).toEqual([]);
  });
});
