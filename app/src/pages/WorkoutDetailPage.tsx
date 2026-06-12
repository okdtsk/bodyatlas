import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { SetInputRow } from '../components/SetInputRow';
import { Skeleton } from '../components/Skeleton';
import { exerciseName, formatDay, formatSet, toLocalInputValue, trimNum } from '../lib/format';
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
    <div className="glow-card stack">
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
              note: s.note ?? '',
            }}
            onSubmit={(input) =>
              updateSet.mutate({ setId: s.id, input }, { onSuccess: () => setEditingSetId(null) })
            }
          />
        ) : (
          <div key={s.id} className="stack" style={{ gap: 2 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
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
            {s.note && <p className="set-note" style={{ margin: 0 }}>{s.note}</p>}
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

  // Track the last time-related mutation variables to show the specific error
  const lastTimeVarsRef = useRef<{ startedAt?: string; endedAt?: string } | null>(null);

  if (isPending) return <Skeleton height={120} count={3} />;
  if (!workout) return <p className="muted">{t('error.generic')}</p>;

  const saveNotes = () => {
    if (notes !== null && notes !== (workout.notes ?? '')) {
      update.mutate(
        { notes: notes === '' ? null : notes },
        { onSuccess: () => setNotes(null) },
      );
    } else if (notes !== null) {
      setNotes(null); // unchanged — release the shadow
    }
  };

  const handleTimeBlur = (field: 'startedAt' | 'endedAt', inputValue: string) => {
    const existing = field === 'startedAt'
      ? toLocalInputValue(String(workout.startedAt))
      : workout.endedAt ? toLocalInputValue(String(workout.endedAt)) : '';
    if (inputValue === existing || inputValue === '') return;
    const iso = new Date(inputValue).toISOString();
    const vars = { [field]: iso } as { startedAt?: string; endedAt?: string };
    lastTimeVarsRef.current = vars;
    update.mutate(vars);
  };

  const showTimeError =
    update.isError &&
    lastTimeVarsRef.current !== null &&
    ('startedAt' in lastTimeVarsRef.current || 'endedAt' in lastTimeVarsRef.current);

  return (
    <section className="stack">
      <h1>{formatDay(String(workout.startedAt), locale)}</h1>

      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('train.startTime')}</span>
          <input
            className="input"
            type="datetime-local"
            aria-label={t('train.startTime')}
            defaultValue={toLocalInputValue(String(workout.startedAt))}
            onBlur={(e) => handleTimeBlur('startedAt', e.currentTarget.value)}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>{t('train.endTime')}</span>
          <input
            className="input"
            type="datetime-local"
            aria-label={t('train.endTime')}
            defaultValue={workout.endedAt ? toLocalInputValue(String(workout.endedAt)) : ''}
            onBlur={(e) => handleTimeBlur('endedAt', e.currentTarget.value)}
          />
        </label>
      </div>

      {showTimeError && (
        <p className="error-text">{t('train.invalidTimeRange')}</p>
      )}

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

      {update.isError && !showTimeError && (
        <p className="error-text">{t('error.generic')}</p>
      )}

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
