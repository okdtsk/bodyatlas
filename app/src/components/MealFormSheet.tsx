import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { parseDecimal, toLocalInputValue } from '../lib/format';
import {
  useCreateMeal,
  useDeleteMeal,
  useToggleFavorite,
  useUpdateMeal,
  useMealSearch,
  type Meal,
  type MealSearchResult,
} from '../lib/health';

export interface MealFormSheetProps {
  defaultDate: Date;
  editing?: Meal | null;
  onClose: () => void;
}

function defaultTimeValue(editing: Meal | null | undefined, defaultDate: Date): string {
  if (editing?.eatenAt) return toLocalInputValue(editing.eatenAt);
  // now-of-defaultDate: same calendar day as defaultDate but current time
  const now = new Date();
  const d = new Date(
    defaultDate.getFullYear(),
    defaultDate.getMonth(),
    defaultDate.getDate(),
    now.getHours(),
    now.getMinutes(),
  );
  return toLocalInputValue(d.toISOString());
}

export function MealFormSheet({ defaultDate, editing, onClose }: MealFormSheetProps) {
  const { t } = useI18n();
  const isCreate = !editing;

  const [name, setName] = useState(editing?.name ?? '');
  const [time, setTime] = useState(() => defaultTimeValue(editing, defaultDate));
  const [kcal, setKcal] = useState(editing?.calories != null ? String(editing.calories) : '');
  const [protein, setProtein] = useState(editing?.proteinG != null ? String(editing.proteinG) : '');
  const [fat, setFat] = useState(editing?.fatG != null ? String(editing.fatG) : '');
  const [carbs, setCarbs] = useState(editing?.carbsG != null ? String(editing.carbsG) : '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [error, setError] = useState('');

  const createMeal = useCreateMeal();
  const updateMeal = useUpdateMeal();
  const deleteMeal = useDeleteMeal();
  const toggleFavorite = useToggleFavorite();

  const { data: searchResults } = useMealSearch(isCreate ? name : '');

  const suggestions: MealSearchResult[] = isCreate && suggestionsOpen && name.trim().length > 0
    ? (searchResults ?? []).slice(0, 5)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function fillFromSuggestion(s: MealSearchResult) {
    setName(s.name);
    if (s.calories != null) setKcal(String(s.calories));
    if (s.proteinG != null) setProtein(String(s.proteinG));
    if (s.fatG != null) setFat(String(s.fatG));
    if (s.carbsG != null) setCarbs(String(s.carbsG));
    setSuggestionsOpen(false);
  }

  function buildInput() {
    return {
      name: name.trim(),
      eatenAt: new Date(time).toISOString(),
      ...(parseDecimal(kcal) !== undefined ? { calories: parseDecimal(kcal) } : {}),
      ...(parseDecimal(protein) !== undefined ? { proteinG: parseDecimal(protein) } : {}),
      ...(parseDecimal(fat) !== undefined ? { fatG: parseDecimal(fat) } : {}),
      ...(parseDecimal(carbs) !== undefined ? { carbsG: parseDecimal(carbs) } : {}),
      ...(notes.trim() !== '' ? { notes: notes.trim() } : {}),
    };
  }

  function handleSave() {
    setError('');
    const input = buildInput();
    if (editing) {
      updateMeal.mutate(
        { id: editing.id, input },
        { onSuccess: onClose, onError: () => setError(t('error.generic')) },
      );
    } else {
      createMeal.mutate(input, {
        onSuccess: onClose,
        onError: () => setError(t('error.generic')),
      });
    }
  }

  function handleDelete() {
    if (!editing) return;
    if (!window.confirm(t('common.confirmDelete'))) return;
    deleteMeal.mutate(editing.id, { onSuccess: onClose, onError: () => setError(t('error.generic')) });
  }

  const isBusy = createMeal.isPending || updateMeal.isPending || deleteMeal.isPending;
  const canSave = name.trim().length > 0 && !isBusy;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet-panel stack"
        role="dialog"
        aria-modal="true"
        aria-label={isCreate ? t('health.addMeal') : t('common.edit')}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Name field with autocomplete */}
        <label className="stack" style={{ gap: 4, position: 'relative' }}>
          {t('health.mealName')}
          <input
            className="input"
            aria-label={t('health.mealName')}
            autoFocus={isCreate}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSuggestionsOpen(true);
            }}
            onBlur={() => {
              // Delay so click on suggestion registers first
              setTimeout(() => setSuggestionsOpen(false), 150);
            }}
          />
          {suggestions.length > 0 && (
            <div className="stack" style={{ gap: 2 }}>
              {suggestions.map((s) => (
                <div
                  key={s.id}
                  className="card tappable row"
                  style={{ justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <button
                    type="button"
                    style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}
                    onClick={() => fillFromSuggestion(s)}
                  >
                    <span>{s.name}</span>
                    {s.calories != null && (
                      <span className="muted" style={{ marginLeft: 8 }}>
                        {s.calories} kcal
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={t('health.favorite')}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite.mutate({ id: s.id, isFavorite: !s.isFavorite });
                    }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    {s.isFavorite ? '★' : '☆'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </label>

        {/* Time field */}
        <label className="stack" style={{ gap: 4 }}>
          {t('health.time')}
          <input
            className="input"
            type="datetime-local"
            aria-label={t('health.time')}
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>

        {/* Nutrition fields */}
        <div className="row" style={{ gap: 8 }}>
          {(
            [
              { label: t('health.calories'), value: kcal, set: setKcal, ariaLabel: 'kcal' },
              { label: t('health.protein'), value: protein, set: setProtein, ariaLabel: 'P' },
              { label: t('health.fat'), value: fat, set: setFat, ariaLabel: 'F' },
              { label: t('health.carbs'), value: carbs, set: setCarbs, ariaLabel: 'C' },
            ] as const
          ).map(({ label, value, set, ariaLabel }) => (
            <label
              key={ariaLabel}
              className="stack"
              style={{ gap: 2, alignItems: 'center', fontSize: 11, color: 'var(--text-muted)' }}
            >
              <input
                className="input input-num"
                inputMode="decimal"
                aria-label={label}
                value={value}
                onChange={(e) => set(e.target.value)}
              />
              {label}
            </label>
          ))}
        </div>

        {/* Notes field */}
        <label className="stack" style={{ gap: 4 }}>
          {t('train.notes')}
          <input
            className="input"
            aria-label={t('train.notes')}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSave}
            onClick={handleSave}
          >
            {t('common.save')}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          {editing && (
            <button
              type="button"
              className="btn"
              style={{ marginLeft: 'auto', color: 'var(--error)' }}
              disabled={isBusy}
              onClick={handleDelete}
            >
              {t('common.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
