import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { parseDecimal, toLocalInputValue } from '../lib/format';
import {
  useCreateMeasurement,
  useDeleteMeasurement,
  useUpdateMeasurement,
  type Measurement,
} from '../lib/health';

export interface MeasurementFormSheetProps {
  defaultDate: Date;
  editing?: Measurement | null;
  onClose: () => void;
}

function defaultTimeValue(editing: Measurement | null | undefined, defaultDate: Date): string {
  if (editing?.measuredAt) return toLocalInputValue(editing.measuredAt);
  // now-of-defaultDate: same calendar day as defaultDate but current time
  const now = new Date();
  const d = new Date(
    defaultDate.getFullYear(),
    defaultDate.getMonth(),
    defaultDate.getDate(),
    now.getHours(),
    now.getMinutes(),
  );
  return toLocalInputValue(d.toISOString());
}

export function MeasurementFormSheet({ defaultDate, editing, onClose }: MeasurementFormSheetProps) {
  const { t } = useI18n();
  const isCreate = !editing;

  const [weight, setWeight] = useState(editing?.weightKg != null ? String(editing.weightKg) : '');
  const [bodyFat, setBodyFat] = useState(editing?.bodyFatPct != null ? String(editing.bodyFatPct) : '');
  const [time, setTime] = useState(() => defaultTimeValue(editing, defaultDate));
  const [error, setError] = useState('');

  const createMeasurement = useCreateMeasurement();
  const updateMeasurement = useUpdateMeasurement();
  const deleteMeasurement = useDeleteMeasurement();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const weightVal = parseDecimal(weight);
  const bodyFatVal = parseDecimal(bodyFat);
  const hasValue = weightVal !== undefined || bodyFatVal !== undefined;

  const isBusy =
    createMeasurement.isPending || updateMeasurement.isPending || deleteMeasurement.isPending;
  const canSave = hasValue && !isBusy;

  function buildInput() {
    return {
      ...(time.length > 0 ? { measuredAt: new Date(time).toISOString() } : {}),
      ...(weightVal !== undefined ? { weightKg: weightVal } : {}),
      ...(bodyFatVal !== undefined ? { bodyFatPct: bodyFatVal } : {}),
    };
  }

  function handleSave() {
    setError('');
    const input = buildInput();
    if (editing) {
      updateMeasurement.mutate(
        { id: editing.id, input },
        { onSuccess: onClose, onError: () => setError(t('error.generic')) },
      );
    } else {
      createMeasurement.mutate(input, {
        onSuccess: onClose,
        onError: () => setError(t('error.generic')),
      });
    }
  }

  function handleDelete() {
    if (!editing) return;
    if (!window.confirm(t('common.confirmDelete'))) return;
    deleteMeasurement.mutate(editing.id, {
      onSuccess: onClose,
      onError: () => setError(t('error.generic')),
    });
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel stack"
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? t('health.addMeasurement') : t('common.edit')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Weight field */}
        <label className="stack" style={{ gap: 4 }}>
          {t('health.weight')}
          <input
            className="input input-num"
            inputMode="decimal"
            aria-label={t('health.weight')}
            autoFocus={isCreate}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
        </label>

        {/* Body fat field */}
        <label className="stack" style={{ gap: 4 }}>
          {t('health.bodyFat')}
          <input
            className="input input-num"
            inputMode="decimal"
            aria-label={t('health.bodyFat')}
            value={bodyFat}
            onChange={(e) => setBodyFat(e.target.value)}
          />
        </label>

        {/* Time field */}
        <label className="stack" style={{ gap: 4 }}>
          {t('health.time')}
          <input
            className="input"
            type="datetime-local"
            aria-label={t('health.time')}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>

        {/* Hint when no value entered */}
        {!hasValue && (
          <p className="error-text">{t('health.measurementNeedsValue')}</p>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            {t('common.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {editing && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 'auto', color: 'var(--negative)' }}
              disabled={isBusy}
              onClick={handleDelete}
            >
              {t('common.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
