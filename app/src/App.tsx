import { BrowserRouter, Route, Routes } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { detectBrowserLocale, I18nProvider, useI18n } from './i18n';
import { useMe } from './lib/useMe';
import { ExerciseHistoryPage } from './pages/ExerciseHistoryPage';
import { ExercisesPage } from './pages/ExercisesPage';
import { HealthPage } from './pages/HealthPage';
import { LoginPage } from './pages/LoginPage';
import { SessionPage } from './pages/SessionPage';
import { SettingsPage } from './pages/SettingsPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { TodayPage } from './pages/TodayPage';
import { TrainPage } from './pages/TrainPage';
import { TrendsPage } from './pages/TrendsPage';
import { WorkoutDetailPage } from './pages/WorkoutDetailPage';
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
                <Route path="train">
                  <Route index element={<TrainPage />} />
                  <Route path="session" element={<SessionPage />} />
                  <Route path="workouts/:id" element={<WorkoutDetailPage />} />
                  <Route path="exercises" element={<ExercisesPage />} />
                  <Route path="exercises/:id" element={<ExerciseHistoryPage />} />
                  <Route path="templates/new" element={<TemplateEditorPage />} />
                  <Route path="templates/:id" element={<TemplateEditorPage />} />
                </Route>
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
