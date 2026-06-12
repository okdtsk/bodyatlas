import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { mockApi } from '../test/mockApi';
import { SleepFormSheet } from './SleepFormSheet';

function renderSheet(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nProvider locale="en">
        <SleepFormSheet
          defaultDate={new Date('2026-06-12T00:00:00.000Z')}
          onClose={onClose}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('SleepFormSheet', () => {
  it('valid times fire POST with TZ-explicit ISO (ends with Z)', async () => {
    const spy = mockApi({
      'POST /api/sleep': {
        id: 'sleep-1',
        userId: 'u1',
        bedAt: '2026-06-11T14:00:00.000Z',
        wokeAt: '2026-06-12T05:00:00.000Z',
        qualityStars: null,
        notes: null,
      },
    });
    renderSheet();

    // Set bed time and wake time via datetime-local inputs
    const bedInput = screen.getByLabelText(/bed time/i) as HTMLInputElement;
    const wakeInput = screen.getByLabelText(/wake time/i) as HTMLInputElement;

    // Clear existing values and set valid times
    await userEvent.clear(bedInput);
    await userEvent.type(bedInput, '2026-06-11T23:00');
    await userEvent.clear(wakeInput);
    await userEvent.type(wakeInput, '2026-06-12T07:00');

    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).not.toBeDisabled();

    await userEvent.click(saveBtn);

    await waitFor(() => {
      const postCall = spy.mock.calls.find(
        ([url, init]) => String(url).includes('/api/sleep') && init?.method === 'POST',
      );
      expect(postCall).toBeTruthy();
      const body = JSON.parse(String(postCall![1]!.body));
      // TZ-explicit ISO: must end with 'Z'
      expect(body.bedAt).toMatch(/Z$/);
      expect(body.wokeAt).toMatch(/Z$/);
      // Parse correctly
      expect(new Date(body.bedAt).getTime()).toBeGreaterThan(0);
      expect(new Date(body.wokeAt).getTime()).toBeGreaterThan(new Date(body.bedAt).getTime());
    });
  });

  it('inverted times disable save and show the invalid range message', async () => {
    mockApi({});
    renderSheet();

    const bedInput = screen.getByLabelText(/bed time/i) as HTMLInputElement;
    const wakeInput = screen.getByLabelText(/wake time/i) as HTMLInputElement;

    // Set wake BEFORE bed
    await userEvent.clear(bedInput);
    await userEvent.type(bedInput, '2026-06-12T07:00');
    await userEvent.clear(wakeInput);
    await userEvent.type(wakeInput, '2026-06-12T06:00');

    // Save should be disabled
    const saveBtn = screen.getByRole('button', { name: /save/i });
    expect(saveBtn).toBeDisabled();

    // Error message should appear
    expect(screen.getByText('Wake time must be after bed time.')).toBeInTheDocument();
  });
});
