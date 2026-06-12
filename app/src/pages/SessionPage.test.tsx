import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { SessionPage } from './SessionPage';

const activeWorkout = {
  id: 'w1',
  startedAt: '2026-06-12T10:00:00Z',
  endedAt: null,
  notes: null,
  templateId: null,
  workoutExercises: [
    {
      id: 'we1',
      position: 1,
      notes: null,
      targetSets: 3,
      exercise: {
        id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength',
        muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null,
      },
      sets: [
        { id: 's1', position: 1, weightKg: 80, reps: 8, rpe: null, durationSec: null, distanceM: null, note: 'フォーム良し' },
      ],
    },
  ],
};

function renderSession() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/train/session']}>
          <Routes>
            <Route path="/train/session" element={<SessionPage />} />
            <Route path="/train" element={<div>TRAIN HOME</div>} />
            <Route path="/train/workouts/:id" element={<div>DETAIL</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('SessionPage', () => {
  it('renders the active workout with delta line and logged sets', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: activeWorkout },
      'GET /api/exercises/e1/last-sets': {
        workoutId: 'w0',
        startedAt: '2026-06-05T10:00:00Z',
        sets: [{ id: 'p1', position: 1, weightKg: 77.5, reps: 8, rpe: null, durationSec: null, distanceM: null }],
      },
    });
    renderSession();
    expect(await screen.findByText('Bench Press')).toBeInTheDocument();
    // delta line replaces ghost when delta is non-null and non-zero (80 - 77.5 = +2.5)
    expect(await screen.findByText(/\+2\.5kg/)).toBeInTheDocument();
    expect(screen.getByText(/80kg × 8/)).toBeInTheDocument(); // logged set
  });

  it('renders pips with aria-label 1/3 and the set note', async () => {
    mockApi({
      'GET /api/workouts/active': { workout: activeWorkout },
      'GET /api/exercises/e1/last-sets': null,
    });
    renderSession();
    await screen.findByText('Bench Press');
    // Pips: 1 set done out of 3 planned (may appear on ring and/or pips)
    const labeled = screen.getAllByLabelText('1/3');
    expect(labeled.length).toBeGreaterThan(0);
    // Set note rendered
    expect(screen.getByText('フォーム良し')).toBeInTheDocument();
  });

  it('logs a set with the typed values', async () => {
    const spy = mockApi({
      'GET /api/workouts/active': { workout: activeWorkout },
      'GET /api/exercises/e1/last-sets': null,
      'POST /api/workouts/w1/exercises/we1/sets': {
        id: 's2', position: 2, weightKg: 82.5, reps: 6, rpe: null, durationSec: null, distanceM: null,
      },
    });
    renderSession();
    await screen.findByText('Bench Press');
    await userEvent.type(screen.getByLabelText('kg'), '82.5');
    await userEvent.type(screen.getByLabelText('reps'), '6');
    await userEvent.click(screen.getByRole('button', { name: 'Log set' }));
    await waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({ weightKg: 82.5, reps: 6 });
    });
  });

  it('redirects to /train when nothing is active', async () => {
    mockApi({ 'GET /api/workouts/active': { workout: null } });
    renderSession();
    expect(await screen.findByText('TRAIN HOME')).toBeInTheDocument();
  });
});
