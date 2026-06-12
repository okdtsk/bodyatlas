import type { Locale } from '@bodyatlas/shared';

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
