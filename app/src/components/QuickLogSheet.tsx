import { useI18n, type MessageKey } from '../i18n';

const ACTIONS: { key: MessageKey; icon: string }[] = [
  { key: 'quickLog.set', icon: '🏋️' },
  { key: 'quickLog.meal', icon: '🍽' },
  { key: 'quickLog.weight', icon: '⚖️' },
  { key: 'quickLog.sleep', icon: '🌙' },
];

export function QuickLogSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div
      role="dialog"
      aria-label={t('quickLog.title')}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-end',
        zIndex: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          borderRadius: 'var(--radius) var(--radius) 0 0',
          borderTop: '2px solid var(--accent)',
          padding: 16,
          width: '100%',
          maxWidth: 480,
          margin: '0 auto',
        }}
      >
        <h2 style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--text-muted)' }}>
          {t('quickLog.title')}
        </h2>
        {ACTIONS.map(({ key, icon }) => (
          <button
            key={key}
            disabled
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'center',
              width: '100%',
              padding: 12,
              marginBottom: 8,
              background: 'var(--surface-2)',
              border: 'none',
              borderRadius: 'var(--radius)',
              color: 'var(--text-muted)',
              textAlign: 'left',
            }}
          >
            <span>{icon}</span>
            <span>{t(key)}</span>
            <span style={{ marginLeft: 'auto', fontSize: 12 }}>
              {t('quickLog.comingSoon')}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
