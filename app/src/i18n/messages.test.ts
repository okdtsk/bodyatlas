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
