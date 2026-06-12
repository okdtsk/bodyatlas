import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

function mockFetchJson(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  );
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('auth gate', () => {
  it('shows the login screen when /api/me returns 401', async () => {
    mockFetchJson(401, { error: { code: 'unauthorized', message: 'x' } });
    renderApp();
    expect(await screen.findByText('Sign in with Google')).toBeInTheDocument();
  });

  it('shows the tab shell when signed in', async () => {
    mockFetchJson(200, {
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
    });
    renderApp();
    // "Today" appears in both the nav tab and the page heading, so use findAll.
    expect(await screen.findAllByText('Today')).not.toHaveLength(0);
    expect(screen.getByText('Trends')).toBeInTheDocument();
  });
});
