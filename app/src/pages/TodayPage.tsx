import { useMemo } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { dayRangeIso, formatKcal, sleepDurationLabel, sumBy, trimNum } from '../lib/format';
import { useMeals, useSleep, useMeasurements } from '../lib/health';
import { rangeFromIso } from '../lib/buckets';
import { useActiveWorkout, useWorkouts } from '../lib/train';
import { useMe } from '../lib/useMe';
import { MacroBars } from '../components/MacroBars';
import { Sparkline } from '../components/charts/Sparkline';
import { Skeleton } from '../components/Skeleton';
import { IconCheck, IconStar } from '../components/icons';

function isSameDay(isoA: string, isoB: string): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function TodayPage() {
  const { t, locale } = useI18n();
  const { data: me } = useMe();

  const today = useMemo(() => new Date(), []);
  const { fromIso: todayFrom, toIso: todayTo } = useMemo(() => dayRangeIso(today), [today]);
  const fourWeeksAgo = useMemo(() => rangeFromIso('4w'), []);
  const nowIso = useMemo(() => today.toISOString(), [today]);

  // Nutrition
  const mealsQuery = useMeals(todayFrom, todayTo);
  const meals = mealsQuery.data ?? [];
  const totalKcal = sumBy(meals, (m) => m.calories);
  const totalProtein = sumBy(meals, (m) => m.proteinG);
  const totalFat = sumBy(meals, (m) => m.fatG);
  const totalCarbs = sumBy(meals, (m) => m.carbsG);

  // Workout
  const activeQuery = useActiveWorkout();
  const recentWorkoutsQuery = useWorkouts({ limit: 1 });
  const activeWorkout = activeQuery.data?.workout ?? null;
  const latestWorkout = recentWorkoutsQuery.data?.[0] ?? null;
  const doneToday = !activeWorkout && latestWorkout != null && isSameDay(latestWorkout.startedAt, nowIso);

  // Weight (4-week window)
  const measurementsQuery = useMeasurements(fourWeeksAgo, nowIso);
  const measurements = measurementsQuery.data ?? [];
  const latestWeight = measurements.length > 0 ? measurements[measurements.length - 1] : null;
  const sparklinePoints = measurements
    .filter((m) => m.weightKg != null)
    .map((m) => ({ x: new Date(m.measuredAt).getTime(), y: m.weightKg as number }));

  // Sleep (last night — use today's window; sleep logged for last night falls in this window)
  const sleepQuery = useSleep(todayFrom, todayTo);
  const sleepRecords = sleepQuery.data ?? [];
  const lastSleep = sleepRecords.length > 0 ? sleepRecords[0] : null;

  const anyLoading =
    mealsQuery.isPending ||
    activeQuery.isPending ||
    recentWorkoutsQuery.isPending ||
    measurementsQuery.isPending ||
    sleepQuery.isPending;
  const isEmpty =
    !anyLoading &&
    meals.length === 0 &&
    !activeWorkout &&
    !doneToday &&
    latestWeight?.weightKg == null &&
    lastSleep == null;

  return (
    <section aria-label={t('nav.today')}>
      {isEmpty && <p className="muted" style={{ textAlign: 'center', padding: 'var(--sp-5)' }}>{t('empty.today')}</p>}

      <div className="stack" style={{ gap: 'var(--sp-3)' }}>
        {/* Tier 1 - the one actionable thing. Exactly one accent block per screen. */}
        {activeWorkout ? (
          <Link to="/train/session" className="block-accent rise-in">
            <strong style={{ fontSize: 'var(--fs-title)' }}>{t('train.resume')}</strong>
            <div className="muted">{t('train.inProgress')}</div>
          </Link>
        ) : doneToday ? (
          <div className="panel rise-in" data-state="active">
            <div className="row">
              <IconCheck size={20} weight="bold" aria-hidden />
              <strong>{t('today.done')}</strong>
            </div>
            {latestWorkout && (
              <div className="muted">
                {(locale === 'ja' ? latestWorkout.exerciseNamesJa : latestWorkout.exerciseNames)?.join(', ')}
              </div>
            )}
          </div>
        ) : (
          <Link to="/train" className="block-accent rise-in">
            <strong style={{ fontSize: 'var(--fs-title)' }}>{t('train.start')}</strong>
            <div className="muted">{t('today.restDay')}</div>
          </Link>
        )}

        {/* Tier 2 - the hero metric. No label: the number states what it is. */}
        <Link to="/health" className="panel tappable rise-in" style={{ animationDelay: '60ms' }}>
          {mealsQuery.isPending ? (
            <Skeleton height={72} />
          ) : (
            <>
              <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                <span className="metric metric-x">{formatKcal(totalKcal)}</span>
                <span className="metric-unit">
                  {me?.targetKcal != null ? `/ ${formatKcal(me.targetKcal)} ` : ''}
                  kcal {t('today.eaten')}
                </span>
              </div>
              <MacroBars
                proteinG={totalProtein} fatG={totalFat} carbsG={totalCarbs}
                targetProteinG={me?.targetProteinG} targetFatG={me?.targetFatG}
                targetCarbsG={me?.targetCarbsG}
              />
            </>
          )}
        </Link>

        {/* Tier 3 - glanceable secondaries, 2-up. These keep their labels because
            "72.4" and "7h 20m" are ambiguous without one. */}
        <div className="row" style={{ gap: 'var(--sp-3)', alignItems: 'stretch' }}>
          <Link to="/health" className="panel tappable rise-in" style={{ flex: 1, animationDelay: '120ms' }}>
            <div className="label">{t('today.weight')}</div>
            {measurementsQuery.isPending ? (
              <Skeleton height={40} />
            ) : latestWeight?.weightKg != null ? (
              <div className="row" style={{ alignItems: 'baseline', gap: 'var(--sp-2)' }}>
                <span className="metric">{trimNum(latestWeight.weightKg)}</span>
                <span className="metric-unit">kg</span>
                {sparklinePoints.length > 1 && <Sparkline points={sparklinePoints} />}
              </div>
            ) : (
              <p className="muted">{t('today.noWeight')}</p>
            )}
          </Link>

          <Link to="/health" className="panel tappable rise-in" style={{ flex: 1, animationDelay: '180ms' }}>
            <div className="label">{t('today.sleep')}</div>
            {sleepQuery.isPending ? (
              <Skeleton height={40} />
            ) : lastSleep ? (
              <>
                <span className="metric">{sleepDurationLabel(lastSleep.bedAt, lastSleep.wokeAt)}</span>
                {lastSleep.quality != null && (
                  <div className="row" style={{ gap: 2 }} aria-label={`${t('field.quality')}: ${lastSleep.quality}/5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <IconStar
                        key={n} size={14} weight={n <= lastSleep.quality! ? 'fill' : 'regular'}
                        color={n <= lastSleep.quality! ? 'var(--accent-ink)' : 'var(--text-muted)'}
                        aria-hidden
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="muted">{t('today.noSleep')}</p>
            )}
          </Link>
        </div>
      </div>
    </section>
  );
}
