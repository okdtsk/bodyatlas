/**
 * native.ts — Capacitor bridge detection, typed plugin wrappers, and pure helpers.
 *
 * The interfaces below (HealthSyncPlugin, HKSleepSample, etc.) are narrow
 * hand-written types for the native/web boundary. There is no derivable
 * TypeScript source for the Swift plugin's JS bridge — these are the single
 * source of truth for the web side of that contract.
 */

import { registerPlugin } from '@capacitor/core';
import { localDayKey } from './buckets';

// ---------- bridge detection ----------

/** True when the app is running inside the Capacitor iOS shell. */
export function isNativeShell(): boolean {
  return (
    typeof window !== 'undefined' &&
    !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()
  );
}

// ---------- plugin proxies ----------
//
// App-target plugins are registered natively in MainViewController via
// `bridge.registerPluginType(...)`, which populates the native routing table.
// In remote-URL mode, though, Capacitor does NOT auto-create the JS-side
// `window.Capacitor.Plugins.<name>` proxy — so reaching into that object finds
// nothing. `registerPlugin` builds the proxy explicitly; each method call
// dispatches to native by plugin name through the bridge, independent of any
// header injection. On web (non-native) the proxy is inert until a method is
// called, and every call below is gated by isNativeShell().

interface HealthSyncPlugin {
  requestAuthorization(): Promise<{ granted: boolean }>;
  querySamples(options: { days: number }): Promise<HealthSyncSamples>;
}

interface NativeAuthPlugin {
  signIn(): Promise<{ code: string }>;
}

const HealthSync = registerPlugin<HealthSyncPlugin>('HealthSync');
const NativeAuth = registerPlugin<NativeAuthPlugin>('NativeAuth');

// ---------- typed bridge interfaces ----------

/** Raw sleep sample returned by the Swift HealthSync plugin. */
export interface HKSleepSample {
  start: string; // ISO 8601 UTC
  end: string; // ISO 8601 UTC
  value: 'asleep' | 'inBed';
}

/** Raw weight sample returned by the Swift HealthSync plugin. */
export interface HKWeightSample {
  date: string; // ISO 8601 UTC
  kg: number;
}

/** Raw body fat sample returned by the Swift HealthSync plugin. */
export interface HKBodyFatSample {
  date: string; // ISO 8601 UTC
  pct: number;
}

/** Return type of HealthSync.querySamples() on the native bridge. */
export interface HealthSyncSamples {
  sleep: HKSleepSample[];
  weight: HKWeightSample[];
  bodyFat: HKBodyFatSample[];
}

// ---------- bridge wrappers ----------

/** Request HealthKit authorization. Resolves once the system prompt completes. */
export async function healthRequestAuth(): Promise<{ granted: boolean }> {
  if (!isNativeShell()) throw new Error('HealthSync plugin not available');
  return HealthSync.requestAuthorization();
}

/**
 * Run Google sign-in via the native NativeAuth plugin (ASWebAuthenticationSession).
 * Resolves with the one-time code to POST to /auth/native/exchange.
 * Rejects with "canceled" when the user dismisses the browser sheet.
 */
export async function nativeGoogleSignIn(): Promise<{ code: string }> {
  if (!isNativeShell()) throw new Error('NativeAuth plugin not available');
  return NativeAuth.signIn();
}

/** Query Apple Health samples for the past `days` days (1-90, default 30). */
export async function healthQuerySamples(days = 30): Promise<HealthSyncSamples> {
  if (!isNativeShell()) throw new Error('HealthSync plugin not available');
  return HealthSync.querySamples({ days });
}

// ---------- pure helpers (TDD-covered) ----------

