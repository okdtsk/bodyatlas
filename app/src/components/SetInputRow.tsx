import { useState } from 'react';
import type { ExerciseType, SetInput } from '@bodyatlas/shared';
import { useI18n } from '../i18n';

/** Parses a decimal string; '' → undefined; invalid → undefined. */
function num(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
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
  initial?: { weightKg?: string; reps?: string; rpe?: string; durationMin?: string; distanceKm?: string };
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [weight, setWeight] = useState(initial?.weightKg ?? '');
  const [reps, setReps] = useState(initial?.reps ?? '');
  const [rpe, setRpe] = useState(initial?.rpe ?? '');
  const [durationMin, setDurationMin] = useState(initial?.durationMin ?? '');
  const [distanceKm, setDistanceKm] = useState(initial?.distanceKm ?? '');

  const isCardio = exerciseType === 'cardio';

  const build = (): SetInput => ({
    ...(num(weight) !== undefined ? { weightKg: num(weight) } : {}),
    ...(num(reps) !== undefined ? { reps: num(reps) } : {}),
    ...(num(rpe) !== undefined ? { rpe: num(rpe) } : {}),
    ...(num(durationMin) !== undefined ? { durationSec: Math.round(num(durationMin)! * 60) } : {}),
    ...(num(distanceKm) !== undefined ? { distanceM: num(distanceKm)! * 1000 } : {}),
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
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {!isCardio && field(t('field.weight'), weight, setWeight)}
      {!isCardio && field(t('field.reps'), reps, setReps)}
      {!isCardio && field(t('field.rpe'), rpe, setRpe)}
      {isCardio && field(t('field.duration'), durationMin, setDurationMin)}
      {isCardio && field(t('field.distance'), distanceKm, setDistanceKm)}
      <button
        className="btn btn-primary"
        style={{ marginLeft: 'auto' }}
        disabled={!valid || busy}
        onClick={() => onSubmit(build())}
      >
        {submitLabel}
      </button>
    </div>
  );
}
