import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useI18n } from '../i18n';
import { addDays, dayRangeIso, formatDay, formatTime, sleepDurationLabel, sumBy } from '../lib/format';
import { useMeals, useSleep, useMeasurements, type Meal, type SleepRecord, type Measurement } from '../lib/health';
import { useMe } from '../lib/useMe';
import { MacroBars } from '../components/MacroBars';
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

interface KcalBarProps {
  value: number;
  target: number | null | undefined;
}

function KcalBar({ value, target }: KcalBarProps) {
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

  // Handle ?add=meal|weight|sleep — reacts to searchParams so quick-log
  // navigation works even when already on /health.
  useEffect(() => {
    const add = searchParams.get('add');
    if (!add) return;
    if (add === 'meal') {
      setOpenSheet({ kind: 'meal' });
    } else if (add === 'weight') {
      setOpenSheet({ kind: 'measurement' });
    } else if (add === 'sleep') {
      setOpenSheet({ kind: 'sleep' });
    }
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const meals = mealsQuery.data ?? [];
  const sleepRecords = sleepQuery.data ?? [];
  const measurements = measurementsQuery.data ?? [];

  const totalKcal = sumBy(meals, (m) => m.calories);
  const totalProtein = sumBy(meals, (m) => m.proteinG);
  const totalFat = sumBy(meals, (m) => m.fatG);
  const totalCarbs = sumBy(meals, (m) => m.carbsG);

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
        <KcalBar value={totalKcal} target={me?.targetKcal} />

        <MacroBars
          proteinG={totalProtein}
          fatG={totalFat}
          carbsG={totalCarbs}
          targetProteinG={me?.targetProteinG}
          targetFatG={me?.targetFatG}
          targetCarbsG={me?.targetCarbsG}
        />
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
                {formatTime(meal.eatenAt, locale)}
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
                {sleepDurationLabel(s.bedAt, s.wokeAt)}
              </div>
              <div className="muted">
                {formatTime(s.bedAt, locale)} → {formatTime(s.wokeAt, locale)}
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
                <div>
                  <div className="eyebrow">{t('health.weight')}</div>
                  <div style={{ fontSize: 22, fontWeight: 700 }}>{m.weightKg}</div>
                </div>
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
