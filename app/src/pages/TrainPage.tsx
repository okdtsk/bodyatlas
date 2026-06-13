import { Link, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { Skeleton } from '../components/Skeleton';
import { formatDay } from '../lib/format';
import { useActiveWorkout, useStartWorkout, useTemplates, useWorkouts } from '../lib/train';

export function TrainPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { data: activeData } = useActiveWorkout();
  const { data: templates, isPending: templatesPending } = useTemplates();
  const { data: recent, isPending: recentPending } = useWorkouts({ limit: 10 });
  const start = useStartWorkout();

  const active = activeData?.workout ?? null;
  const lastWorkoutId = recent?.[0]?.id;
  const isFirstRun = !active && !recentPending && recent?.length === 0;

  const begin = (input: { templateId?: string; copyFromWorkoutId?: string }) =>
    start.mutate(input, { onSuccess: () => navigate('/train/session') });

  return (
    <section className="stack">
      <h1>{t('nav.train')}</h1>

      {active && (
        <Link
          to="/train/session"
          className="glow-card is-active tappable"
          style={{ textDecoration: 'none', color: 'var(--text)' }}
        >
          <div className="eyebrow">{t('train.inProgress')}</div>
          <strong style={{ color: 'var(--accent)' }}>{t('train.resume')}</strong>
          <div className="muted">
            {t('train.startedAt')}{' '}
            {new Date(active.startedAt).toLocaleTimeString()}
          </div>
        </Link>
      )}

      {!active && (
        <>
          {isFirstRun && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>{t('empty.train')}</p>
          )}
          <div className="section-title">{t('train.start')}</div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => begin({})} disabled={start.isPending}>
              {t('train.empty')}
            </button>
            {lastWorkoutId && (
              <button
                className="btn"
                onClick={() => begin({ copyFromWorkoutId: lastWorkoutId })}
                disabled={start.isPending}
              >
                {t('train.repeatLast')}
              </button>
            )}
          </div>
          {start.isError && <p className="error-text">{t('error.generic')}</p>}

          <div className="section-title">{t('train.fromTemplate')}</div>
          <div className="stack">
            {templatesPending && <Skeleton height={72} count={3} />}
            {templates?.map((tpl) => (
              <div key={tpl.id} className="glow-card row" style={{ justifyContent: 'space-between' }}>
                <button
                  className="btn"
                  style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none' }}
                  onClick={() => begin({ templateId: tpl.id })}
                  disabled={start.isPending}
                >
                  <strong>{tpl.name}</strong>
                  <span className="muted"> · {tpl.templateExercises.length}</span>
                </button>
                <Link className="muted" to={`/train/templates/${tpl.id}`}>
                  {t('common.edit')}
                </Link>
              </div>
            ))}
            <Link className="btn" style={{ textAlign: 'center', textDecoration: 'none' }} to="/train/templates/new">
              + {t('train.newTemplate')}
            </Link>
          </div>
        </>
      )}

      <div className="section-title">{t('train.recent')}</div>
      <div className="stack">
        {recentPending && <Skeleton height={72} count={3} />}
        {recent?.length === 0 && <p className="muted">{t('train.noWorkouts')}</p>}
        {recent?.map((w) => (
          <Link
            key={w.id}
            to={`/train/workouts/${w.id}`}
            className="glow-card tappable"
            style={{ textDecoration: 'none', color: 'var(--text)' }}
          >
            <strong>{formatDay(String(w.startedAt), locale)}</strong>
            <div className="muted">
              {(locale === 'ja' ? w.exerciseNamesJa : w.exerciseNames).join(' · ')} — <strong>{w.setCount}</strong>{' '}
              {t('train.sets')}
            </div>
          </Link>
        ))}
      </div>

      <Link className="muted" to="/train/exercises">
        {t('train.browseExercises')} →
      </Link>
    </section>
  );
}
