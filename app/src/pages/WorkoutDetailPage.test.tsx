import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { WorkoutDetailPage } from './WorkoutDetailPage';

const finished = {
  id: 'w1',
  startedAt: '2026-06-01T10:00:00Z',
  endedAt: '2026-06-01T11:00:00Z',
  notes: 'good day',
  templateId: null,
  workoutExercises: [
    {
      id: 'we1',
      position: 1,
      notes: null,
      exercise: {
        id: 'e1', nameEn: 'Deadlift', nameJa: 'デッドリフト', type: 'strength',
        muscleGroup: 'back', equipment: 'barbell', isArchived: false, userId: null,
      },
      sets: [
        { id: 's1', position: 1, weightKg: 120, reps: 5, rpe: 8, durationSec: null, distanceM: null },
      ],
    },
  ],
};

function renderDetail() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/train/workouts/w1']}>
          <Routes>
            <Route path="/train/workouts/:id" element={<WorkoutDetailPage />} />
            <Route path="/train" element={<div>TRAIN HOME</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('WorkoutDetailPage', () => {
  it('renders exercises, sets, and notes', async () => {
    mockApi({ 'GET /api/workouts/w1': finished });
    renderDetail();
    expect(await screen.findByText('Deadlift')).toBeInTheDocument();
    expect(screen.getByText(/120kg × 5 @8/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('good day')).toBeInTheDocument();
  });

  it('edits a set via PATCH with full values', async () => {
    const spy = mockApi({
      'GET /api/workouts/w1': finished,
      'PATCH /api/workouts/w1/exercises/we1/sets/s1': {
        ...finished.workoutExercises[0]!.sets[0]!, weightKg: 122.5,
      },
    });
    renderDetail();
    await userEvent.click(await screen.findByLabelText('edit-set-1'));
    const weightInput = screen.getByLabelText('kg');
    await userEvent.clear(weightInput);
    await userEvent.type(weightInput, '122.5');
    await userEvent.click(screen.getByRole('button', { name: 'Update set' }));
    await waitFor(() => {
      const patch = spy.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patch).toBeTruthy();
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ weightKg: 122.5, reps: 5, rpe: 8 });
    });
  });

  it('deletes the workout after confirm and navigates home', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true));
    mockApi({
      'GET /api/workouts/w1': finished,
      'DELETE /api/workouts/w1': { ok: true },
    });
    renderDetail();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete workout' }));
    expect(await screen.findByText('TRAIN HOME')).toBeInTheDocument();
  });
});
