import { useMemo } from 'react';
import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { dayRangeIso, sleepDurationLabel, sumBy } from '../lib/format';
import { useMeals, useSleep, useMeasurements } from '../lib/health';
import { rangeFromIso } from '../lib/buckets';
import { useActiveWorkout, useWorkouts } from '../lib/train';
import { useMe } from '../lib/useMe';
import { MacroBars } from '../components/MacroBars';
import { Sparkline } from '../components/charts/Sparkline';
import { Skeleton } from '../components/Skeleton';

function isSameDay(isoA: string, isoB: string): boolean {
  const a = new Date(isoA);
  const b = new Date(isoB);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function TodayPage() {
  const { t } = useI18n();
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
    <section>
      <h1 className="section-title" style={{ marginBottom: 16 }}>{t('nav.today')}</h1>

      {isEmpty && (
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24 }}>{t('empty.today')}</p>
      )}

      <div className="stack" style={{ gap: 12 }}>
        {/* Nutrition card */}
        <Link to="/health" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="glow-card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t('health.calories')}</div>
            {mealsQuery.isPending ? (
              <Skeleton height={40} />
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 32, fontWeight: 800 }}>
                    {totalKcal.toLocaleString()}
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                    / {me?.targetKcal != null ? me.targetKcal.toLocaleString() : '—'} kcal {t('today.eaten')}
                  </span>
                </div>
                <MacroBars
                  proteinG={totalProtein}
                  fatG={totalFat}
                  carbsG={totalCarbs}
                  targetProteinG={me?.targetProteinG}
                  targetFatG={me?.targetFatG}
                  targetCarbsG={me?.targetCarbsG}
                />
              </>
            )}
          </div>
        </Link>

        {/* Workout card */}
        {activeWorkout ? (
          <Link to="/train/session" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="glow-card is-active">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{t('today.workout')}</div>
              {activeQuery.isPending ? (
                <Skeleton height={32} />
              ) : (
                <div style={{ fontWeight: 700, fontSize: 18 }}>{t('train.inProgress')}</div>
              )}
            </div>
          </Link>
        ) : (
          <Link to="/train" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="glow-card">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{t('today.workout')}</div>
              {activeQuery.isPending || recentWorkoutsQuery.isPending ? (
                <Skeleton height={32} />
              ) : doneToday ? (
                <>
                  <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--positive)' }}>
                    ✓ {t('today.done')}
                  </div>
                  {latestWorkout && (
                    <div className="muted" style={{ marginTop: 4, fontSize: 13 }}>
                      {latestWorkout.exerciseNames?.join(', ')}
                    </div>
                  )}
                </>
              ) : (
                <div className="muted">{t('today.restDay')}</div>
              )}
            </div>
          </Link>
        )}

        {/* Weight card */}
        <Link to="/health" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="glow-card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t('today.weight')}</div>
            {measurementsQuery.isPending ? (
              <Skeleton height={48} />
            ) : latestWeight?.weightKg != null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 32, fontWeight: 800 }}>{latestWeight.weightKg}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>kg</span>
                {sparklinePoints.length > 1 && (
                  <Sparkline points={sparklinePoints} />
                )}
              </div>
            ) : (
              <p className="muted">{t('today.noWeight')}</p>
            )}
          </div>
        </Link>

        {/* Sleep card */}
        <Link to="/health" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="glow-card">
            <div className="eyebrow" style={{ marginBottom: 8 }}>{t('today.sleep')}</div>
            {sleepQuery.isPending ? (
              <Skeleton height={48} />
            ) : lastSleep ? (
              <div>
                <div style={{ fontSize: 28, fontWeight: 800 }}>
                  {sleepDurationLabel(lastSleep.bedAt, lastSleep.wokeAt)}
                </div>
                {lastSleep.quality != null && (
                  <div style={{ marginTop: 4 }}>{'★'.repeat(lastSleep.quality)}</div>
                )}
              </div>
            ) : (
              <p className="muted">{t('today.noSleep')}</p>
            )}
          </div>
        </Link>
      </div>
    </section>
  );
}
