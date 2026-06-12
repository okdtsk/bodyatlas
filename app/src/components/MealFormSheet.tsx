import type { Meal } from '../lib/health';
import { useI18n } from '../i18n';

export interface MealFormSheetProps {
  defaultDate: Date;
  editing?: Meal | null;
  onClose: () => void;
}

export function MealFormSheet({ onClose }: MealFormSheetProps) {
  const { t } = useI18n();
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true">
      <div className="sheet-panel">
        <button type="button" onClick={onClose}>{t('common.cancel')}</button>
      </div>
    </div>
  );
}
