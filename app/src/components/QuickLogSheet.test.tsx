import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { QuickLogSheet } from './QuickLogSheet';

function renderSheet(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<QuickLogSheet onClose={onClose} />} />
            <Route path="/train/session" element={<div>SESSION PAGE</div>} />
          </Routes>
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('QuickLogSheet', () => {
  it('POSTs /api/workouts and navigates to /train/session when "Log a set" is clicked', async () => {
    const spy = mockApi({
      'POST /api/workouts': { id: 'w1', startedAt: '2026-06-12T10:00:00Z', endedAt: null, workoutExercises: [] },
      'GET /api/workouts/active': { workout: null },
    });
    renderSheet();
    await userEvent.click(screen.getByRole('button', { name: /Log a set/i }));
    await waitFor(() => {
      const post = spy.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post).toBeTruthy();
    });
    expect(await screen.findByText('SESSION PAGE')).toBeInTheDocument();
  });

  it('keeps meal, weight, and sleep actions disabled with comingSoon badge', () => {
    mockApi({
      'GET /api/workouts/active': { workout: null },
    });
    renderSheet();
    const mealBtn = screen.getByRole('button', { name: /Log a meal/i });
    const weightBtn = screen.getByRole('button', { name: /Log weight/i });
    const sleepBtn = screen.getByRole('button', { name: /Log sleep/i });
    expect(mealBtn).toBeDisabled();
    expect(weightBtn).toBeDisabled();
    expect(sleepBtn).toBeDisabled();
  });

  it('closes on Escape key', async () => {
    mockApi({});
    const onClose = vi.fn();
    renderSheet(onClose);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
