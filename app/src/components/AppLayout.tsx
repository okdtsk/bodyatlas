import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Icon } from '@phosphor-icons/react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useI18n, type MessageKey } from '../i18n';
import { createAppController, offlineQueue } from '../lib/offline';
import { IconHealth, IconPlus, IconSettings, IconToday, IconTrain, IconTrends } from './icons';
import { OfflineIndicator } from './OfflineIndicator';
import { QuickLogSheet } from './QuickLogSheet';

const TABS: { to: string; key: MessageKey; Glyph: Icon }[] = [
  { to: '/', key: 'nav.today', Glyph: IconToday },
  { to: '/train', key: 'nav.train', Glyph: IconTrain },
  { to: '/health', key: 'nav.health', Glyph: IconHealth },
  { to: '/trends', key: 'nav.trends', Glyph: IconTrends },
  { to: '/settings', key: 'nav.settings', Glyph: IconSettings },
];

export function AppLayout() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);
  const queryClient = useQueryClient();
  const controller = useMemo(() => createAppController(queryClient), [queryClient]);

  useEffect(() => {
    let active = true;
    void offlineQueue.load().then(() => {
      if (active) void controller.start();
    });
    return () => {
      active = false;
      controller.stop();
    };
  }, [controller]);

  return (
    <div className="app-layout">
      <OfflineIndicator />
      <nav className="app-nav" aria-label="Main">
        {TABS.map(({ to, key, Glyph }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            {({ isActive }) => (
              <>
                <Glyph size={24} weight={isActive ? 'fill' : 'bold'} aria-hidden />
                <span>{t(key)}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <main className="app-main">
        <Outlet />
      </main>
      {pathname !== '/train/session' && (
        <>
          <button
            className="fab"
            aria-label={t('quickLog.title')}
            onClick={() => setSheetOpen(true)}
          >
            <IconPlus size={28} weight="bold" aria-hidden />
          </button>
          {sheetOpen && <QuickLogSheet onClose={() => setSheetOpen(false)} />}
        </>
      )}
    </div>
  );
}
