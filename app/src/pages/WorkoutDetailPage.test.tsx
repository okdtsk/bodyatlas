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
      targetSets: 3,
      exercise: {
        id: 'e1', nameEn: 'Deadlift', nameJa: 'デッドリフト', type: 'strength',
        muscleGroup: 'back', equipment: 'barbell', isArchived: false, userId: null,
      },
      sets: [
        { id: 's1', position: 1, weightKg: 120, reps: 5, rpe: 8, durationSec: null, distanceM: null, note: 'last rep wobbly' },
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
  it('renders exercises, sets, set note, and notes', async () => {
    mockApi({ 'GET /api/workouts/w1': finished });
    renderDetail();
    expect(await screen.findByText('Deadlift')).toBeInTheDocument();
    expect(screen.getByText(/120kg × 5 @8/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('good day')).toBeInTheDocument();
    expect(screen.getByText('last rep wobbly')).toBeInTheDocument();
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
      expect(JSON.parse(String(patch![1]!.body))).toEqual({ weightKg: 122.5, reps: 5, rpe: 8, note: 'last rep wobbly' });
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

  it('edits the start time and fires PATCH with ISO startedAt', async () => {
    const spy = mockApi({
      'GET /api/workouts/w1': finished,
      'PATCH /api/workouts/w1': finished,
    });
    renderDetail();
    await screen.findByText('Deadlift');
    const startInput = screen.getByLabelText('Start time') as HTMLInputElement;
    // Change the value to a new local datetime string and blur
    const newLocalValue = '2026-06-01T09:15';
    await userEvent.clear(startInput);
    await userEvent.type(startInput, newLocalValue);
    startInput.blur();
    await waitFor(() => {
      const patch = spy.mock.calls.find(([url, init]) => init?.method === 'PATCH' && String(url).includes('/api/workouts/w1'));
      expect(patch).toBeTruthy();
      const body = JSON.parse(String(patch![1]!.body)) as { startedAt?: string };
      expect(body.startedAt).toBeDefined();
      expect(body.startedAt).toMatch(/Z$/);
      expect(new Date(body.startedAt!).getMinutes()).toBe(15);
    });
  });

  it('does not PATCH when the start time is blurred unchanged', async () => {
    const spy = mockApi({ 'GET /api/workouts/w1': finished });
    renderDetail();
    await screen.findByText('Deadlift');
    const startInput = screen.getByLabelText('Start time') as HTMLInputElement;
    startInput.focus();
    startInput.blur();
    expect(
      spy.mock.calls.find(([, init]) => init?.method === 'PATCH'),
    ).toBeUndefined();
  });
});
