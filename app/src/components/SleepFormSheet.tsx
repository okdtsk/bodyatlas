import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { toLocalInputValue } from '../lib/format';
import {
  useCreateSleep,
  useDeleteSleep,
  useUpdateSleep,
  type SleepRecord,
} from '../lib/health';

export interface SleepFormSheetProps {
  defaultDate: Date;
  editing?: SleepRecord | null;
  onClose: () => void;
}

function defaultBedValue(editing: SleepRecord | null | undefined, defaultDate: Date): string {
  if (editing?.bedAt) return toLocalInputValue(editing.bedAt);
  // defaultDate − 1 day at 23:00 local
  const d = new Date(
    defaultDate.getFullYear(),
    defaultDate.getMonth(),
    defaultDate.getDate() - 1,
    23,
    0,
  );
  return toLocalInputValue(d.toISOString());
}

function defaultWakeValue(editing: SleepRecord | null | undefined, defaultDate: Date): string {
  if (editing?.wokeAt) return toLocalInputValue(editing.wokeAt);
  // defaultDate at 07:00 local
  const d = new Date(
    defaultDate.getFullYear(),
    defaultDate.getMonth(),
    defaultDate.getDate(),
    7,
    0,
  );
  return toLocalInputValue(d.toISOString());
}

export function SleepFormSheet({ defaultDate, editing, onClose }: SleepFormSheetProps) {
  const { t } = useI18n();
  const isCreate = !editing;

  const [bedTime, setBedTime] = useState(() => defaultBedValue(editing, defaultDate));
  const [wakeTime, setWakeTime] = useState(() => defaultWakeValue(editing, defaultDate));
  const [quality, setQuality] = useState<number | null>(editing?.quality ?? null);
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [error, setError] = useState('');

  const createSleep = useCreateSleep();
  const updateSleep = useUpdateSleep();
  const deleteSleep = useDeleteSleep();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Client-side guard: wake must be after bed
  const bedMs = bedTime ? new Date(bedTime).getTime() : NaN;
  const wakeMs = wakeTime ? new Date(wakeTime).getTime() : NaN;
  const rangeInvalid = !isNaN(bedMs) && !isNaN(wakeMs) && wakeMs <= bedMs;

  const isBusy = createSleep.isPending || updateSleep.isPending || deleteSleep.isPending;
  const canSave = !rangeInvalid && bedTime.length > 0 && wakeTime.length > 0 && !isBusy;

  function handleSave() {
    setError('');
    const input = {
      bedAt: new Date(bedTime).toISOString(),
      wokeAt: new Date(wakeTime).toISOString(),
      ...(quality !== null ? { quality } : {}),
      ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
    };
    if (editing) {
      updateSleep.mutate(
        { id: editing.id, input },
        { onSuccess: onClose, onError: () => setError(t('error.generic')) },
      );
    } else {
      createSleep.mutate(input, {
        onSuccess: onClose,
        onError: () => setError(t('error.generic')),
      });
    }
  }

  function handleDelete() {
    if (!editing) return;
    if (!window.confirm(t('common.confirmDelete'))) return;
    deleteSleep.mutate(editing.id, { onSuccess: onClose, onError: () => setError(t('error.generic')) });
  }

  function handleQualityClick(star: number) {
    // Tap selected star again to clear
    setQuality((prev) => (prev === star ? null : star));
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel stack"
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? t('health.addSleep') : t('common.edit')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bed time */}
        <label className="stack" style={{ gap: 4 }}>
          {t('health.bedTime')}
          <input
            className="input"
            type="datetime-local"
            aria-label={t('health.bedTime')}
            value={bedTime}
            onChange={(e) => setBedTime(e.target.value)}
          />
        </label>

        {/* Wake time */}
        <label className="stack" style={{ gap: 4 }}>
          {t('health.wakeTime')}
          <input
            className="input"
            type="datetime-local"
            aria-label={t('health.wakeTime')}
            value={wakeTime}
            onChange={(e) => setWakeTime(e.target.value)}
          />
        </label>

        {/* Inline validation message */}
        {rangeInvalid && (
          <p className="error-text">{t('health.invalidSleepRange')}</p>
        )}

        {/* Quality — five ★ toggle buttons */}
        <div className="stack" style={{ gap: 4 }}>
          <span>{t('health.quality')}</span>
          <div className="row" style={{ gap: 4 }}>
            {([1, 2, 3, 4, 5] as const).map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`quality-${star}`}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 24,
                  color: quality !== null && star <= quality ? 'var(--glow)' : 'var(--text-muted)',
                  padding: 0,
                }}
                onClick={() => handleQualityClick(star)}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <label className="stack" style={{ gap: 4 }}>
          {t('train.notes')}
          <input
            className="input"
            aria-label={t('train.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

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
              style={{ marginLeft: 'auto', color: 'var(--error)' }}
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
