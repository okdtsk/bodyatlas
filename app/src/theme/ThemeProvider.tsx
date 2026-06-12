import { useEffect, type ReactNode } from 'react';
import type { Theme } from '@bodyatlas/shared';

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
    return localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
  } catch {
    return null;
  }
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
