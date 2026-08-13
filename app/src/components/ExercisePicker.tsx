import { useEffect, useState } from 'react';
import { EQUIPMENT, EXERCISE_TYPES, MUSCLE_GROUPS, type CreateExercise } from '@bodyatlas/shared';
import { useI18n, type MessageKey } from '../i18n';
import { exerciseName } from '../lib/format';
import { useCreateExercise, useExercises, type Exercise } from '../lib/train';

export function ExercisePicker({
  onSelect,
  onClose,
}: {
  onSelect: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data: exercises, isPending } = useExercises(q);
  const create = useCreateExercise();

  const [form, setForm] = useState<CreateExercise>({
    name: '',
    type: 'strength',
    muscleGroup: 'chest',
    equipment: 'barbell',
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submitCreate = () => {
    create.mutate(form, {
      onSuccess: (created) => onSelect(created),
    });
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel stack"
        role="dialog"
        aria-modal="true"
        aria-label={t('train.addExercise')}
        onClick={(e) => e.stopPropagation()}
      >
        {!creating ? (
          <>
            <input
              className="input"
              autoFocus
              placeholder={t('exercise.search')}
              aria-label={t('exercise.search')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="stack" style={{ gap: 4 }}>
              {!isPending && exercises?.length === 0 && (
                <p className="muted">{t('exercise.noResults')}</p>
              )}
              {exercises?.map((ex) => (
                <button
                  key={ex.id}
                  className="panel tappable row"
                  style={{ justifyContent: 'space-between', textAlign: 'left' }}
                  onClick={() => onSelect(ex)}
                >
                  <span>
                    {exerciseName(ex, locale)}
                    {ex.userId !== null && <span className="muted"> · {t('exercise.custom')}</span>}
                  </span>
                  <span className="muted">{t(`muscle.${ex.muscleGroup}` as MessageKey)}</span>
                </button>
              ))}
            </div>
            <button className="btn" onClick={() => setCreating(true)}>
              {t('exercise.create')}
            </button>
          </>
        ) : (
          <>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.name')}
              <input
                className="input"
                aria-label={t('exercise.name')}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </label>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.type')}
              <select
                className="input"
                aria-label={t('exercise.type')}
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as CreateExercise['type'] })}
              >
                {EXERCISE_TYPES.map((v) => (
                  <option key={v} value={v}>{t(`type.${v}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.muscleGroup')}
              <select
                className="input"
                aria-label={t('exercise.muscleGroup')}
                value={form.muscleGroup}
                onChange={(e) =>
                  setForm({ ...form, muscleGroup: e.target.value as CreateExercise['muscleGroup'] })
                }
              >
                {MUSCLE_GROUPS.map((v) => (
                  <option key={v} value={v}>{t(`muscle.${v}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              {t('exercise.equipment')}
              <select
                className="input"
                aria-label={t('exercise.equipment')}
                value={form.equipment}
                onChange={(e) =>
                  setForm({ ...form, equipment: e.target.value as CreateExercise['equipment'] })
                }
              >
                {EQUIPMENT.map((v) => (
                  <option key={v} value={v}>{t(`equip.${v}` as MessageKey)}</option>
                ))}
              </select>
            </label>
            {create.isError && <p className="error-text">{t('error.generic')}</p>}
            <div className="row">
              <button
                className="btn btn-primary"
                onClick={submitCreate}
                disabled={create.isPending || form.name.trim() === ''}
              >
                {t('common.save')}
              </button>
              <button className="btn" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
