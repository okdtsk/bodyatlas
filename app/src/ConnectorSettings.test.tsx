import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SettingsPage } from './pages/SettingsPage';
import { I18nProvider } from './i18n';

const me = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Alice',
  locale: 'en',
  theme: 'dark',
  unit: 'kg',
  timezone: 'Asia/Tokyo',
  targetKcal: null,
  targetProteinG: null,
  targetFatG: null,
  targetCarbsG: null,
};

function makeSetup(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });

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
}

afterEach(() => vi.unstubAllGlobals());

describe('SettingsPage connector block', () => {
  it('shows the connector heading and MCP URL, and hides the old API token UI', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');

      // AI settings
      if (url.pathname === '/api/ai/settings') {
        return new Response(JSON.stringify(null), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Fallback: GET /api/me
      return new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    makeSetup(fetchMock);

    // Connector heading should be present
    expect(screen.getByText('Connect to Claude / ChatGPT')).toBeInTheDocument();

    // MCP URL should be present
    expect(screen.getByText('https://bodyatlas.okdtsk.dev/mcp')).toBeInTheDocument();

    // Old API tokens section heading should NOT be present
    expect(screen.queryByText(/api tokens/i)).toBeNull();

    // Old "Create token" button should NOT be present
    expect(screen.queryByRole('button', { name: /create token/i })).toBeNull();
  });
});
