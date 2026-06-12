import { Link, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { formatDay } from '../lib/format';
import { useWorkouts } from '../lib/train';

export function ExerciseHistoryPage() {
  const { t, locale } = useI18n();
  const { id = '' } = useParams();
  const { data: workouts } = useWorkouts({ exerciseId: id, limit: 50 });

  return (
    <section className="stack">
      <h1>{t('train.history')}</h1>
      {workouts?.length === 0 && <p className="muted">{t('train.noWorkouts')}</p>}
      {workouts?.map((w) => (
        <Link
          key={w.id}
          to={`/train/workouts/${w.id}`}
          className="card tappable"
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
