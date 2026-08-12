import { useEffect, type ReactNode } from 'react';
import { THEMES, type Theme } from '@bodyatlas/shared';

const THEME_STORAGE_KEY = 'ba_theme';

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage may be unavailable (private mode); the attribute alone is fine.
  }
}

export function storedTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored !== null && (THEMES as readonly string[]).includes(stored)
      ? (stored as Theme)
      : null;
  } catch {
    return null;
  }
}

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

/** Applies `theme` to <html data-theme> whenever it changes. */
export function ThemeProvider({
  theme,
  children,
}: {
  theme: Theme;
  children: ReactNode;
}) {
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  return <>{children}</>;
}
