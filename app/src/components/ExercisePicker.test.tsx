import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { ExercisePicker } from './ExercisePicker';

const exercises = [
  { id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength', muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null },
  { id: 'e2', nameEn: 'Back Squat', nameJa: 'バックスクワット', type: 'strength', muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: null },
];

function renderPicker(onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <ExercisePicker onSelect={onSelect} onClose={vi.fn()} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return onSelect;
}

afterEach(() => vi.unstubAllGlobals());

describe('ExercisePicker', () => {
  it('lists exercises and fires onSelect with the chosen one', async () => {
    mockApi({ 'GET /api/exercises': exercises });
    const onSelect = renderPicker();
    await userEvent.click(await screen.findByText('Bench Press'));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1' }));
  });

  it('creates a custom exercise through the inline form', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'POST /api/exercises': {
        id: 'new1', nameEn: 'Zercher Squat', nameJa: null, type: 'strength',
        muscleGroup: 'legs', equipment: 'barbell', isArchived: false, userId: 'u1',
      },
    });
    const onSelect = renderPicker();
    await userEvent.click(await screen.findByText('Create exercise'));
    await userEvent.type(screen.getByLabelText('Exercise name'), 'Zercher Squat');
    await userEvent.selectOptions(screen.getByLabelText('Muscle group'), 'legs');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'new1' })));
    const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(JSON.parse(String(post![1]!.body))).toMatchObject({ name: 'Zercher Squat', muscleGroup: 'legs' });
  });
});
