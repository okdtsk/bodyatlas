import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nProvider } from '../i18n';
import { AppLayout } from './AppLayout';

function renderLayout() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider locale="en">
        <MemoryRouter initialEntries={['/']}>
          <AppLayout />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe('AppLayout', () => {
  it('renders no emoji in the tab bar', () => {
    renderLayout();
    const nav = screen.getByRole('navigation', { name: 'Main' });
    // Emoji presentation, misc symbols, dingbats, and variation selectors.
    expect(nav.textContent ?? '').not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u);
  });

  it('labels the quick-log button for screen readers', () => {
    renderLayout();
    expect(screen.getByRole('button', { name: /quick log/i })).toBeInTheDocument();
  });
});
