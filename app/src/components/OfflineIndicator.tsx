import { useSyncExternalStore } from 'react';
import { useI18n } from '../i18n';
import { isOnline } from '../lib/offline/connectivity';
import { useQueuedOps } from '../lib/offline/usePendingOps';

function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => isOnline(),
    () => true,
  );
}

/** Compact banner: shows offline state and how many writes are waiting to sync. */
export function OfflineIndicator() {
  const { t } = useI18n();
  const online = useOnlineStatus();
  const pending = useQueuedOps().filter((o) => o.status === 'pending').length;

  if (online && pending === 0) return null;

  const count = t('offline.pendingCount').replace('{n}', String(pending));
  const label = !online
    ? pending
      ? `${t('offline.offline')} · ${count}`
      : t('offline.offline')
    : count;

  return (
    <div
      role="status"
      style={{
        fontSize: 12,
        textAlign: 'center',
        padding: '4px 8px',
        background: 'var(--surface-2)',
        color: 'var(--text-muted)',
      }}
    >
      {label}
    </div>
  );
}
