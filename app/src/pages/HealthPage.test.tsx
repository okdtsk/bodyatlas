import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { HealthPage } from './HealthPage';

const me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  locale: 'en',
  theme: 'dark',
  unit: 'kg',
  timezone: 'America/New_York',
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbsG: 200,
};

const meal1 = {
  id: 'm1',
  userId: 'u1',
  name: 'Chicken Salad',
  eatenAt: '2026-06-12T12:00:00.000Z',
  calories: 480,
  proteinG: 40,
  fatG: 15,
  carbsG: 20,
  notes: null,
  isFavorite: false,
};

const meal2 = {
  id: 'm2',
  userId: 'u1',
  name: 'Protein Shake',
  eatenAt: '2026-06-12T16:00:00.000Z',
  calories: 650,
  proteinG: 55,
  fatG: 10,
  carbsG: 35,
  notes: null,
  isFavorite: true,
};

function renderHealth(initialPath = '/health') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], me);
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={[initialPath]}>
          <HealthPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('HealthPage', () => {
  it('renders meals with nutrition totals', async () => {
    mockApi({
      'GET /api/meals': [meal1, meal2],
      'GET /api/sleep': [],
      'GET /api/measurements': [],
    });
    renderHealth();
    // Meal names appear
    expect(await screen.findByText('Chicken Salad')).toBeInTheDocument();
    expect(screen.getByText('Protein Shake')).toBeInTheDocument();
    // Summed kcal: 480 + 650 = 1130
    expect(screen.getByText(/1,?130/)).toBeInTheDocument();
    // Favorite marker for meal2 (accessible IconStar, not a glyph)
    expect(screen.getAllByLabelText('Favorite').length).toBeGreaterThan(0);
  });

  it('shows empty-state strings when no data for the day', async () => {
    mockApi({
      'GET /api/meals': [],
      'GET /api/sleep': [],
      'GET /api/measurements': [],
    });
    renderHealth();
    expect(await screen.findByText('No meals logged this day.')).toBeInTheDocument();
    expect(screen.getByText('No sleep logged.')).toBeInTheDocument();
    expect(screen.getByText('No measurement logged.')).toBeInTheDocument();
  });

  it('renders caret icons rather than glyph characters for day navigation', async () => {
    mockApi({
      'GET /api/meals': [],
      'GET /api/sleep': [],
      'GET /api/measurements': [],
    });
    renderHealth();
    await screen.findByText('No meals logged this day.');
    expect(document.body.textContent ?? '').not.toMatch(/[▶◀▸◂]/u);
    expect(screen.getByRole('button', { name: 'next-day' })).toBeInTheDocument();
  });

  it('clicking prev-day fetches with from one day earlier', async () => {
    const spy = mockApi({
      'GET /api/meals': [],
      'GET /api/sleep': [],
      'GET /api/measurements': [],
    });
    renderHealth();
    await screen.findByText('No meals logged this day.');

    await userEvent.click(screen.getByLabelText('prev-day'));

    await waitFor(() => {
      // Find a GET /api/meals call with a from param that is one day before today
      const mealCalls = spy.mock.calls.filter(
        ([url]) => String(url).includes('/api/meals'),
      );
      // Should have at least 2 calls (initial + after prev-day)
      expect(mealCalls.length).toBeGreaterThanOrEqual(2);
      const lastCall = mealCalls[mealCalls.length - 1];
      const url = new URL(String(lastCall![0]), 'http://localhost');
      const from = url.searchParams.get('from');
      expect(from).toBeTruthy();
      // The from date in the second call should be earlier than in the first
      const firstCallUrl = new URL(String(mealCalls[0]![0]), 'http://localhost');
      const firstFrom = firstCallUrl.searchParams.get('from');
      expect(new Date(from!).getTime()).toBeLessThan(new Date(firstFrom!).getTime());
    });
  });
});
