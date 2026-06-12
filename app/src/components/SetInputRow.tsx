import { useState } from 'react';
import type { ExerciseType, SetInput } from '@bodyatlas/shared';
import { useI18n } from '../i18n';

/** Parses a decimal string; '' → undefined; invalid → undefined. Accepts comma decimals (JA keyboards). */
function num(v: string): number | undefined {
  const trimmed = v.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function SetInputRow({
  exerciseType,
  onSubmit,
  submitLabel,
  initial,
  busy = false,
}: {
  exerciseType: ExerciseType;
  onSubmit: (input: SetInput) => void;
  submitLabel: string;
  initial?: { weightKg?: string; reps?: string; rpe?: string; durationMin?: string; distanceKm?: string; note?: string };
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [weight, setWeight] = useState(initial?.weightKg ?? '');
  const [reps, setReps] = useState(initial?.reps ?? '');
  const [rpe, setRpe] = useState(initial?.rpe ?? '');
  const [durationMin, setDurationMin] = useState(initial?.durationMin ?? '');
  const [distanceKm, setDistanceKm] = useState(initial?.distanceKm ?? '');
  const [note, setNote] = useState(initial?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(false);

  const isCardio = exerciseType === 'cardio';

  const build = (): SetInput => ({
    ...(num(weight) !== undefined ? { weightKg: num(weight) } : {}),
    ...(num(reps) !== undefined ? { reps: num(reps) } : {}),
    ...(num(rpe) !== undefined ? { rpe: num(rpe) } : {}),
    ...(num(durationMin) !== undefined ? { durationSec: Math.round(num(durationMin)! * 60) } : {}),
    ...(num(distanceKm) !== undefined ? { distanceM: Math.round(num(distanceKm)! * 1000) } : {}),
    ...(note.trim() !== '' ? { note: note.trim() } : {}),
  });

  const valid =
    num(reps) !== undefined || num(durationMin) !== undefined || num(distanceKm) !== undefined;

  const field = (
    label: string,
    value: string,
    set: (v: string) => void,
  ) => (
    <label className="stack" style={{ gap: 2, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}>
      <input
        className="input input-num"
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
      {label}
    </label>
  );

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {!isCardio && field(t('field.weight'), weight, setWeight)}
        {!isCardio && field(t('field.reps'), reps, setReps)}
        {!isCardio && field(t('field.rpe'), rpe, setRpe)}
        {isCardio && field(t('field.duration'), durationMin, setDurationMin)}
        {isCardio && field(t('field.distance'), distanceKm, setDistanceKm)}
        <button
          className="btn"
          style={{ marginLeft: 'auto' }}
          aria-label={t('set.note')}
          onClick={() => setNoteOpen((o) => !o)}
          type="button"
        >
          ✎
        </button>
        <button
          className="btn btn-primary"
          disabled={!valid || busy}
          onClick={() => {
            onSubmit(build());
            // Notes are set-specific (unlike weight/reps which persist) — clear optimistically.
            setNote('');
            setNoteOpen(false);
          }}
          type="button"
        >
          {submitLabel}
        </button>
      </div>
      {noteOpen && (
        <input
          className="input"
          style={{ fontSize: 16 }}
          aria-label={t('set.note')}
          placeholder={t('set.notePlaceholder')}
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
    </div>
  );
}
