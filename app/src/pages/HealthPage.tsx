import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useI18n } from '../i18n';
import { addDays, dayRangeIso, formatDay, formatTime, sleepDurationLabel } from '../lib/format';
import { useMeals, useSleep, useMeasurements, type Meal, type SleepRecord, type Measurement } from '../lib/health';
import { useMe } from '../lib/useMe';
import { Skeleton } from '../components/Skeleton';
import { MealFormSheet } from '../components/MealFormSheet';
import { SleepFormSheet } from '../components/SleepFormSheet';
import { MeasurementFormSheet } from '../components/MeasurementFormSheet';

type SheetState =
  | null
  | { kind: 'meal'; editing?: Meal | null }
  | { kind: 'sleep'; editing?: SleepRecord | null }
  | { kind: 'measurement'; editing?: Measurement | null };

function isToday(d: Date): boolean {
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function sum(meals: Meal[], field: keyof Pick<Meal, 'calories' | 'proteinG' | 'fatG' | 'carbsG'>): number {
  return meals.reduce((acc, m) => acc + (m[field] ?? 0), 0);
}

interface ProgressBarProps {
  value: number;
  target: number | null | undefined;
}

function ProgressBar({ value, target }: ProgressBarProps) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div
      style={{
        background: 'var(--surface-2)',
        borderRadius: 2,
        height: 4,
        overflow: 'hidden',
        flex: 1,
        minWidth: 48,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: '100%',
          background: 'var(--accent)',
          borderRadius: 2,
          transition: 'width 0.2s',
        }}
      />
    </div>
  );
}

