import { useEffect } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { useI18n, type MessageKey } from '../i18n';
import { useStartWorkout } from '../lib/train';
import { IconMeal, IconSet, IconSleep, IconWeight } from './icons';

const HEALTH_ACTIONS: { key: MessageKey; Glyph: Icon; path: string }[] = [
  { key: 'quickLog.meal', Glyph: IconMeal, path: '/health?add=meal' },
  { key: 'quickLog.weight', Glyph: IconWeight, path: '/health?add=weight' },
  { key: 'quickLog.sleep', Glyph: IconSleep, path: '/health?add=sleep' },
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
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel stack"
        role="dialog"
        aria-modal="true"
        aria-label={t('quickLog.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="label" style={{ margin: 0 }}>
          {t('quickLog.title')}
        </h2>
        <button
          className="btn btn-secondary"
          style={{ width: '100%', justifyContent: 'flex-start' }}
          onClick={logSet}
          disabled={start.isPending}
        >
          <IconSet size={20} weight="bold" aria-hidden />
          <span>{t('quickLog.set')}</span>
        </button>
        {HEALTH_ACTIONS.map(({ key, Glyph, path }) => (
          <button
            key={key}
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={() => { navigate(path); onClose(); }}
          >
            <Glyph size={20} weight="bold" aria-hidden />
            <span>{t(key)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
