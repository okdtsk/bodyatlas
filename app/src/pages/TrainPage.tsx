import { Link, useNavigate } from 'react-router';
import { useI18n } from '../i18n';
import { Skeleton } from '../components/Skeleton';
import { formatDay } from '../lib/format';
import { useActiveWorkout, useStartWorkout, useTemplates, useWorkouts } from '../lib/train';
import { IconEdit } from '../components/icons';

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
        <Link to="/train/session" className="block-accent">
          <strong style={{ fontSize: 'var(--fs-title)' }}>{t('train.resume')}</strong>
          <div className="muted">
            {t('train.startedAt')} {new Date(active.startedAt).toLocaleTimeString()}
          </div>
        </Link>
      )}

      {!active && (
        <>
          {isFirstRun && (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>{t('empty.train')}</p>
          )}
          <div className="label">{t('train.start')}</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: lastWorkoutId ? '1fr 1fr' : '1fr',
              gap: 'var(--sp-3)',
            }}
          >
            <button className="btn btn-primary btn-lg" onClick={() => begin({})} disabled={start.isPending}>
              {t('train.empty')}
            </button>
            {lastWorkoutId && (
              <button
                className="btn btn-secondary btn-lg"
                onClick={() => begin({ copyFromWorkoutId: lastWorkoutId })}
                disabled={start.isPending}
              >
                {t('train.repeatLast')}
              </button>
            )}
          </div>
          {start.isError && <p className="error-text">{t('error.generic')}</p>}

          <div className="stack">
            {templatesPending && <Skeleton height={72} count={3} />}
            {templates?.map((tpl) => (
              <div key={tpl.id} className="panel row" style={{ justifyContent: 'space-between' }}>
                <button
                  className="btn btn-ghost"
                  style={{ flex: 1, justifyContent: 'flex-start' }}
                  onClick={() => begin({ templateId: tpl.id })}
                  disabled={start.isPending}
                >
                  <strong>{tpl.name}</strong>
                  <span className="chip">{tpl.templateExercises.length}</span>
                </button>
                <Link className="btn btn-ghost btn-icon" to={`/train/templates/${tpl.id}`} aria-label={t('common.edit')}>
                  <IconEdit size={20} weight="bold" aria-hidden />
                </Link>
              </div>
            ))}
            <Link className="btn" style={{ textAlign: 'center', textDecoration: 'none' }} to="/train/templates/new">
              + {t('train.newTemplate')}
            </Link>
          </div>
        </>
      )}

      <div className="label">{t('train.recent')}</div>
      <div className="stack">
        {recentPending && <Skeleton height={72} count={3} />}
        {recent?.length === 0 && <p className="muted">{t('train.noWorkouts')}</p>}
        {recent?.map((w) => (
          <Link
            key={w.id}
            to={`/train/workouts/${w.id}`}
            className="panel tappable"
            style={{ textDecoration: 'none', color: 'var(--text)' }}
          >
            <strong>{formatDay(String(w.startedAt), locale)}</strong>
            <div className="muted">
              {(locale === 'ja' ? w.exerciseNamesJa : w.exerciseNames).join(', ')}{' '}
              <span className="metric" style={{ fontSize: 'var(--fs-label)' }}>{w.setCount}</span> {t('train.sets')}
            </div>
          </Link>
        ))}
      </div>

      <Link className="muted" to="/train/exercises">
        {t('train.browseExercises')}
      </Link>
    </section>
  );
}
