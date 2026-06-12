import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.unstubAllGlobals());

describe('SettingsPage', () => {
  it('PATCHes /api/me when the theme changes', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ ...me, theme: 'clinical-light' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(me), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['me'], me);

    render(
      <QueryClientProvider client={client}>
        <I18nProvider locale="en">
          <SettingsPage />
        </I18nProvider>
      </QueryClientProvider>,
    );

    await userEvent.selectOptions(screen.getByLabelText('Theme'), 'clinical-light');

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(([, init]) => init?.method === 'PATCH');
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall![1]!.body))).toEqual({ theme: 'clinical-light' });
    });
  });
});
