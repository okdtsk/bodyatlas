import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useI18n } from '../i18n';
import { addDays, dayRangeIso, formatDay, formatKcal, formatTime, sleepDurationLabel, sumBy, trimNum } from '../lib/format';
import { useMeals, useSleep, useMeasurements, type Meal, type SleepRecord, type Measurement } from '../lib/health';
import { useMe } from '../lib/useMe';
import { MacroBars } from '../components/MacroBars';
import { Skeleton } from '../components/Skeleton';
import { MealFormSheet } from '../components/MealFormSheet';
import { SleepFormSheet } from '../components/SleepFormSheet';
import { MeasurementFormSheet } from '../components/MeasurementFormSheet';
import { PendingBadge } from '../components/PendingBadge';
import { useQueuedOpsByKind } from '../lib/offline/usePendingOps';
import { IconPrev, IconNext, IconStar } from '../components/icons';

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
        borderRadius: 'var(--radius-sm)',
        height: 4,
        overflow: 'hidden',
        flex: 1,
        minWidth: 48,
      }}
    >
      <div className="bar-fill" style={{ width: `${pct}%` }} />
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

  const pendingMeals = useQueuedOpsByKind('meal');
  const pendingSleep = useQueuedOpsByKind('sleep');
  const pendingMeasurements = useQueuedOpsByKind('measurement');

  const totalKcal = sumBy(meals, (m) => m.calories);
  const totalProtein = sumBy(meals, (m) => m.proteinG);
  const totalFat = sumBy(meals, (m) => m.fatG);
  const totalCarbs = sumBy(meals, (m) => m.carbsG);

  const closeSheet = () => setOpenSheet(null);

  const anyLoading =
    mealsQuery.isPending || sleepQuery.isPending || measurementsQuery.isPending;
  const isEmpty =
    !anyLoading &&
    meals.length === 0 &&
    pendingMeals.length === 0 &&
    sleepRecords.length === 0 &&
    pendingSleep.length === 0 &&
    measurements.length === 0 &&
    pendingMeasurements.length === 0;

  return (
    <section aria-label={t('nav.health')}>
      {/* Day navigation header */}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, alignItems: 'center' }}>
        <button
          className="btn btn-ghost btn-icon"
          aria-label="prev-day"
          onClick={() => setSelectedDate((d) => addDays(d, -1))}
        >
          <IconPrev size={20} weight="bold" aria-hidden />
        </button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700 }}>{formatDay(selectedDate.toISOString(), locale)}</div>
          {isToday(selectedDate) && (
            <span className="chip chip-accent" style={{ fontWeight: 600 }}>
              {t('health.today')}
            </span>
          )}
        </div>
        <button
          className="btn btn-ghost btn-icon"
          aria-label="next-day"
          onClick={() => setSelectedDate((d) => addDays(d, 1))}
        >
          <IconNext size={20} weight="bold" aria-hidden />
        </button>
      </div>

      {/* Daily total card */}
      <div className="panel" data-state="active" style={{ marginBottom: 'var(--sp-4)' }}>
        <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)', marginBottom: 'var(--sp-3)' }}>
          <span className="metric metric-x">{formatKcal(totalKcal)}</span>
          <span className="metric-unit">
            {me?.targetKcal != null ? `/ ${formatKcal(me.targetKcal)} ` : ''}
            {t('health.calories')}
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

      {isEmpty && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>{t('empty.health')}</p>
      )}

      {/* Meals section */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="label" style={{ margin: 0 }}>{t('health.meals')}</div>
        <button
          className="btn btn-primary"
          style={{ fontSize: 'var(--fs-label)', padding: '5px 12px' }}
          onClick={() => setOpenSheet({ kind: 'meal' })}
        >
          {t('health.addMeal')}
        </button>
      </div>

      {mealsQuery.isPending ? (
        <Skeleton count={2} height={52} />
      ) : meals.length === 0 && pendingMeals.length === 0 ? (
        <p className="muted">{t('health.noMeals')}</p>
      ) : (
        <div className="stack" style={{ marginTop: 8, gap: 6 }}>
          {pendingMeals.map((op) => (
            <div
              key={op.id}
              className="panel"
              style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: 0.7 }}
            >
              <span style={{ flex: 1, fontWeight: 500 }}>{String(op.payload.name ?? '')}</span>
              <PendingBadge failed={op.status === 'failed'} />
            </div>
          ))}
          {meals.map((meal) => (
            <div
              key={meal.id}
              className="panel tappable"
              style={{ display: 'flex', alignItems: 'center', gap: 10 }}
              onClick={() => setOpenSheet({ kind: 'meal', editing: meal })}
            >
              <span className="metric" style={{ fontSize: 'var(--fs-label)', minWidth: 42 }}>
                {formatTime(meal.eatenAt, locale)}
              </span>
              <span style={{ flex: 1, fontWeight: 500 }}>{meal.name}</span>
              {meal.calories != null && (
                <span className="metric" style={{ fontSize: 'var(--fs-label)' }}>
                  {formatKcal(meal.calories)} {t('health.calories')}
                </span>
              )}
              {meal.isFavorite && (
                <IconStar size={14} weight="fill" color="var(--accent-ink)" aria-label={t('health.favorite')} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Sleep section */}
      <div className="label" style={{ marginTop: 20, marginBottom: 8 }}>{t('health.sleep')}</div>
      {sleepQuery.isPending ? (
        <Skeleton height={72} />
      ) : sleepRecords.length === 0 && pendingSleep.length === 0 ? (
        <div>
          <p className="muted">{t('health.noSleep')}</p>
          <button
            className="btn"
            style={{ fontSize: 'var(--fs-label)', padding: '5px 12px', marginTop: 6 }}
            onClick={() => setOpenSheet({ kind: 'sleep' })}
          >
            {t('health.addSleep')}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {pendingSleep.map((op) => (
            <div
              key={op.id}
              className="panel"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.7 }}
            >
              <span>{t('health.sleep')}</span>
              <PendingBadge failed={op.status === 'failed'} />
            </div>
          ))}
          {sleepRecords.map((s) => (
            <div
              key={s.id}
              className="panel tappable"
              onClick={() => setOpenSheet({ kind: 'sleep', editing: s })}
            >
              <div className="metric" style={{ marginBottom: 'var(--sp-1)' }}>
                {sleepDurationLabel(s.bedAt, s.wokeAt)}
              </div>
              <div className="muted">
                {formatTime(s.bedAt, locale)} → {formatTime(s.wokeAt, locale)}
              </div>
              {s.quality != null && (
                <div
                  className="row"
                  style={{ gap: 2, marginTop: 4 }}
                  aria-label={`${t('field.quality')}: ${s.quality}/5`}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <IconStar
                      key={n}
                      size={14}
                      weight={n <= s.quality! ? 'fill' : 'regular'}
                      color={n <= s.quality! ? 'var(--accent-ink)' : 'var(--text-muted)'}
                      aria-hidden
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Body section */}
      <div className="label" style={{ marginTop: 20, marginBottom: 8 }}>{t('health.body')}</div>
      {measurementsQuery.isPending ? (
        <Skeleton height={64} />
      ) : measurements.length === 0 && pendingMeasurements.length === 0 ? (
        <div>
          <p className="muted">{t('health.noMeasurement')}</p>
          <button
            className="btn"
            style={{ fontSize: 'var(--fs-label)', padding: '5px 12px', marginTop: 6 }}
            onClick={() => setOpenSheet({ kind: 'measurement' })}
          >
            {t('health.addMeasurement')}
          </button>
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {pendingMeasurements.map((op) => (
            <div
              key={op.id}
              className="panel"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', opacity: 0.7 }}
            >
              <span>
                {op.payload.weightKg != null
                  ? `${trimNum(Number(op.payload.weightKg))} ${t('health.weight')}`
                  : op.payload.bodyFatPct != null
                    ? `${trimNum(Number(op.payload.bodyFatPct))}% ${t('health.bodyFat')}`
                    : t('health.body')}
              </span>
              <PendingBadge failed={op.status === 'failed'} />
            </div>
          ))}
          {measurements.map((m) => (
            <div
              key={m.id}
              className="panel tappable"
              onClick={() => setOpenSheet({ kind: 'measurement', editing: m })}
            >
              {m.weightKg != null && (
                <div>
                  <div className="label">{t('health.weight')}</div>
                  <div className="metric">{trimNum(m.weightKg)}</div>
                </div>
              )}
              {m.bodyFatPct != null && (
                <div className="muted">{trimNum(m.bodyFatPct)}% {t('health.bodyFat')}</div>
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
