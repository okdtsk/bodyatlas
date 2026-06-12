import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useI18n, type MessageKey } from '../i18n';
import { useStartWorkout } from '../lib/train';

const HEALTH_ACTIONS: { key: MessageKey; icon: string; path: string }[] = [
  { key: 'quickLog.meal', icon: '🍽', path: '/health?add=meal' },
  { key: 'quickLog.weight', icon: '⚖️', path: '/health?add=weight' },
  { key: 'quickLog.sleep', icon: '🌙', path: '/health?add=sleep' },
];

export function QuickLogSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const start = useStartWorkout();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const logSet = () => {
    start.mutate({}, {
      onSuccess: () => {
        onClose();
        navigate('/train/session');
      },
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
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
        <button
          onClick={logSet}
          disabled={start.isPending}
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
            color: 'var(--text)',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          <span>🏋️</span>
          <span>{t('quickLog.set')}</span>
        </button>
        {HEALTH_ACTIONS.map(({ key, icon, path }) => (
          <button
            key={key}
            onClick={() => { navigate(path); onClose(); }}
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
              color: 'var(--text)',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span>{icon}</span>
            <span>{t(key)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
