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
  theme: 'dark',
  unit: 'kg',
  timezone: 'UTC',
  targetKcal: 2000,
  targetProteinG: 150,
  targetFatG: 60,
  targetCarbsG: 200,
};

/** ISO instant at the given LOCAL wall-clock time, dayOffset days from today.
 *  The component judges "today" in device-local time, so fixtures must too —
 *  building instants from the UTC date string breaks when local date ≠ UTC date. */
function localAt(dayOffset: number, hours: number, minutes = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

const meal1 = {
  id: 'm1',
  userId: 'u1',
  name: 'Oatmeal',
  eatenAt: localAt(0, 8),
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
  eatenAt: localAt(0, 13),
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
  measuredAt: localAt(0, 7),
};

const measurement2 = {
  id: 'ms2',
  userId: 'u1',
  weightKg: 73.2,
  bodyFatPct: null,
  measuredAt: new Date(Date.now() - 7 * 86400000).toISOString(),
};

// Yesterday 22:00 to today 06:30 local = 8h 30m
const sleep1 = {
  id: 'sl1',
  userId: 'u1',
  bedAt: localAt(-1, 22),
  wokeAt: localAt(0, 6, 30),
  quality: 4,
  notes: null,
};

// A workout that ended today
const workoutToday = {
  id: 'w-today',
  startedAt: localAt(0, 10),
  endedAt: localAt(0, 11),
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

  it('renders the actionable block first and the calorie hero second', async () => {
    mockApi({
      'GET /api/meals': [meal1, meal2],
      'GET /api/workouts/active': { workout: null },
      'GET /api/workouts': [],
      'GET /api/measurements': [],
      'GET /api/sleep': [],
    });
    renderToday();

    await screen.findByText(/1,?000/);
    const main = screen.getByRole('region', { name: /today/i });
    const order = Array.from(main.querySelectorAll('.block-accent, .metric-x'));
    expect(order.length).toBeGreaterThanOrEqual(2);
    expect(order[0]).toHaveClass('block-accent');
    expect(order[1]).toHaveClass('metric-x');
  });

  it('uses at most two labels on the screen', async () => {
    mockApi({
      'GET /api/meals': [meal1, meal2],
      'GET /api/workouts/active': { workout: null },
      'GET /api/workouts': [workoutToday],
      'GET /api/measurements': [measurement2, measurement1],
      'GET /api/sleep': [sleep1],
    });
    renderToday();

    await screen.findByText(/1,?000/);
    expect(screen.getByRole('region', { name: /today/i }).querySelectorAll('.label').length)
      .toBeLessThanOrEqual(2);
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

    // No weight logged (waits for the measurements query to settle)
    expect(await screen.findByText(/No weight logged yet/i)).toBeInTheDocument();

    // Rest day message
    expect(screen.getByText(/Rest day/i)).toBeInTheDocument();

    // No sleep logged
    expect(screen.getByText(/No sleep logged/i)).toBeInTheDocument();
  });
});
