import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './pages/SettingsPage';
import { I18nProvider } from './i18n';
import { mockApi } from './test/mockApi';
import { MealFormSheet } from './components/MealFormSheet';
import { TrendsPage } from './pages/TrendsPage';
import { MemoryRouter } from 'react-router';

const me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  locale: 'en',
  theme: 'gym-dark',
  unit: 'kg',
  timezone: 'Asia/Tokyo',
  targetKcal: null,
  targetProteinG: null,
  targetFatG: null,
  targetCarbsG: null,
};

afterEach(() => vi.unstubAllGlobals());

// SettingsPage AI section: save flow PUTs {provider, model, apiKey}
describe('SettingsPage AI section', () => {
  it('save flow PUTs provider, model, and apiKey', async () => {
    const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/api/ai/settings') {
        return new Response(JSON.stringify({ provider: null, hasKey: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'PUT' && url.pathname === '/api/ai/settings') {
        return new Response(
          JSON.stringify({ provider: 'claude', model: 'claude-opus-4-8', hasKey: true, lastReviewAt: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', spy);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['me'], me);

    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <MemoryRouter>
            <SettingsPage />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );

    // Wait for AI section to render
    await screen.findByText('AI coach');

    // Select provider 'claude'
    const providerSelect = screen.getByLabelText('Provider');
    await userEvent.selectOptions(providerSelect, 'claude');

    // Model should be prefilled with claude-opus-4-8
    const modelInput = screen.getByLabelText('Model') as HTMLInputElement;
    expect(modelInput.value).toBe('claude-opus-4-8');

    // Fill API key
    const keyInput = screen.getByLabelText('API key');
    await userEvent.clear(keyInput);
    await userEvent.type(keyInput, 'sk-ant-test-key-12345');

    // Click save
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(saveButton);

    await waitFor(() => {
      const putCall = spy.mock.calls.find(([url, init]) => {
        const u = new URL(String(url), 'http://localhost');
        return u.pathname === '/api/ai/settings' && init?.method === 'PUT';
      });
      expect(putCall).toBeTruthy();
      const body = JSON.parse(String(putCall![1]!.body));
      expect(body.provider).toBe('claude');
      expect(body.model).toBe('claude-opus-4-8');
      expect(body.apiKey).toBe('sk-ant-test-key-12345');
    });
  });
});

// MealFormSheet: ✨ estimate fills kcal
describe('MealFormSheet ✨ estimate', () => {
  it('estimate button fills the kcal field when hasKey is true', async () => {
    const estimateResult = {
      calories: 520,
      proteinG: 35,
      fatG: 18,
      carbsG: 55,
      confidence: 'high',
    };

    mockApi({
      'GET /api/meals/search': [],
      'GET /api/ai/settings': { provider: 'claude', model: 'claude-opus-4-8', hasKey: true, lastReviewAt: null },
      'POST /api/ai/estimate-meal': estimateResult,
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <MealFormSheet
            defaultDate={new Date('2026-06-12T00:00:00.000Z')}
            onClose={vi.fn()}
          />
        </I18nProvider>
      </QueryClientProvider>,
    );

    // Type a meal name
    const nameInput = screen.getByLabelText('Meal');
    await userEvent.type(nameInput, 'Chicken Salad');

    // Estimate button should appear
    const estimateButton = await screen.findByRole('button', { name: /estimate nutrition/i });
    await userEvent.click(estimateButton);

    // kcal field should be filled
    await waitFor(() => {
      const kcalInput = screen.getByLabelText('kcal') as HTMLInputElement;
      expect(kcalInput.value).toBe('520');
    });
  });
});

// TrendsPage coach card
describe('TrendsPage coach card', () => {
  function renderTrends() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['me'], me);
    return render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <MemoryRouter>
            <TrendsPage />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );
  }

  it('renders stored review text when configured and has a review', async () => {
    mockApi({
      'GET /api/exercises': [],
      'GET /api/trends/volume': [],
      'GET /api/trends/nutrition-body': { meals: [], measurements: [] },
      'GET /api/sleep': [],
      'GET /api/ai/settings': {
        provider: 'claude',
        model: 'claude-opus-4-8',
        hasKey: true,
        lastReviewAt: '2026-06-10T10:00:00.000Z',
      },
      'GET /api/ai/review': {
        review: 'Great work this week! You trained consistently.',
        generatedAt: '2026-06-10T10:00:00.000Z',
      },
    });

    renderTrends();

    await waitFor(() => {
      expect(screen.getByText('Great work this week! You trained consistently.')).toBeInTheDocument();
    });
  });

  it('generate button POSTs to /api/ai/coach-review', async () => {
    const spy = mockApi({
      'GET /api/exercises': [],
      'GET /api/trends/volume': [],
      'GET /api/trends/nutrition-body': { meals: [], measurements: [] },
      'GET /api/sleep': [],
      'GET /api/ai/settings': {
        provider: 'claude',
        model: 'claude-opus-4-8',
        hasKey: true,
        lastReviewAt: null,
      },
      'GET /api/ai/review': { review: null, generatedAt: null },
      'POST /api/ai/coach-review': {
        review: 'Your training was solid this week.',
        generatedAt: '2026-06-12T10:00:00.000Z',
      },
    });

    renderTrends();

    // Wait for the generate button
    const generateButton = await screen.findByRole('button', { name: /generate weekly review/i });
    await userEvent.click(generateButton);

    await waitFor(() => {
      const postCall = spy.mock.calls.find(([url, init]) => {
        const u = new URL(String(url), 'http://localhost');
        return u.pathname === '/api/ai/coach-review' && init?.method === 'POST';
      });
      expect(postCall).toBeTruthy();
    });
  });
});
