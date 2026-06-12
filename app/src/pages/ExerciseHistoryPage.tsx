import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { Skeleton } from '../components/Skeleton';
import { exerciseName, formatDay } from '../lib/format';
import { useExercises, useWorkouts } from '../lib/train';

export function ExerciseHistoryPage() {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const { data: workouts, isPending } = useWorkouts({ exerciseId: id, limit: 50 });
  const { data: exercises } = useExercises('');
  const found = exercises?.find((ex) => ex.id === id);
  const title = found ? exerciseName(found, locale) : t('train.history');

  return (
    <section className="stack">
      <h1>{title}</h1>
      {isPending && <Skeleton height={72} count={3} />}
      {workouts?.length === 0 && <p className="muted">{t('train.noWorkouts')}</p>}
      {workouts?.map((w) => (
        <Link
          key={w.id}
          to={`/train/workouts/${w.id}`}
          className="glow-card tappable"
          style={{ textDecoration: 'none', color: 'var(--text)' }}
        >
          <strong>{formatDay(String(w.startedAt), locale)}</strong>
          <div className="muted">
            {(locale === 'ja' ? w.exerciseNamesJa : w.exerciseNames).join(' · ')} — {w.setCount}{' '}
            {t('train.sets')}
          </div>
        </Link>
      ))}
    </section>
  );
}
