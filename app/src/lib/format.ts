import type { Locale } from '@bodyatlas/shared';

/** Parses a decimal string; '' → undefined; invalid → undefined. Accepts comma decimals (JA keyboards). */
export function parseDecimal(v: string): number | undefined {
  const trimmed = v.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function trimNum(n: number): string {
  return String(n);
}

type SetValues = {
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  durationSec: number | null;
  distanceM: number | null;
};

export function formatSet(s: SetValues): string {
  const parts: string[] = [];
  if (s.weightKg !== null && s.reps !== null) {
    parts.push(`${trimNum(s.weightKg)}kg × ${s.reps}`);
  } else if (s.reps !== null) {
    parts.push(`× ${s.reps}`);
  }
  if (s.durationSec !== null) {
    const m = Math.floor(s.durationSec / 60);
    const sec = s.durationSec % 60;
    parts.push(`${m}:${String(sec).padStart(2, '0')}`);
  }
  if (s.distanceM !== null) parts.push(`${trimNum(s.distanceM / 1000)}km`);
  let out = parts.join(' · ');
  if (s.rpe !== null) out += ` @${trimNum(s.rpe)}`;
  return out;
}

export function exerciseName(
  ex: { nameEn: string; nameJa: string | null },
  locale: Locale,
): string {
  return locale === 'ja' ? (ex.nameJa ?? ex.nameEn) : ex.nameEn;
}

export function formatDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    month: 'short',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(iso));
}

export function weightDelta(
  current: Array<{ weightKg: number | null }>,
  last: Array<{ weightKg: number | null }>,
): number | null {
  const top = (arr: Array<{ weightKg: number | null }>) =>
    arr.reduce<number | null>(
      (m, s) => (s.weightKg !== null && (m === null || s.weightKg > m) ? s.weightKg : m),
      null,
    );
  const c = top(current);
  const l = top(last);
  if (c === null || l === null) return null;
  return Math.round((c - l) * 100) / 100;
}

export function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local-midnight day window as TZ-explicit ISO instants. */
export function dayRangeIso(d: Date): { fromIso: string; toIso: string } {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { fromIso: start.toISOString(), toIso: addDays(start, 1).toISOString() };
}

export function formatTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

export function sleepDurationLabel(bedIso: string, wokeIso: string): string {
  const mins = Math.round((new Date(wokeIso).getTime() - new Date(bedIso).getTime()) / 60000);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

/** Sum a numeric field across rows, treating null/undefined as 0. */
export function sumBy<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((acc, row) => acc + (pick(row) ?? 0), 0);
}
