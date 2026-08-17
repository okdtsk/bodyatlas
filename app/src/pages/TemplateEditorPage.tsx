import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../i18n';
import { IconClose, IconMoveDown, IconMoveUp, IconPlus } from '../components/icons';
import { ExercisePicker } from '../components/ExercisePicker';
import { Skeleton } from '../components/Skeleton';
import { exerciseName } from '../lib/format';
import { useDeleteTemplate, useSaveTemplate, useTemplates, type Exercise } from '../lib/train';

type Row = { exercise: Pick<Exercise, 'id' | 'nameEn' | 'nameJa'>; targetSets?: number };

export function TemplateEditorPage() {
  const { t, locale } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: templates } = useTemplates();
  const save = useSaveTemplate(id);
  const del = useDeleteTemplate();

  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const existing = id ? templates?.find((tpl) => tpl.id === id) : undefined;

  useEffect(() => {
    if (existing && !loaded) {
      setName(existing.name);
      setRows(
        existing.templateExercises.map((te) => ({
          exercise: te.exercise,
          targetSets: te.targetSets ?? undefined,
        })),
      );
      setLoaded(true);
    }
  }, [existing, loaded]);

  // For the edit case, show nothing until the template is loaded from the cache.
  if (id && !loaded && templates !== undefined && !existing) {
    return <p className="muted">{t('error.generic')}</p>;
  }
  if (id && !loaded && templates === undefined) {
    return (
      <section className="stack">
        <h1>{t('train.editTemplate')}</h1>
        <Skeleton height={72} count={3} />
      </section>
    );
  }

  const move = (index: number, delta: -1 | 1) => {
    setRows((prev) => {
      const next = [...prev];
      const j = index + delta;
      if (j < 0 || j >= next.length) return prev;
      const a = next[index]!;
      next[index] = next[j]!;
      next[j] = a;
      return next;
    });
  };

  const submit = () =>
    save.mutate(
      {
        name,
        exercises: rows.map((r) => ({
          exerciseId: r.exercise.id,
          ...(r.targetSets !== undefined ? { targetSets: r.targetSets } : {}),
        })),
      },
      { onSuccess: () => navigate('/train') },
    );

  return (
    <section className="stack">
      <h1>{id ? t('train.editTemplate') : t('train.newTemplate')}</h1>

      <label className="stack" style={{ gap: 4 }}>
        {t('train.templateName')}
        <input
          className="input"
          aria-label={t('train.templateName')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="stack" style={{ gap: 4 }}>
        {rows.map((row, i) => (
          <div key={`${row.exercise.id}-${i}`} className="panel row" style={{ justifyContent: 'space-between' }}>
            <span>{exerciseName(row.exercise, locale)}</span>
            <span className="row">
              <input
                className="input input-num"
                inputMode="numeric"
                aria-label={t('train.targetSets')}
                placeholder={t('train.targetSets')}
                value={row.targetSets ?? ''}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  setRows((prev) =>
                    prev.map((r, j) =>
                      j === i
                        ? { ...r, targetSets: Number.isNaN(parsed) ? undefined : parsed }
                        : r,
                    ),
                  );
                }}
              />
              <button className="btn btn-ghost btn-icon" aria-label={`up-${i}`} onClick={() => move(i, -1)}>
                <IconMoveUp size={18} weight="bold" aria-hidden />
              </button>
              <button className="btn btn-ghost btn-icon" aria-label={`down-${i}`} onClick={() => move(i, 1)}>
                <IconMoveDown size={18} weight="bold" aria-hidden />
              </button>
              <button
                className="btn btn-ghost btn-icon"
                aria-label={`remove-${i}`}
                onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
              >
                <IconClose size={18} weight="bold" aria-hidden />
              </button>
            </span>
          </div>
        ))}
      </div>

      <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
        <IconPlus size={18} weight="bold" aria-hidden /> {t('train.addExercise')}
      </button>

      <div className="row">
        <button
          className="btn btn-primary"
          onClick={submit}
          disabled={save.isPending || name.trim() === '' || rows.length === 0}
        >
          {t('common.save')}
        </button>
        {id && (
          <button
            className="btn btn-danger"
            onClick={() => {
              if (window.confirm(t('common.confirmDelete'))) {
                del.mutate(id, { onSuccess: () => navigate('/train') });
              }
            }}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
      {save.isError && <p className="error-text">{t('error.generic')}</p>}

      {pickerOpen && (
        <ExercisePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(ex) => {
            setRows((prev) => [...prev, { exercise: ex }]);
            setPickerOpen(false);
          }}
        />
      )}
    </section>
  );
}
