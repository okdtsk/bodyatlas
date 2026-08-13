import { useState } from 'react';
import { useI18n } from '../../i18n';
import { api } from '../../lib/api';
import { useCreateSleep, useCreateMeasurement, type SleepRecord, type Measurement } from '../../lib/health';
import {
  isNativeShell,
  healthRequestAuth,
  healthQuerySamples,
  mergeMeasurementSamples,
  mergeSleepSamples,
  pickNewDays,
} from '../../lib/native';
import { localDayKey } from '../../lib/buckets';
import { addDays } from '../../lib/format';

/** Apple Health import, native iOS shell only. Renders nothing on web. */
export function HealthSyncSection() {
  const { t } = useI18n();

  const [ahConnected, setAhConnected] = useState(false);
  const [ahConnecting, setAhConnecting] = useState(false);
  const [ahSyncing, setAhSyncing] = useState(false);
  const [ahResult, setAhResult] = useState<{ sleep: number; weight: number } | null>(null);
  const [ahFailed, setAhFailed] = useState(0);
  const [ahError, setAhError] = useState(false);
  const createSleep = useCreateSleep();
  const createMeasurement = useCreateMeasurement();

  async function handleAhConnect() {
    if (ahConnecting) return; // double-tap guard
    setAhConnecting(true);
    setAhError(false);
    try {
      await healthRequestAuth();
      setAhConnected(true);
    } catch {
      setAhError(true);
    } finally {
      setAhConnecting(false);
    }
  }

  async function handleAhSync() {
    setAhSyncing(true);
    setAhResult(null);
    setAhFailed(0);
    setAhError(false);
    try {
      // 1. Query Apple Health for the past 30 days
      const samples = await healthQuerySamples(30);

      // 2. Merge fragmented sleep samples
      const mergedSleep = mergeSleepSamples(samples.sleep);

      // 3. Fetch existing records from BodyAtlas over the same 30-day window
      const toDate = new Date();
      const fromDate = addDays(toDate, -30);
      const fromIso = fromDate.toISOString();
      const toIso = toDate.toISOString();

      const [existingSleep, existingMeasurements] = await Promise.all([
        api.sleep.$get({ query: { from: fromIso, to: toIso } }).then((r) => {
          if (!r.ok) throw new Error(`sleep fetch failed: ${r.status}`);
          return r.json() as Promise<SleepRecord[]>;
        }),
        api.measurements.$get({ query: { from: fromIso, to: toIso } }).then((r) => {
          if (!r.ok) throw new Error(`measurements fetch failed: ${r.status}`);
          return r.json() as Promise<Measurement[]>;
        }),
      ]);

      // 4. Build existing day-key sets (sleep keyed on wokeAt, measurements on measuredAt)
      const existingSleepDays = new Set(existingSleep.map((r) => localDayKey(r.wokeAt)));
      const existingMeasurementDays = new Set(
        existingMeasurements.map((r) => localDayKey(r.measuredAt)),
      );

      // 5. Dedupe: pick only new days
      const newSleep = pickNewDays(mergedSleep, existingSleepDays, (r) => localDayKey(r.wokeAt));

      // 6. Merge weight + bodyFat samples by local day into one measurement per day,
      //    keeping the original sample timestamp (never import-time "now")
      const allMeasurements = mergeMeasurementSamples(samples.weight, samples.bodyFat);
      const newMeasurements = pickNewDays(
        allMeasurements,
        existingMeasurementDays,
        (m) => m.day,
      );

      // 7-8. POST sequentially, per-record try/catch so a mid-import failure
      // still reports how many records actually persisted
      let sleepOk = 0;
      let weightOk = 0;
      let failed = 0;

      for (const record of newSleep) {
        try {
          await createSleep.mutateAsync({ bedAt: record.bedAt, wokeAt: record.wokeAt });
          sleepOk++;
        } catch {
          failed++;
        }
      }

      for (const m of newMeasurements) {
        const input: { measuredAt: string; weightKg?: number; bodyFatPct?: number } = {
          measuredAt: m.measuredAt,
        };
        if (m.kg !== undefined) input.weightKg = m.kg;
        if (m.pct !== undefined) input.bodyFatPct = m.pct;
        try {
          await createMeasurement.mutateAsync(input);
          weightOk++;
        } catch {
          failed++;
        }
      }

      setAhResult({ sleep: sleepOk, weight: weightOk });
      setAhFailed(failed);
    } catch {
      setAhError(true);
    } finally {
      setAhSyncing(false);
    }
  }

  if (!isNativeShell()) return null;

  return (
    <section className="panel stack">
      <h2 className="label">{t('native.appleHealth')}</h2>

      {!ahConnected && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAhConnect}
          disabled={ahConnecting}
        >
          {t('native.connect')}
        </button>
      )}

      {ahConnected && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleAhSync}
          disabled={ahSyncing}
        >
          {ahSyncing ? t('native.syncing') : t('native.sync')}
        </button>
      )}

      {ahResult !== null && (
        <p style={{ color: 'var(--positive)' }}>
          {t('native.syncResult')
            .replace('{sleep}', String(ahResult.sleep))
            .replace('{weight}', String(ahResult.weight))}
        </p>
      )}

      {ahFailed > 0 && (
        <p style={{ color: 'var(--negative)' }}>
          {t('native.syncPartial').replace('{failed}', String(ahFailed))}
        </p>
      )}

      {ahError && <p style={{ color: 'var(--negative)' }}>{t('native.syncError')}</p>}
    </section>
  );
}
