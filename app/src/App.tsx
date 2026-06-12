import { BrowserRouter, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { detectBrowserLocale, I18nProvider, useI18n } from './i18n';
import { useMe } from './lib/useMe';
import { HealthPage } from './pages/HealthPage';
import { LoginPage } from './pages/LoginPage';
import { SettingsPage } from './pages/SettingsPage';
import { TodayPage } from './pages/TodayPage';
import { TrainPage } from './pages/TrainPage';
import { TrendsPage } from './pages/TrendsPage';
import { storedTheme, ThemeProvider } from './theme/ThemeProvider';

function Loading() {
  const { t } = useI18n();
  return (
    <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
      {t('login.loading')}
    </div>
  );
}

export function App() {
  const { data: me, isPending } = useMe();

  const locale = me?.locale ?? detectBrowserLocale();
  const theme = me?.theme ?? storedTheme() ?? 'gym-dark';

  return (
    <I18nProvider locale={locale}>
      <ThemeProvider theme={theme}>
        {isPending ? (
          <Loading />
        ) : me === null ? (
          <LoginPage />
        ) : (
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<TodayPage />} />
                <Route path="train" element={<TrainPage />} />
                <Route path="health" element={<HealthPage />} />
                <Route path="trends" element={<TrendsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </BrowserRouter>
        )}
      </ThemeProvider>
    </I18nProvider>
  );
}
