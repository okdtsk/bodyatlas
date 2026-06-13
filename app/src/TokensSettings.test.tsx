import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { SettingsPage } from './pages/SettingsPage';
import { I18nProvider } from './i18n';

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

const existingTokens = [
  {
    id: 'tok1',
    name: 'My MCP token',
    createdAt: '2026-06-01T00:00:00.000Z',
    lastUsedAt: '2026-06-10T12:00:00.000Z',
  },
];

const createdToken = {
  id: 'tok2',
  name: 'New token',
  createdAt: '2026-06-12T00:00:00.000Z',
  token: 'ba_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
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

describe('SettingsPage token management', () => {
  it('create flow POSTs to /api/tokens and renders the returned ba_ token once', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/api/tokens') {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'POST' && url.pathname === '/api/tokens') {
        return new Response(JSON.stringify(createdToken), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // GET /api/me
      return new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    makeSetup(fetchMock);

    // Find the token name input and type a name
    const nameInput = await screen.findByPlaceholderText(/token name/i);
    await userEvent.type(nameInput, 'New token');

    // Create button should now be enabled
    const createButton = screen.getByRole('button', { name: /create token/i });
    expect(createButton).not.toBeDisabled();

    await userEvent.click(createButton);

    // Should have called POST /api/tokens
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postCall = fetchMock.mock.calls.find(([input, init]: any) => {
        const url = new URL(String(input), 'http://localhost');
        return url.pathname === '/api/tokens' && (init?.method ?? 'GET') === 'POST';
      });
      expect(postCall).toBeTruthy();
    });

    // The returned ba_ token should be shown in the UI
    await waitFor(() => {
      expect(screen.getByText(createdToken.token)).toBeInTheDocument();
    });

    // The token should appear exactly once
    expect(screen.getAllByText(createdToken.token)).toHaveLength(1);
  });

  it('revoke fires DELETE to /api/tokens/:id after confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';

      if (method === 'GET' && url.pathname === '/api/tokens') {
        return new Response(JSON.stringify(existingTokens), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (method === 'DELETE' && url.pathname === `/api/tokens/${existingTokens[0]!.id}`) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // GET /api/me or GET /api/tokens after invalidation (return empty)
      return new Response(JSON.stringify(method === 'GET' ? me : {}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    makeSetup(fetchMock);

    // Wait for the token name to appear in the list
    await screen.findByText('My MCP token');

    // Click the revoke button
    const revokeButton = screen.getByRole('button', { name: /revoke/i });
    await userEvent.click(revokeButton);

    // Confirm should have been called
    expect(confirmSpy).toHaveBeenCalled();

    // DELETE should have been fired
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const deleteCall = fetchMock.mock.calls.find(([input, init]: any) => {
        const url = new URL(String(input), 'http://localhost');
        return (
          url.pathname === `/api/tokens/${existingTokens[0]!.id}` &&
          (init?.method ?? 'GET') === 'DELETE'
        );
      });
      expect(deleteCall).toBeTruthy();
    });

    confirmSpy.mockRestore();
  });
});
