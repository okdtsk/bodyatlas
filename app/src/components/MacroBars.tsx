import { useI18n } from '../i18n';

interface ProgressBarProps {
  value: number;
  target: number | null | undefined;
}

function ProgressBar({ value, target }: ProgressBarProps) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        borderRadius: 2,
        height: 4,
        overflow: 'hidden',
        flex: 1,
        minWidth: 48,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: 'var(--accent)',
          borderRadius: 2,
          transition: 'width 0.2s',
        }}
      />
    </div>
  );
}

interface MacroBarsProps {
  proteinG: number;
  fatG: number;
  carbsG: number;
  targetProteinG?: number | null;
  targetFatG?: number | null;
  targetCarbsG?: number | null;
}

export function MacroBars({ proteinG, fatG, carbsG, targetProteinG, targetFatG, targetCarbsG }: MacroBarsProps) {
  const { t } = useI18n();
  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, width: 12, color: 'var(--text-muted)' }}>{t('health.protein')}</span>
        <span style={{ fontSize: 13, minWidth: 80 }}>
          {proteinG}g / {targetProteinG != null ? `${targetProteinG}g` : '—'}
        </span>
        <ProgressBar value={proteinG} target={targetProteinG} />
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, width: 12, color: 'var(--text-muted)' }}>{t('health.fat')}</span>
        <span style={{ fontSize: 13, minWidth: 80 }}>
          {fatG}g / {targetFatG != null ? `${targetFatG}g` : '—'}
        </span>
        <ProgressBar value={fatG} target={targetFatG} />
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ fontSize: 12, width: 12, color: 'var(--text-muted)' }}>{t('health.carbs')}</span>
        <span style={{ fontSize: 13, minWidth: 80 }}>
          {carbsG}g / {targetCarbsG != null ? `${targetCarbsG}g` : '—'}
        </span>
        <ProgressBar value={carbsG} target={targetCarbsG} />
      </div>
    </div>
  );
}
