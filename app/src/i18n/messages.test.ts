import { describe, expect, it } from 'vitest';
import { en } from './en';
import { interpolate } from './index';
import { ja } from './ja';

describe('message catalogs', () => {
  it('en and ja define exactly the same keys', () => {
    expect(Object.keys(ja).sort()).toEqual(Object.keys(en).sort());
  });

  it('no message is empty', () => {
    for (const catalog of [en, ja]) {
      for (const [key, value] of Object.entries(catalog)) {
        expect(value, `empty message for ${key}`).not.toBe('');
      }
    }
  });
});

describe('interpolate', () => {
  it('substitutes a named placeholder', () => {
    expect(interpolate('"{name}" already exists.', { name: 'Back Squat' })).toBe(
      '"Back Squat" already exists.',
    );
  });

  it('substitutes every occurrence', () => {
    expect(interpolate('{a} and {a}', { a: 'x' })).toBe('x and x');
  });

  it('leaves a placeholder alone when no value is supplied', () => {
    expect(interpolate('{name} missing', {})).toBe('{name} missing');
  });

  it('returns the message unchanged when there are no vars', () => {
    expect(interpolate('plain text')).toBe('plain text');
  });
});

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
