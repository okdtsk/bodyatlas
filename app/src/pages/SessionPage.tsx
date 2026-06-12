import { useCallback, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { ExercisePicker } from '../components/ExercisePicker';
import { SetInputRow } from '../components/SetInputRow';
import { exerciseName, formatDay, formatSet } from '../lib/format';
import {
  useActiveWorkout,
  useAddWorkoutExercise,
  useDeleteSet,
  useLastSets,
  useLogSet,
  useRemoveWorkoutExercise,
  useUpdateWorkout,
  type ActiveWorkout,
} from '../lib/train';

function ExerciseBlock({
  workoutId,
  we,
}: {
  workoutId: string;
  we: ActiveWorkout['workoutExercises'][number];
}) {
  const { t, locale } = useI18n();
  const { data: last } = useLastSets(we.exercise.id, workoutId);
  const logSet = useLogSet(workoutId, we.id);
  const deleteSet = useDeleteSet(workoutId, we.id);
  const removeExercise = useRemoveWorkoutExercise(workoutId);

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{exerciseName(we.exercise, locale)}</strong>
        {we.sets.length === 0 && (
          <button className="btn" onClick={() => removeExercise.mutate(we.id)} aria-label={`remove-${we.id}`}>
            ✕
          </button>
        )}
      </div>

      <div className="muted">
        {last === null && t('train.noPrevious')}
        {last && (
          <>
            {t('train.lastTime')} ({formatDay(String(last.startedAt), locale)}):{' '}
            {last.sets.map((s) => formatSet(s)).join(', ')}
          </>
        )}
      </div>

      {we.sets.map((s) => (
        <div key={s.id} className="row" style={{ justifyContent: 'space-between' }}>
          <span>
            <span className="muted">{s.position}.</span> {formatSet(s)}
          </span>
          <button className="btn" onClick={() => deleteSet.mutate(s.id)} aria-label={`delete-set-${s.position}`}>
            ✕
          </button>
        </div>
      ))}

      <SetInputRow
        exerciseType={we.exercise.type}
        submitLabel={t('train.logSet')}
        busy={logSet.isPending}
        onSubmit={(input) => logSet.mutate(input)}
      />
      {(logSet.isError || deleteSet.isError) && <p className="error-text">{t('error.generic')}</p>}
    </div>
  );
}

export function SessionPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data, isPending } = useActiveWorkout();
  const [pickerOpen, setPickerOpen] = useState(false);
  const workout = data?.workout ?? null;
  const addExercise = useAddWorkoutExercise(workout?.id ?? '');
  const update = useUpdateWorkout(workout?.id ?? '');

  const handlePickerClose = useCallback(() => setPickerOpen(false), []);

  if (isPending) return <p className="muted">…</p>;
  if (!workout) return <Navigate to="/train" replace />;

  const finish = () =>
    update.mutate(
      { finish: true },
      { onSuccess: () => navigate(`/train/workouts/${workout.id}`) },
    );

  return (
    <section className="stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{t('train.inProgress')}</h1>
        <button className="btn btn-primary" onClick={finish} disabled={update.isPending}>
          {t('train.finish')}
        </button>
      </div>
      <p className="muted">
        {t('train.startedAt')} {new Date(workout.startedAt).toLocaleTimeString()}
      </p>

      {workout.workoutExercises.map((we) => (
        <ExerciseBlock key={we.id} workoutId={workout.id} we={we} />
      ))}

      <button className="btn" onClick={() => setPickerOpen(true)}>
        + {t('train.addExercise')}
      </button>
      {addExercise.isError && <p className="error-text">{t('error.generic')}</p>}

      {pickerOpen && (
        <ExercisePicker
          onClose={handlePickerClose}
          onSelect={(ex) => {
            addExercise.mutate(ex.id);
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}
