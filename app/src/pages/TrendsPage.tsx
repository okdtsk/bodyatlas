import { useMemo, useState } from 'react';
import { LineChart } from '../components/charts/LineChart';
import { Skeleton } from '../components/Skeleton';
import { useI18n } from '../i18n';
import { bucketSum, localDayKey, RANGES, rangeFromIso, weekKey } from '../lib/buckets';
import type { RangeKey } from '../lib/buckets';
import { sleepDurationLabel } from '../lib/format';
import { useSleep } from '../lib/health';
import { useExercises } from '../lib/train';
import { useNutritionBodyTrend, useStrengthTrend, useVolumeTrend } from '../lib/trends';

const LS_KEY = 'ba_trend_exercise';

export function TrendsPage() {
  const { t } = useI18n();
  const [range, setRange] = useState<RangeKey>('12w');
  const fromIso = useMemo(() => rangeFromIso(range), [range]);
  const nowIso = useMemo(() => new Date().toISOString(), []);

  const [exerciseId, setExerciseId] = useState<string>(() => {
    try {
      return localStorage.getItem(LS_KEY) ?? '';
    } catch {
      return '';
    }
  });

  const exercises = useExercises('');
  const strengthData = useStrengthTrend(exerciseId, fromIso);
  const volumeData = useVolumeTrend(fromIso);
  const nutritionBodyData = useNutritionBodyTrend(fromIso);
  const sleepData = useSleep(fromIso, nowIso);

  function handleExerciseChange(id: string) {
    setExerciseId(id);
    try {
      if (id) {
        localStorage.setItem(LS_KEY, id);
      } else {
        localStorage.removeItem(LS_KEY);
      }
    } catch {
      // ignore
    }
  }

  // --- Volume bucketing ---
  const volumeBuckets = useMemo(() => {
    const rows = volumeData.data ?? [];
    return bucketSum(
      rows.map((r) => ({ iso: r.startedAt as string, value: r.setCount })),
      weekKey,
    );
  }, [volumeData.data]);

  // Last week's muscle breakdown
  const lastWeekKey = volumeBuckets.length > 0 ? volumeBuckets[volumeBuckets.length - 1]?.key : null;
  const lastWeekMuscles = useMemo(() => {
    if (!lastWeekKey) return [];
    const rows = volumeData.data ?? [];
    const map = new Map<string, number>();
    for (const row of rows) {
      if (weekKey(row.startedAt as string) === lastWeekKey) {
        map.set(row.muscleGroup, (map.get(row.muscleGroup) ?? 0) + row.setCount);
      }
    }
    return [...map.entries()];
  }, [volumeData.data, lastWeekKey]);

  // --- Strength chart series ---
  const strengthSeries = useMemo(() => {
    const pts = strengthData.data ?? [];
    return [
      {
        points: pts
          .filter((p) => p.topWeightKg !== null)
          .map((p) => ({ x: new Date(p.startedAt as string).getTime(), y: p.topWeightKg as number })),
        stroke: 'var(--accent)',
        dashed: false,
      },
      {
        points: pts
          .filter((p) => p.est1rm !== null)
          .map((p) => ({ x: new Date(p.startedAt as string).getTime(), y: p.est1rm as number })),
        stroke: 'var(--text-muted)',
        dashed: true,
      },
    ];
  }, [strengthData.data]);

  const hasStrengthData = strengthSeries.some((s) => s.points.length > 0);

  // --- Nutrition vs body series ---
  const nutritionBodySeries = useMemo(() => {
    const data = nutritionBodyData.data;
    if (!data) return { kcalSeries: [] as Array<{ x: number; y: number }>, weightSeries: [] as Array<{ x: number; y: number }>, lastKcal: null as number | null, lastWeight: null as number | null };

    const kcalBuckets = bucketSum(
      data.meals
        .filter((m) => m.calories !== null)
        .map((m) => ({ iso: m.eatenAt as string, value: m.calories as number })),
      localDayKey,
    );
    const kcalSeries = kcalBuckets.map((b) => ({ x: new Date(b.key).getTime(), y: b.value }));
    const weightSeries = data.measurements
      .filter((m) => m.weightKg !== null)
      .map((m) => ({ x: new Date(m.measuredAt as string).getTime(), y: m.weightKg as number }));

    const lastKcal = kcalSeries.length > 0 ? (kcalSeries[kcalSeries.length - 1]?.y ?? null) : null;
    const lastWeight = weightSeries.length > 0 ? (weightSeries[weightSeries.length - 1]?.y ?? null) : null;

    return { kcalSeries, weightSeries, lastKcal, lastWeight };
  }, [nutritionBodyData.data]);

  // --- Sleep bars ---
  const sleepRecords = sleepData.data ?? [];
  const sleepDurationsMinutes = sleepRecords.map((s) => {
    const mins = Math.round((new Date(s.wokeAt as string).getTime() - new Date(s.bedAt as string).getTime()) / 60000);
    return { label: sleepDurationLabel(s.bedAt as string, s.wokeAt as string), mins };
  });
  const avgSleepMins =
    sleepDurationsMinutes.length > 0
      ? Math.round(sleepDurationsMinutes.reduce((acc, r) => acc + r.mins, 0) / sleepDurationsMinutes.length)
      : null;
  const avgSleepLabel = avgSleepMins !== null ? `${Math.floor(avgSleepMins / 60)}h ${avgSleepMins % 60}m` : null;
  const maxSleepMins = sleepDurationsMinutes.length > 0 ? Math.max(...sleepDurationsMinutes.map((r) => r.mins)) : 1;

  return (
    <section style={{ padding: '16px 16px 80px' }}>
      {/* Range chips */}
      <div className="row" style={{ gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {RANGES.map((r) => (
          <button
            key={r}
            className={`btn${range === r ? ' btn-primary' : ''}`}
            onClick={() => setRange(r)}
          >
            {t(`trends.range.${r}`)}
          </button>
        ))}
      </div>

      {/* Strength section */}
      <div className="glow-card" style={{ marginBottom: 20 }}>
        <div className="section-title">{t('trends.strength')}</div>
        <select
          className="input"
          value={exerciseId}
          onChange={(e) => handleExerciseChange(e.target.value)}
          style={{ marginBottom: 12 }}
        >
          <option value="">{t('trends.pickExercise')}</option>
          {(exercises.data ?? [])
            .filter((ex) => !ex.isArchived)
            .map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.nameEn}
              </option>
            ))}
        </select>

        {exerciseId === '' ? null : strengthData.isPending ? (
          <Skeleton height={160} />
        ) : hasStrengthData ? (
          <>
            <LineChart series={strengthSeries} height={160} yUnit="kg" />
            <div className="row" style={{ gap: 16, marginTop: 8 }}>
              <span style={{ color: 'var(--accent)', fontSize: 13 }}>— {t('trends.topSet')}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>- - {t('trends.est1rm')}</span>
            </div>
          </>
        ) : (
          <p className="muted">{t('trends.noData')}</p>
        )}
      </div>

      {/* Volume section */}
      <div className="glow-card" style={{ marginBottom: 20 }}>
        <div className="section-title">{t('trends.volume')}</div>
        {volumeData.isPending ? (
          <Skeleton height={120} />
        ) : volumeBuckets.length === 0 ? (
          <p className="muted">{t('trends.noData')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {volumeBuckets.map((b) => {
                const pct = volumeBuckets.reduce((max, x) => Math.max(max, x.value), 0);
                const barPct = pct > 0 ? (b.value / pct) * 100 : 0;
                return (
                  <div key={b.key} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <span style={{ minWidth: 80, fontSize: 12, color: 'var(--text-muted)' }}>{b.key}</span>
                    <div style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
                      <div
                        style={{
                          width: `${barPct}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          borderRadius: 5,
                        }}
                      />
                    </div>
                    <span style={{ minWidth: 24, fontSize: 12, textAlign: 'right' }}>{b.value}</span>
                  </div>
                );
              })}
            </div>
            {lastWeekMuscles.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                {lastWeekMuscles.map(([mg, count]) => (
                  <span key={mg} className="chip">
                    {t(`muscle.${mg}` as Parameters<typeof t>[0])}: {count}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Nutrition vs body section */}
      <div className="glow-card" style={{ marginBottom: 20 }}>
        <div className="section-title">{t('trends.nutritionBody')}</div>
        {nutritionBodyData.isPending ? (
          <Skeleton height={160} />
        ) : nutritionBodySeries.kcalSeries.length === 0 && nutritionBodySeries.weightSeries.length === 0 ? (
          <p className="muted">{t('trends.noData')}</p>
        ) : (
          <>
            <LineChart
              series={[
                { points: nutritionBodySeries.kcalSeries, stroke: 'var(--accent)', dashed: false },
                { points: nutritionBodySeries.weightSeries, stroke: 'var(--positive)', dashed: true },
              ]}
              height={160}
            />
            <div className="row" style={{ gap: 16, marginTop: 8 }}>
              <span style={{ color: 'var(--accent)', fontSize: 13 }}>
                — {t('trends.kcalPerDay')}
                {nutritionBodySeries.lastKcal !== null ? ` ${nutritionBodySeries.lastKcal}` : ''}
              </span>
              <span style={{ color: 'var(--positive)', fontSize: 13 }}>
                - - {t('trends.weightLine')}
                {nutritionBodySeries.lastWeight !== null ? ` ${nutritionBodySeries.lastWeight}kg` : ''}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Sleep section */}
      <div className="glow-card" style={{ marginBottom: 20 }}>
        <div className="section-title">{t('trends.sleep')}</div>
        {sleepData.isPending ? (
          <Skeleton height={120} />
        ) : sleepRecords.length === 0 ? (
          <p className="muted">{t('trends.noData')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sleepDurationsMinutes.map((r, i) => {
                const barPct = maxSleepMins > 0 ? (r.mins / maxSleepMins) * 100 : 0;
                return (
                  <div key={i} className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <div style={{ flex: 1, height: 10, background: 'var(--surface-2)', borderRadius: 5 }}>
                      <div
                        style={{
                          width: `${barPct}%`,
                          height: '100%',
                          background: 'var(--accent)',
                          borderRadius: 5,
                        }}
                      />
                    </div>
                    <span style={{ minWidth: 50, fontSize: 12, textAlign: 'right' }}>{r.label}</span>
                  </div>
                );
              })}
            </div>
            {avgSleepLabel !== null && (
              <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
                {t('trends.avg')}: {avgSleepLabel}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
