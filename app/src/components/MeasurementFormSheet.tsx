import type { Measurement } from '../lib/health';
import { useI18n } from '../i18n';

export interface MeasurementFormSheetProps {
  defaultDate: Date;
  editing?: Measurement | null;
  onClose: () => void;
}

export function MeasurementFormSheet({ onClose }: MeasurementFormSheetProps) {
  const { t } = useI18n();
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <div className="sheet-panel">
        <button type="button" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