/** Merged sleep record (output of mergeSleepSamples). */
export interface MergedSleep {
  bedAt: string; // ISO UTC — earliest start of the group
  wokeAt: string; // ISO UTC — latest end of the group
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Merge raw Apple Health sleep samples into consolidated sleep records.
 *
 * Rules (per plan spec):
 * - Only 'asleep' samples are used; 'inBed' is ignored.
 * - Samples are sorted by start time.
 * - Consecutive samples with a gap < 2 hours are grouped into one record.
 * - bedAt = earliest start of the group; wokeAt = latest end.
 * - Groups whose duration exceeds 24 hours are dropped.
 */
export function mergeSleepSamples(samples: HKSleepSample[]): MergedSleep[] {
  // Filter to asleep-only and sort by start
  const asleep = samples
    .filter((s) => s.value === 'asleep')
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  if (asleep.length === 0) return [];

  const first = asleep[0];
  if (!first) return [];

  const groups: MergedSleep[] = [];
  let groupStart = first.start;
  let groupEnd = first.end;

  for (let i = 1; i < asleep.length; i++) {
    const sample = asleep[i];
    if (!sample) continue;

    const gap = new Date(sample.start).getTime() - new Date(groupEnd).getTime();

    if (gap < TWO_HOURS_MS) {
      // Extend the current group
      if (new Date(sample.end).getTime() > new Date(groupEnd).getTime()) {
        groupEnd = sample.end;
      }
    } else {
      // Flush current group (drop if >24h)
      const duration = new Date(groupEnd).getTime() - new Date(groupStart).getTime();
      if (duration <= TWENTY_FOUR_HOURS_MS) {
        groups.push({
          bedAt: new Date(groupStart).toISOString(),
          wokeAt: new Date(groupEnd).toISOString(),
        });
      }
      // Start a new group
      groupStart = sample.start;
      groupEnd = sample.end;
    }
  }

  // Flush the last group
  const duration = new Date(groupEnd).getTime() - new Date(groupStart).getTime();
  if (duration <= TWENTY_FOUR_HOURS_MS) {
    groups.push({
      bedAt: new Date(groupStart).toISOString(),
      wokeAt: new Date(groupEnd).toISOString(),
    });
  }

  return groups;
}

/** One measurement per local day, merged from weight + body fat samples. */
export interface MergedMeasurement {
  day: string; // local day key, e.g. '2026-06-12'
  measuredAt: string; // ISO timestamp carried from the source sample
  kg?: number;
  pct?: number;
}

/**
 * Merge Apple Health weight and body-fat samples into one entry per local day.
 *
 * - Samples sharing a local day collapse into a single entry (kg + pct).
 * - measuredAt is carried from the source samples — never stamped at import
 *   time — so the stored record lands on the sample's day and day-keyed
 *   dedupe survives re-imports. When a day has multiple samples, the latest
 *   timestamp of that day wins (deterministic regardless of input order).
 * - Output is sorted by day ascending.
 */
export function mergeMeasurementSamples(
  weight: HKWeightSample[],
  bodyFat: HKBodyFatSample[],
): MergedMeasurement[] {
  const byDay = new Map<string, MergedMeasurement>();

  const upsert = (date: string, apply: (entry: MergedMeasurement) => void) => {
    const day = localDayKey(date);
    const entry = byDay.get(day) ?? { day, measuredAt: date };
    apply(entry);
    // Keep the later timestamp of the day.
    if (new Date(date).getTime() > new Date(entry.measuredAt).getTime()) {
      entry.measuredAt = date;
    }
    byDay.set(day, entry);
  };

  for (const w of weight) {
    upsert(w.date, (e) => {
      e.kg = w.kg;
    });
  }
  for (const bf of bodyFat) {
    upsert(bf.date, (e) => {
      e.pct = bf.pct;
    });
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/**
 * Return only items whose day key is not in the existing set.
 * Generic: works for sleep (keyed by wokeAt day) or measurements (keyed by measuredAt day).
 *
 * @param incoming - incoming items to filter
 * @param existingDayKeys - Set of day keys already in BodyAtlas (e.g. '2026-06-12')
 * @param keyOf - function to extract the day key from an item
 */
export function pickNewDays<T>(
  incoming: T[],
  existingDayKeys: Set<string>,
  keyOf: (t: T) => string,
): T[] {
  return incoming.filter((item) => !existingDayKeys.has(keyOf(item)));
}
