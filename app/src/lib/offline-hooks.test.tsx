import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { offlineQueue } from './offline';
import { useCreateMeal } from './health';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useCreateMeal offline', () => {
  afterEach(() => vi.restoreAllMocks());

  it('enqueues the meal when the network throws and resolves successfully', async () => {
    await offlineQueue.load();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    // The Hono RPC client calls global fetch; a network failure throws a
    // TypeError before any HTTP response, which isOfflineError treats as offline.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useCreateMeal(), { wrapper });
    await result.current.mutateAsync({ name: 'Eggs' });

    await waitFor(() =>
      expect(offlineQueue.pending().some((o) => o.kind === 'meal')).toBe(true),
    );
  });
});
