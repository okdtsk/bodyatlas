import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { LineChart } from '../components/charts/LineChart';
import { Skeleton } from '../components/Skeleton';
import { useI18n } from '../i18n';
import { bucketSum, localDayKey, RANGES, rangeFromIso, weekKey } from '../lib/buckets';
import type { RangeKey } from '../lib/buckets';
import { sleepDurationLabel } from '../lib/format';
import { useSleep } from '../lib/health';
import { useExercises } from '../lib/train';
import { useNutritionBodyTrend, useStrengthTrend, useVolumeTrend } from '../lib/trends';
import { useAiSettings, useAiReview, useCoachReview } from '../lib/ai';

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

  const { data: aiSettings } = useAiSettings();
  const { data: aiReview } = useAiReview();
  const coachReview = useCoachReview();

  const hasKey = (aiSettings as { hasKey?: boolean } | undefined)?.hasKey ?? false;
  const [coachError, setCoachError] = useState(false);
  const [localReview, setLocalReview] = useState<{ review: string; generatedAt: string } | null>(null);

  async function handleGenerate() {
    setCoachError(false);
    try {
      const result = await coachReview.mutateAsync();
      setLocalReview(result);
    } catch {
      setCoachError(true);
    }
  }

  const displayReview = localReview ?? (aiReview as { review?: string | null; generatedAt?: string | null } | undefined);

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
      rows.map((r) => ({ iso: r.startedAt, value: r.setCount })),
      weekKey,
    );
  }, [volumeData.data]);

  const maxWeekly = volumeBuckets.reduce((m, x) => Math.max(m, x.value), 0);

  // Last week's muscle breakdown
  const lastWeekKey = volumeBuckets.length > 0 ? volumeBuckets[volumeBuckets.length - 1]?.key : null;
  const lastWeekMuscles = useMemo(() => {
    if (!lastWeekKey) return [];
    const rows = volumeData.data ?? [];
    const map = new Map<string, number>();
    for (const row of rows) {
      if (weekKey(row.startedAt) === lastWeekKey) {
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
          .map((p) => ({ x: new Date(p.startedAt).getTime(), y: p.topWeightKg as number })),
        stroke: 'var(--accent)',
        dashed: false,
      },
      {
        points: pts
          .filter((p) => p.est1rm !== null)
          .map((p) => ({ x: new Date(p.startedAt).getTime(), y: p.est1rm as number })),
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
        .map((m) => ({ iso: m.eatenAt, value: m.calories as number })),
      localDayKey,
    );
    const kcalSeries = kcalBuckets.map((b) => ({ x: new Date(b.key).getTime(), y: b.value }));
    const weightSeries = data.measurements
      .filter((m) => m.weightKg !== null)
      .map((m) => ({ x: new Date(m.measuredAt).getTime(), y: m.weightKg as number }));

    const lastKcal = kcalSeries.length > 0 ? (kcalSeries[kcalSeries.length - 1]?.y ?? null) : null;
    const lastWeight = weightSeries.length > 0 ? (weightSeries[weightSeries.length - 1]?.y ?? null) : null;

    return { kcalSeries, weightSeries, lastKcal, lastWeight };
  }, [nutritionBodyData.data]);

  // --- Sleep bars ---
  const sleepRecords = sleepData.data ?? [];
  const sleepDurationsMinutes = sleepRecords.map((s) => {
    const mins = Math.round((new Date(s.wokeAt).getTime() - new Date(s.bedAt).getTime()) / 60000);
    return { label: sleepDurationLabel(s.bedAt, s.wokeAt), mins };
  });
  const avgSleepMins =
    sleepDurationsMinutes.length > 0
      ? Math.round(sleepDurationsMinutes.reduce((acc, r) => acc + r.mins, 0) / sleepDurationsMinutes.length)
      : null;
  const avgSleepLabel = avgSleepMins !== null ? `${Math.floor(avgSleepMins / 60)}h ${avgSleepMins % 60}m` : null;
  const maxSleepMins = sleepDurationsMinutes.length > 0 ? Math.max(...sleepDurationsMinutes.map((r) => r.mins)) : 1;

  return (
    <section style={{ padding: '16px 16px 80px' }}>
      {/* Coach card */}
      <div className="glow-card" style={{ marginBottom: 20 }}>
        <div className="section-title">{t('ai.review')}</div>
        {!hasKey ? (
          <p className="muted">
            {t('ai.notConfigured')}{' '}
            <Link to="/settings" style={{ color: 'var(--accent)' }}>
              Settings
            </Link>
          </p>
        ) : (
          <>
            {displayReview?.review ? (
              <p style={{ whiteSpace: 'pre-line', marginBottom: 12 }}>{displayReview.review}</p>
            ) : (
              <p className="muted" style={{ marginBottom: 12 }}>{t('ai.noReview')}</p>
            )}
            {coachError && (
              <p style={{ color: 'var(--negative)', marginBottom: 8 }}>{t('ai.error')}</p>
            )}
            <button
              type="button"
              className="btn"
              disabled={coachReview.isPending}
              onClick={handleGenerate}
            >
              {coachReview.isPending ? t('ai.generating') : t('ai.generate')}
            </button>
          </>
        )}
      </div>

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
                const barPct = maxWeekly > 0 ? (b.value / maxWeekly) * 100 : 0;
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
