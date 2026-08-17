import { useI18n } from '../i18n';

/** Small marker shown on a not-yet-synced (or failed) provisional record. */
export function PendingBadge({ failed = false }: { failed?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      className="chip"
      style={failed ? { background: 'var(--negative)', color: 'var(--negative-contrast)' } : undefined}
    >
      {failed ? t('offline.failed') : t('offline.pending')}
    </span>
  );
}
