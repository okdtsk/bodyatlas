import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { MealFormSheet } from './MealFormSheet';

const suggestions = [
  {
    id: 's1',
    userId: 'u1',
    name: 'Chicken Salad',
    eatenAt: '2026-06-10T12:00:00.000Z',
    calories: 480,
    proteinG: 40,
    fatG: 15,
    carbsG: 20,
    notes: null,
    isFavorite: false,
  },
  {
    id: 's2',
    userId: 'u1',
    name: 'Protein Shake',
    eatenAt: '2026-06-11T08:00:00.000Z',
    calories: 200,
    proteinG: 25,
    fatG: 3,
    carbsG: 10,
    notes: null,
    isFavorite: true,
  },
];

function renderSheet(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <MealFormSheet
          defaultDate={new Date('2026-06-12T00:00:00.000Z')}
          onClose={onClose}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('MealFormSheet', () => {
  it('typing a name shows suggestions and tapping one fills kcal', async () => {
    mockApi({
      'GET /api/meals/search': suggestions,
    });
    renderSheet();

    const nameInput = screen.getByLabelText('Meal');
    await userEvent.type(nameInput, 'Chick');

    // Suggestions appear
    expect(await screen.findByText('Chicken Salad')).toBeInTheDocument();
    expect(screen.getByText('Protein Shake')).toBeInTheDocument();

    // Tap the first suggestion
    await userEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.includes('Chicken Salad'))!);

    // kcal field should be filled with 480
    const kcalInput = screen.getByLabelText('kcal') as HTMLInputElement;
    expect(kcalInput.value).toBe('480');
  });

  it('saving fires POST with typed values', async () => {
    const spy = mockApi({
      'GET /api/meals/search': [],
      'POST /api/meals': { id: 'new-1', name: 'Oatmeal', calories: 350, proteinG: 12, fatG: 6, carbsG: 60, notes: null, isFavorite: false, userId: 'u1', eatenAt: '2026-06-12T07:00:00.000Z' },
    });
    renderSheet();

    const nameInput = screen.getByLabelText('Meal');
    await userEvent.type(nameInput, 'Oatmeal');

    const kcalInput = screen.getByLabelText('kcal');
    await userEvent.type(kcalInput, '350');

    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const postCall = spy.mock.calls.find(([url, init]) => String(url).includes('/api/meals') && init?.method === 'POST');
      expect(postCall).toBeTruthy();
      const body = JSON.parse(String(postCall![1]!.body));
      expect(body.name).toBe('Oatmeal');
      expect(body.calories).toBe(350);
    });
  });
});
