import { useState } from 'react';
import { Link } from 'react-router';
import { useI18n, type MessageKey } from '../i18n';
import { exerciseName } from '../lib/format';
import { useArchiveExercise, useExercises } from '../lib/train';

export function ExercisesPage() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const { data: exercises } = useExercises(q);
  const archive = useArchiveExercise();

  return (
    <section className="stack">
      <h1>{t('train.browseExercises')}</h1>
      <input
        className="input"
        placeholder={t('exercise.search')}
        aria-label={t('exercise.search')}
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="stack" style={{ gap: 4 }}>
        {exercises?.map((ex) => (
          <div key={ex.id} className="card row" style={{ justifyContent: 'space-between' }}>
            <Link to={`/train/exercises/${ex.id}`} style={{ color: 'var(--text)', textDecoration: 'none', flex: 1 }}>
              <strong>{exerciseName(ex, locale)}</strong>
              <div className="muted">
                {t(`muscle.${ex.muscleGroup}` as MessageKey)} · {t(`equip.${ex.equipment}` as MessageKey)}
                {ex.userId !== null && <> · {t('exercise.custom')}</>}
              </div>
            </Link>
            {ex.userId !== null && (
              <button className="btn" onClick={() => archive.mutate(ex.id)} disabled={archive.isPending}>
                {t('exercise.archive')}
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
