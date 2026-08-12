import { describe, expect, it } from 'vitest';
import { en } from './en';
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
