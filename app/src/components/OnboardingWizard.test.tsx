import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { I18nProvider } from '../i18n';
import { OnboardingWizard } from './OnboardingWizard';

const me = {
  id: 'u',
  email: 'a@b.c',
  name: 'A',
  locale: 'en',
  theme: 'gym-dark',
  unit: 'kg',
  timezone: 'UTC',
  onboardedAt: null,
  targetKcal: null,
  targetProteinG: null,
  targetFatG: null,
  targetCarbsG: null,
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

describe('OnboardingWizard', () => {
  afterEach(() => vi.restoreAllMocks());

  it('finishing stamps onboarded:true via PATCH /me', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ...me, onboardedAt: '2026-06-13T00:00:00Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    wrap(<OnboardingWizard me={me as never} />);

    const user = userEvent.setup();
    for (let i = 0; i < 4; i++) {
      const btn = screen.queryByRole('button', { name: /next|finish|get started/i });
      if (btn) await user.click(btn);
    }

    expect(fetchMock).toHaveBeenCalled();
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCall).toBeDefined();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body.onboarded).toBe(true);
  });

  it('Skip also stamps onboarded:true', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ...me, onboardedAt: '2026-06-13T00:00:00Z' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    wrap(<OnboardingWizard me={me as never} />);
    await userEvent.setup().click(screen.getByRole('button', { name: /skip/i }));
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(JSON.parse((patchCall![1] as RequestInit).body as string).onboarded).toBe(true);
  });
});
