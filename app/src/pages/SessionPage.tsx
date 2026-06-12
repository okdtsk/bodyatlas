import { useCallback, useEffect, useReducer, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { ExercisePicker } from '../components/ExercisePicker';
import { Pips } from '../components/Pips';
import { ProgressRing } from '../components/ProgressRing';
import { SetInputRow } from '../components/SetInputRow';
import { Skeleton } from '../components/Skeleton';
import { exerciseName, formatDay, formatSet, weightDelta } from '../lib/format';
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

/** Returns elapsed minutes since startedAt, re-renders every 30s. */
function useElapsedMin(startedAt: string): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(() => tick(), 30_000);
    return () => clearInterval(id);
  }, []);
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 60_000);
}

function ExerciseBlock({
  workoutId,
  we,
  isActive,
  isUpNext,
}: {
  workoutId: string;
  we: ActiveWorkout['workoutExercises'][number];
  isActive: boolean;
  isUpNext: boolean;
}) {
  const { t, locale } = useI18n();
  const { data: last } = useLastSets(we.exercise.id, workoutId);
  const logSet = useLogSet(workoutId, we.id);
  const deleteSet = useDeleteSet(workoutId, we.id);
  const removeExercise = useRemoveWorkoutExercise(workoutId);

  const targetSets = we.targetSets ?? null;
  const delta = last ? weightDelta(we.sets, last.sets) : null;
  const showDelta = delta !== null && delta !== 0;

  const cardClass = [
    'glow-card stack',
    isActive ? 'is-active' : '',
    isUpNext ? 'is-upnext' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClass}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="row" style={{ alignItems: 'center', gap: 8 }}>
          <strong>{exerciseName(we.exercise, locale)}</strong>
          <Pips done={we.sets.length} planned={targetSets} />
        </div>
        <button
          className="btn"
          aria-label={`remove-${we.id}`}
          onClick={() => {
            if (we.sets.length === 0 || window.confirm(t('common.confirmDelete'))) {
              removeExercise.mutate(we.id);
            }
          }}
        >
          ✕
        </button>
      </div>

      {isUpNext && targetSets !== null && (
        <p className="muted" style={{ fontSize: 12 }}>
          {t('train.upNext')} · {targetSets} {t('train.setsPlanned')}
        </p>
      )}

      {!isUpNext && (
        <>
          <div className="muted">
            {showDelta ? (
              <span className={delta > 0 ? 'delta-up' : 'delta-down'}>
                {delta > 0 ? '+' : ''}{delta}kg {t('train.vsLast')} {delta > 0 ? '↗' : '↘'}
              </span>
            ) : (
              <>
                {last === null && t('train.noPrevious')}
                {last && (
                  <>
                    {t('train.lastTime')} ({formatDay(String(last.startedAt), locale)}):{' '}
                    {last.sets.map((s) => formatSet(s)).join(', ')}
                  </>
                )}
              </>
            )}
          </div>

          {we.sets.map((s) => (
            <div key={s.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>
                  <span className="muted">{s.position}.</span> {formatSet(s)}
                </span>
                <button className="btn" onClick={() => deleteSet.mutate(s.id)} aria-label={`delete-set-${s.position}`}>
                  ✕
                </button>
              </div>
              {s.note && <p className="set-note">{s.note}</p>}
            </div>
          ))}

          {/* Input values intentionally persist after logging (common gym pattern: same weight across sets). */}
          <SetInputRow
            exerciseType={we.exercise.type}
            submitLabel={t('train.logSet')}
            busy={logSet.isPending}
            onSubmit={(input) => logSet.mutate(input)}
          />
          {(logSet.isError || deleteSet.isError) && <p className="error-text">{t('error.generic')}</p>}
        </>
      )}
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
  const elapsedMin = useElapsedMin(workout?.startedAt ?? new Date().toISOString());

  const handlePickerClose = useCallback(() => setPickerOpen(false), []);

  if (isPending) return <Skeleton height={120} count={3} />;
  if (!workout) return <Navigate to="/train" replace />;

  const exercises = workout.workoutExercises;

  // activeIndex = max(lastIndexWith(sets.length > 0), 0)
  let activeIndex = 0;
  for (let i = 0; i < exercises.length; i++) {
    const ex = exercises[i];
    if (ex && ex.sets.length > 0) activeIndex = i;
  }

  // Total sets done and planned (for the ring)
  const totalDone = exercises.reduce((sum, we) => sum + we.sets.length, 0);
  const hasAnyTarget = exercises.some((we) => we.targetSets != null);
  const totalPlanned = hasAnyTarget
    ? exercises.reduce((sum, we) => sum + (we.targetSets ?? 0), 0)
    : null;

  const finish = () =>
    update.mutate(
      { finish: true },
      { onSuccess: () => navigate(`/train/workouts/${workout.id}`) },
    );

  return (
    <section className="stack">
      <div className="session-header">
        <ProgressRing done={totalDone} total={totalPlanned} />
        <div className="stack" style={{ gap: 4, flex: 1 }}>
          <p className="eyebrow">
            {elapsedMin} {t('train.elapsedMin')}
          </p>
          <button className="btn btn-primary" onClick={finish} disabled={update.isPending}>
            {t('train.finish')}
          </button>
        </div>
      </div>

      {exercises.map((we, i) => (
        <ExerciseBlock
          key={we.id}
          workoutId={workout.id}
          we={we}
          isActive={i === activeIndex}
          isUpNext={we.sets.length === 0 && i > activeIndex}
        />
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
