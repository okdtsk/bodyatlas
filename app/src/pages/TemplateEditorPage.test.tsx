import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { TemplateEditorPage } from './TemplateEditorPage';

const exercises = [
  { id: 'e1', nameEn: 'Bench Press', nameJa: 'ベンチプレス', type: 'strength', muscleGroup: 'chest', equipment: 'barbell', isArchived: false, userId: null },
];

function renderEditor(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/train/templates/new" element={<TemplateEditorPage />} />
            <Route path="/train/templates/:id" element={<TemplateEditorPage />} />
            <Route path="/train" element={<div>TRAIN HOME</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('TemplateEditorPage', () => {
  it('creates a template with picked exercises', async () => {
    const spy = mockApi({
      'GET /api/exercises': exercises,
      'GET /api/templates': [],
      'POST /api/templates': { id: 't-new', name: 'Push A', templateExercises: [] },
    });
    renderEditor('/train/templates/new');
    await userEvent.type(screen.getByLabelText('Template name'), 'Push A');
    await userEvent.click(screen.getByRole('button', { name: /Add exercise/ }));
    await userEvent.click(await screen.findByText('Bench Press'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => init?.method === 'POST' && String(init?.body ?? '').includes('Push A'));
      expect(post).toBeTruthy();
      expect(JSON.parse(String(post![1]!.body))).toEqual({
        name: 'Push A',
        exercises: [{ exerciseId: 'e1' }],
      });
    });
    expect(await screen.findByText('TRAIN HOME')).toBeInTheDocument();
  });

  it('loads an existing template for editing and PUTs the replacement', async () => {
    const spy = mockApi({
      'GET /api/templates': [
        {
          id: 't1',
          name: 'Pull Day',
          templateExercises: [
            { id: 'te1', position: 1, targetSets: 3, exercise: exercises[0] },
          ],
        },
      ],
      'PUT /api/templates/t1': { id: 't1', name: 'Pull Day B', templateExercises: [] },
    });
    renderEditor('/train/templates/t1');
    const name = await screen.findByLabelText('Template name');
    expect(name).toHaveValue('Pull Day');
    await userEvent.clear(name);
    await userEvent.type(name, 'Pull Day B');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const put = spy.mock.calls.find(([, init]) => init?.method === 'PUT');
      expect(put).toBeTruthy();
      expect(JSON.parse(String(put![1]!.body))).toEqual({
        name: 'Pull Day B',
        exercises: [{ exerciseId: 'e1', targetSets: 3 }],
      });
    });
  });
});
