import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { SetInputRow } from '../components/SetInputRow';
import { exerciseName, formatDay, formatSet, trimNum } from '../lib/format';
import {
  useDeleteSet,
  useDeleteWorkout,
  useUpdateSet,
  useUpdateWorkout,
  useWorkout,
} from '../lib/train';

type Detail = NonNullable<NonNullable<ReturnType<typeof useWorkout>['data']>>;

function DetailExercise({ workoutId, we }: { workoutId: string; we: Detail['workoutExercises'][number] }) {
  const { t, locale } = useI18n();
  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const updateSet = useUpdateSet(workoutId, we.id);
  const deleteSet = useDeleteSet(workoutId, we.id);

  return (
    <div className="card stack">
      <strong>{exerciseName(we.exercise, locale)}</strong>
      {we.sets.map((s) =>
        editingSetId === s.id ? (
          <SetInputRow
            key={s.id}
            exerciseType={we.exercise.type}
            submitLabel={t('train.updateSet')}
            busy={updateSet.isPending}
            initial={{
              weightKg: s.weightKg !== null ? trimNum(s.weightKg) : '',
              reps: s.reps !== null ? String(s.reps) : '',
              rpe: s.rpe !== null ? trimNum(s.rpe) : '',
              durationMin: s.durationSec !== null ? trimNum(s.durationSec / 60) : '',
              distanceKm: s.distanceM !== null ? trimNum(s.distanceM / 1000) : '',
            }}
            onSubmit={(input) =>
              updateSet.mutate({ setId: s.id, input }, { onSuccess: () => setEditingSetId(null) })
            }
          />
        ) : (
          <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
            <span>
              <span className="muted">{s.position}.</span> {formatSet(s)}
            </span>
            <span className="row">
              <button className="btn" aria-label={`edit-set-${s.position}`} onClick={() => setEditingSetId(s.id)}>
                {t('common.edit')}
              </button>
              <button className="btn" aria-label={`delete-set-${s.position}`} onClick={() => deleteSet.mutate(s.id)}>
                ✕
              </button>
            </span>
          </div>
        ),
      )}
      {(updateSet.isError || deleteSet.isError) && <p className="error-text">{t('error.generic')}</p>}
    </div>
  );
}

export function WorkoutDetailPage() {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: workout, isPending } = useWorkout(id);
  const update = useUpdateWorkout(id);
  const del = useDeleteWorkout();
  const [notes, setNotes] = useState<string | null>(null);

  if (isPending) return <p className="muted">…</p>;
  if (!workout) return <p className="muted">{t('error.generic')}</p>;

  const saveNotes = () => {
    if (notes !== null && notes !== (workout.notes ?? '')) {
      update.mutate({ notes: notes === '' ? null : notes });
    }
  };

  return (
    <section className="stack">
      <h1>{formatDay(String(workout.startedAt), locale)}</h1>
      <p className="muted">
        {new Date(workout.startedAt).toLocaleTimeString()} –{' '}
        {workout.endedAt ? new Date(workout.endedAt).toLocaleTimeString() : t('train.inProgress')}
      </p>

      {workout.workoutExercises.map((we) => (
        <DetailExercise key={we.id} workoutId={workout.id} we={we} />
      ))}

      <label className="stack" style={{ gap: 4 }}>
        {t('train.notes')}
        <textarea
          className="input"
          rows={3}
          aria-label={t('train.notes')}
          value={notes ?? workout.notes ?? ''}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
        />
      </label>

      <button
        className="btn btn-danger"
        onClick={() => {
          if (window.confirm(t('common.confirmDelete'))) {
            del.mutate(workout.id, { onSuccess: () => navigate('/train') });
          }
        }}
      >
        {t('train.deleteWorkout')}
      </button>
    </section>
  );
}
