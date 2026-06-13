import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { useI18n, type MessageKey } from '../i18n';
import { offlineController, offlineQueue } from '../lib/offline';
import { OfflineIndicator } from './OfflineIndicator';
import { QuickLogSheet } from './QuickLogSheet';

const TABS: { to: string; key: MessageKey; icon: string }[] = [
  { to: '/', key: 'nav.today', icon: '☀️' },
  { to: '/train', key: 'nav.train', icon: '🏋️' },
  { to: '/health', key: 'nav.health', icon: '🍽' },
  { to: '/trends', key: 'nav.trends', icon: '📈' },
];

export function AppLayout() {
  const { t } = useI18n();
  const { pathname } = useLocation();
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void offlineQueue.load().then(() => {
      if (active) void offlineController.start();
    });
    return () => {
      active = false;
      offlineController.stop();
    };
  }, []);

  return (
    <div className="app-layout">
      <OfflineIndicator />
      <nav className="app-nav" aria-label="Main">
        {TABS.map(({ to, key, icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => (isActive ? 'tab active' : 'tab')}
          >
            <span aria-hidden>{icon}</span>
            <span>{t(key)}</span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={({ isActive }) => (isActive ? 'tab active' : 'tab')}>
          <span aria-hidden>⚙️</span>
          <span>{t('nav.settings')}</span>
        </NavLink>
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
            +
          </button>
          {sheetOpen && <QuickLogSheet onClose={() => setSheetOpen(false)} />}
        </>
      )}
    </div>
  );
}
