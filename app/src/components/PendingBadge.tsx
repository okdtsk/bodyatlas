import { useI18n } from '../i18n';

/** Small marker shown on a not-yet-synced (or failed) provisional record. */
export function PendingBadge({ failed = false }: { failed?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      style={{
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 999,
        background: failed ? 'var(--negative)' : 'var(--surface-2)',
        color: failed ? 'var(--accent-contrast)' : 'var(--text-muted)',
      }}
    >
      {failed ? t('offline.failed') : t('offline.pending')}
    </span>
  );
}
