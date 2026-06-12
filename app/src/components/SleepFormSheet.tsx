import type { SleepRecord } from '../lib/health';
import { useI18n } from '../i18n';

export interface SleepFormSheetProps {
  defaultDate: Date;
  editing?: SleepRecord | null;
  onClose: () => void;
}

export function SleepFormSheet({ onClose }: SleepFormSheetProps) {
  const { t } = useI18n();
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <div className="sheet-panel">
        <button type="button" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
