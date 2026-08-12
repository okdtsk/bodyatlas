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
