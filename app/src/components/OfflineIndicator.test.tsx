import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { OfflineIndicator } from './OfflineIndicator';
import { offlineQueue } from '../lib/offline';

function renderIndicator() {
  return render(
    <I18nProvider locale="en">
      <OfflineIndicator />
    </I18nProvider>,
  );
}

describe('OfflineIndicator', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is hidden when online with nothing pending', async () => {
    await offlineQueue.load();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const { container } = renderIndicator();
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a pending count when ops are queued', async () => {
    await offlineQueue.load();
    await offlineQueue.enqueue('meal', { name: 'Eggs' });
    renderIndicator();
    expect(await screen.findByText(/1/)).toBeInTheDocument();
  });
});
