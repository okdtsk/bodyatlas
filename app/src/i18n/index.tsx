import { createContext, useContext, type ReactNode } from 'react';
import type { Locale } from '@bodyatlas/shared';
import { en, type MessageKey } from './en';
import { ja } from './ja';

const catalogs: Record<Locale, Record<MessageKey, string>> = { en, ja };

const I18nContext = createContext<Locale>('en');

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

/** Replace `{name}` placeholders. An unsupplied placeholder is left visible rather than blanked. */
export function interpolate(message: string, vars?: Record<string, string>): string {
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? vars[key]! : match,
  );
}

export function useI18n() {
  const locale = useContext(I18nContext);
  const t = (key: MessageKey, vars?: Record<string, string>): string =>
    interpolate(catalogs[locale][key], vars);
  return { locale, t };
}

export function detectBrowserLocale(): Locale {
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export type { MessageKey };