export function HealthPage() {
  const { t, locale } = useI18n();
  const { data: me } = useMe();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [openSheet, setOpenSheet] = useState<SheetState>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const { fromIso, toIso } = dayRangeIso(selectedDate);

  const mealsQuery = useMeals(fromIso, toIso);
  const sleepQuery = useSleep(fromIso, toIso);
  const measurementsQuery = useMeasurements(fromIso, toIso);

  // Handle ?add=meal|weight|sleep on mount
  useEffect(() => {
    const add = searchParams.get('add');
    if (add === 'meal') {
      setOpenSheet({ kind: 'meal' });
      setSearchParams({}, { replace: true });
    } else if (add === 'weight') {
      setOpenSheet({ kind: 'measurement' });
      setSearchParams({}, { replace: true });
    } else if (add === 'sleep') {
      setOpenSheet({ kind: 'sleep' });
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const meals = mealsQuery.data ?? [];
  const sleepRecords = sleepQuery.data ?? [];
  const measurements = measurementsQuery.data ?? [];

  const totalKcal = sum(meals, 'calories');
  const totalProtein = sum(meals, 'proteinG');
  const totalFat = sum(meals, 'fatG');
  const totalCarbs = sum(meals, 'carbsG');

  const closeSheet = () => setOpenSheet(null);

  return (
    <section>
      {/* Day navigation header */}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <button
          className="btn"
          aria-label="prev-day"
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
          style={{ padding: '6px 12px' }}
        >
          ◀
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>{formatDay(selectedDate.toISOString(), locale)}</div>
          {isToday(selectedDate) && (
            <span
              style={{
                fontSize: 11,
                background: 'var(--accent)',
                color: 'var(--accent-contrast)',
                borderRadius: 8,
                padding: '1px 7px',
                fontWeight: 600,
              }}
            >
              {t('health.today')}
            </span>
          )}
        </div>
        <button
          className="btn"
          aria-label="next-day"
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
          style={{ padding: '6px 12px' }}
        >
          ▶
        </button>
      </div>

      {/* Daily total card */}
      <div className="glow-card is-active" style={{ marginBottom: 16 }}>
        <div className="eyebrow" style={{ marginBottom: 8 }}>{t('health.dailyTotal')}</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 32, fontWeight: 800 }}>
            {totalKcal.toLocaleString()}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            / {me?.targetKcal != null ? me.targetKcal.toLocaleString() : '—'} {t('health.calories')}
          </span>
        </div>
        <ProgressBar value={totalKcal} target={me?.targetKcal} />

        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* Protein */}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, width: 12, color: 'var(--text-muted)' }}>{t('health.protein')}</span>
            <span style={{ fontSize: 13, minWidth: 80 }}>
              {totalProtein}g / {me?.targetProteinG != null ? `${me.targetProteinG}g` : '—'}
            </span>
            <ProgressBar value={totalProtein} target={me?.targetProteinG} />
          </div>
          {/* Fat */}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, width: 12, color: 'var(--text-muted)' }}>{t('health.fat')}</span>
            <span style={{ fontSize: 13, minWidth: 80 }}>
              {totalFat}g / {me?.targetFatG != null ? `${me.targetFatG}g` : '—'}
            </span>
            <ProgressBar value={totalFat} target={me?.targetFatG} />
          </div>
          {/* Carbs */}
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, width: 12, color: 'var(--text-muted)' }}>{t('health.carbs')}</span>
            <span style={{ fontSize: 13, minWidth: 80 }}>
              {totalCarbs}g / {me?.targetCarbsG != null ? `${me.targetCarbsG}g` : '—'}
            </span>
            <ProgressBar value={totalCarbs} target={me?.targetCarbsG} />
          </div>
        </div>
      </div>

      {/* Meals section */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="section-title" style={{ margin: 0 }}>{t('health.meals')}</div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 13, padding: '5px 12px' }}
          onClick={() => setOpenSheet({ kind: 'meal' })}
        >
          {t('health.addMeal')}
        </button>
      </div>

      {mealsQuery.isPending ? (
        <Skeleton count={2} height={52} />
      ) : meals.length === 0 ? (
        <p className="muted">{t('health.noMeals')}</p>
      ) : (
        <div className="stack" style={{ marginTop: 8, gap: 6 }}>
          {meals.map((meal) => (
            <div
              key={meal.id}
              className="card tappable"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              onClick={() => setOpenSheet({ kind: 'meal', editing: meal })}
            >
              <span className="muted" style={{ minWidth: 42 }}>
                {formatTime(meal.eatenAt as unknown as string, locale)}
              </span>
              <span style={{ flex: 1, fontWeight: 500 }}>{meal.name}</span>
              {meal.calories != null && (
                <span className="muted">{meal.calories} {t('health.calories')}</span>
              )}
              {meal.isFavorite && <span>★</span>}
            </div>
          ))}
        </div>
      )}

      {/* Sleep section */}
      <div className="section-title" style={{ marginTop: 20, marginBottom: 8 }}>{t('health.sleep')}</div>
      {sleepQuery.isPending ? (
        <Skeleton height={72} />
      ) : sleepRecords.length === 0 ? (
        <div>
          <p className="muted">{t('health.noSleep')}</p>
          <button
            className="btn"
            style={{ fontSize: 13, padding: '5px 12px', marginTop: 6 }}
            onClick={() => setOpenSheet({ kind: 'sleep' })}
          >
            {t('health.addSleep')}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {sleepRecords.map((s) => (
            <div
              key={s.id}
              className="card tappable"
              onClick={() => setOpenSheet({ kind: 'sleep', editing: s })}
            >
              <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
                {sleepDurationLabel(s.bedAt as unknown as string, s.wokeAt as unknown as string)}
              </div>
              <div className="muted">
                {formatTime(s.bedAt as unknown as string, locale)} → {formatTime(s.wokeAt as unknown as string, locale)}
              </div>
              {s.quality != null && (
                <div style={{ marginTop: 4 }}>{'★'.repeat(s.quality)}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Body section */}
      <div className="section-title" style={{ marginTop: 20, marginBottom: 8 }}>{t('health.body')}</div>
      {measurementsQuery.isPending ? (
        <Skeleton height={64} />
      ) : measurements.length === 0 ? (
        <div>
          <p className="muted">{t('health.noMeasurement')}</p>
          <button
            className="btn"
            style={{ fontSize: 13, padding: '5px 12px', marginTop: 6 }}
            onClick={() => setOpenSheet({ kind: 'measurement' })}
          >
            {t('health.addMeasurement')}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {measurements.map((m) => (
            <div
              key={m.id}
              className="card tappable"
              onClick={() => setOpenSheet({ kind: 'measurement', editing: m })}
            >
              {m.weightKg != null && (
                <div style={{ fontSize: 22, fontWeight: 700 }}>{m.weightKg} kg</div>
              )}
              {m.bodyFatPct != null && (
                <div className="muted">{m.bodyFatPct}% {t('health.bodyFat')}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sheets */}
      {openSheet?.kind === 'meal' && (
        <MealFormSheet
          defaultDate={selectedDate}
          editing={openSheet.editing}
          onClose={closeSheet}
        />
      )}
      {openSheet?.kind === 'sleep' && (
        <SleepFormSheet
          defaultDate={selectedDate}
          editing={openSheet.editing}
          onClose={closeSheet}
        />
      )}
      {openSheet?.kind === 'measurement' && (
        <MeasurementFormSheet
          defaultDate={selectedDate}
          editing={openSheet.editing}
          onClose={closeSheet}
        />
      )}
    </section>
  );
}
