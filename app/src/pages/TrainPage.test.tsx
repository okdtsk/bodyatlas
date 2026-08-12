import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { TrainPage } from './TrainPage';

function renderTrain() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter>
          <TrainPage />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('TrainPage', () => {
  it('shows start options and templates when no workout is active', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
      'GET /api/templates': [
        { id: 't1', name: 'Push Day A', templateExercises: [] },
      ],
      'GET /api/workouts': [],
    });
    renderTrain();
    expect(await screen.findByText('Push Day A')).toBeInTheDocument();
    expect(screen.getByText('Empty workout')).toBeInTheDocument();
    expect(screen.getByText('No workouts yet. Log your first one.')).toBeInTheDocument();
  });

  it('shows a resume card when a workout is active', async () => {
    mockApi({
      'GET /api/workouts/active': {
        workout: { id: 'w1', startedAt: '2026-06-12T10:00:00Z', endedAt: null, workoutExercises: [] },
      },
      'GET /api/templates': [],
      'GET /api/workouts': [],
    });
    renderTrain();
    expect(await screen.findByText('Resume workout')).toBeInTheDocument();
  });

  it('lists recent workouts with set counts', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
      'GET /api/templates': [],
      'GET /api/workouts': [
        {
          id: 'w1',
          startedAt: '2026-06-01T10:00:00Z',
          endedAt: '2026-06-01T11:00:00Z',
          exerciseNames: ['Back Squat'],
          exerciseNamesJa: ['バックスクワット'],
          setCount: 5,
        },
      ],
    });
    renderTrain();
    expect(await screen.findByText(/Back Squat/)).toBeInTheDocument();
    // setCount is wrapped in <strong>, so match the .muted div's full text content
    expect(screen.getByText((_, el) => el?.className === 'muted' && (el?.textContent ?? '').includes('5') && (el?.textContent ?? '').includes('sets'))).toBeInTheDocument();
  });

  it('uses at most two labels', () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
      'GET /api/templates': [],
      'GET /api/workouts': [],
    });
    renderTrain();
    expect(document.querySelectorAll('.label').length).toBeLessThanOrEqual(2);
  });

  it('has no uppercase section titles left', () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
      'GET /api/templates': [],
      'GET /api/workouts': [],
    });
    renderTrain();
    expect(document.querySelectorAll('.section-title, .eyebrow').length).toBe(0);
  });
});
