import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { TrendsPage } from './TrendsPage';

const me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  locale: 'en',
  theme: 'dark',
  unit: 'kg',
  timezone: 'UTC',
  targetKcal: null,
  targetProteinG: null,
  targetFatG: null,
  targetCarbsG: null,
};

const exercises = [
  {
    id: 'ex-bench',
    nameEn: 'Barbell Bench Press',
    nameJa: 'バーベルベンチプレス',
    muscleGroup: 'chest',
    equipmentType: 'barbell',
    exerciseType: 'strength',
    isArchived: false,
    isCustom: false,
  },
  {
    id: 'ex-squat',
    nameEn: 'Back Squat',
    nameJa: 'バックスクワット',
    muscleGroup: 'legs',
    equipmentType: 'barbell',
    exerciseType: 'strength',
    isArchived: false,
    isCustom: false,
  },
];

function renderTrends() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], me);
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter>
          <TrendsPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  try {
    localStorage.removeItem('ba_trend_exercise');
  } catch {
    // localStorage may not be available in test environment
  }
});

describe('TrendsPage', () => {
  it('range chip switches refetch with a smaller from window', async () => {
    const user = userEvent.setup();
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'GET /api/trends/volume': [],
      'GET /api/trends/nutrition-body': { meals: [], measurements: [] },
      'GET /api/sleep': [],
    });
    renderTrends();

    // Wait for initial render to settle (default 12w range)
    await screen.findByText('12w');

    // Collect the `from` param values from all volume fetches so far
    const volumeUrlsBefore = spy.mock.calls
      .filter((c) => String(c[0]).includes('/api/trends/volume'))
      .map((c) => new URL(String(c[0]), 'http://localhost').searchParams.get('from'));

    // Switch to 4w (28 days)
    await user.click(screen.getByRole('button', { name: '4w' }));

    await waitFor(() => {
      const volumeUrlsAfter = spy.mock.calls
        .filter((c) => String(c[0]).includes('/api/trends/volume'))
        .map((c) => new URL(String(c[0]), 'http://localhost').searchParams.get('from'));

      // There should now be at least one call with the 4w from param
      expect(volumeUrlsAfter.length).toBeGreaterThan(volumeUrlsBefore.length);

      // The latest from param should be more recent (closer to now) than the 12w from param
      const latest4wFrom = new Date(volumeUrlsAfter[volumeUrlsAfter.length - 1] ?? '').getTime();
      const first12wFrom = new Date(volumeUrlsBefore[0] ?? '').getTime();
      expect(latest4wFrom).toBeGreaterThan(first12wFrom);
    });
  });

  it('strength section renders chart points after selecting an exercise', async () => {
    const user = userEvent.setup();
    const strengthPoints = [
      {
        workoutId: 'w1',
        startedAt: '2026-05-01T10:00:00Z',
        topWeightKg: 82.5,
        est1rm: 101.3,
        setCount: 2,
      },
      {
        workoutId: 'w2',
        startedAt: '2026-06-01T10:00:00Z',
        topWeightKg: 85,
        est1rm: 99.2,
        setCount: 1,
      },
    ];
    mockApi({
      'GET /api/exercises': exercises,
      'GET /api/trends/volume': [],
      'GET /api/trends/nutrition-body': { meals: [], measurements: [] },
      'GET /api/sleep': [],
      'GET /api/trends/strength/ex-bench': strengthPoints,
    });
    renderTrends();

    // Wait for exercises to load
    await screen.findByText('Barbell Bench Press');

    // Select the exercise (the exercise select has a placeholder option)
    const selects = screen.getAllByRole('combobox');
    // The exercise select is the one with the placeholder option 'Choose an exercise'
    const select = selects.find((s) => s.querySelector('option[value=""]')) ?? selects[0]!;
    await user.selectOptions(select, 'ex-bench');

    // The LineChart renders an SVG when it has data
    await waitFor(() => {
      expect(document.querySelector('svg[role="img"]')).toBeInTheDocument();
    });
  });

  it('volume section renders bars for two weekly buckets', async () => {
    // Two weeks of volume data: week of 2026-06-08 and week of 2026-06-15
    const volumeRows = [
      { startedAt: '2026-06-09T10:00:00Z', muscleGroup: 'chest', setCount: 3 },
      { startedAt: '2026-06-10T10:00:00Z', muscleGroup: 'back', setCount: 4 },
      { startedAt: '2026-06-16T10:00:00Z', muscleGroup: 'legs', setCount: 5 },
    ];
    mockApi({
      'GET /api/exercises': exercises,
      'GET /api/trends/volume': volumeRows,
      'GET /api/trends/nutrition-body': { meals: [], measurements: [] },
      'GET /api/sleep': [],
    });
    renderTrends();

    // Two week-rows should appear: 2026-06-08 and 2026-06-15
    await waitFor(() => {
      expect(screen.getByText('2026-06-08')).toBeInTheDocument();
      expect(screen.getByText('2026-06-15')).toBeInTheDocument();
    });

    // Total set counts per week: 7 and 5
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
