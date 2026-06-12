import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { TodayPage } from './TodayPage';

const me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  locale: 'en',
  theme: 'gym-dark',
  unit: 'kg',
  timezone: 'UTC',
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbsG: 200,
};

const todayIso = new Date().toISOString().slice(0, 10);

const meal1 = {
  id: 'm1',
  userId: 'u1',
  name: 'Oatmeal',
  eatenAt: `${todayIso}T08:00:00.000Z`,
  calories: 350,
  proteinG: 12,
  fatG: 6,
  carbsG: 60,
  notes: null,
  isFavorite: false,
};

const meal2 = {
  id: 'm2',
  userId: 'u1',
  name: 'Chicken Rice',
  eatenAt: `${todayIso}T13:00:00.000Z`,
  calories: 650,
  proteinG: 45,
  fatG: 8,
  carbsG: 80,
  notes: null,
  isFavorite: false,
};

const measurement1 = {
  id: 'ms1',
  userId: 'u1',
  weightKg: 73.5,
  bodyFatPct: null,
  measuredAt: `${todayIso}T07:00:00.000Z`,
};

const measurement2 = {
  id: 'ms2',
  userId: 'u1',
  weightKg: 73.2,
  bodyFatPct: null,
  measuredAt: new Date(Date.now() - 7 * 86400000).toISOString(),
};

// Yesterday 22:00 to today 06:30 = 8h 30m
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const sleep1 = {
  id: 'sl1',
  userId: 'u1',
  bedAt: `${yesterday}T22:00:00.000Z`,
  wokeAt: `${todayIso}T06:30:00.000Z`,
  quality: 4,
  notes: null,
};

// A workout that ended today
const workoutToday = {
  id: 'w-today',
  startedAt: `${todayIso}T10:00:00.000Z`,
  endedAt: `${todayIso}T11:00:00.000Z`,
  exerciseNames: ['Barbell Bench Press'],
  exerciseNamesJa: ['バーベルベンチプレス'],
  setCount: 6,
};

function renderToday() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['me'], me);
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter>
          <TodayPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('TodayPage', () => {
  it('renders all four cards with full data: kcal sum, done workout, weight, sleep duration', async () => {
    mockApi({
      'GET /api/meals': [meal1, meal2],
      'GET /api/workouts/active': { workout: null },
      'GET /api/workouts': [workoutToday],
      'GET /api/measurements': [measurement2, measurement1],
      'GET /api/sleep': [sleep1],
    });
    renderToday();

    // Nutrition card: 350 + 650 = 1000 kcal
    expect(await screen.findByText(/1,?000/)).toBeInTheDocument();

    // Workout card: done today -> show checkmark + done
    expect(screen.getByText(/Done/i)).toBeInTheDocument();

    // Weight card: latest weight (73.5 kg)
    expect(screen.getByText('73.5')).toBeInTheDocument();

    // Sleep card: 8h 30m duration (22:00 -> 06:30 = 8h30m)
    expect(screen.getByText(/8h 30m/)).toBeInTheDocument();
  });

  it('shows rest day and empty states when no workout, no weight, no sleep today', async () => {
    mockApi({
      'GET /api/meals': [],
      'GET /api/workouts/active': { workout: null },
      'GET /api/workouts': [],
      'GET /api/measurements': [],
      'GET /api/sleep': [],
    });
    renderToday();

    // Rest day message
    expect(await screen.findByText(/Rest day/i)).toBeInTheDocument();

    // No weight logged
    expect(screen.getByText(/No weight logged yet/i)).toBeInTheDocument();

    // No sleep logged
    expect(screen.getByText(/No sleep logged/i)).toBeInTheDocument();
  });
});
