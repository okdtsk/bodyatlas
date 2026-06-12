const pad = (n: number) => String(n).padStart(2, '0');

function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localDayKey(iso: string): string {
  return dayKeyOf(new Date(iso));
}

/** Local Monday of the ISO string's week. */
export function weekKey(iso: string): string {
  const d = new Date(iso);
  const day = d.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
  return dayKeyOf(monday);
}

export function bucketSum(
  rows: Array<{ iso: string; value: number }>,
  keyFn: (iso: string) => string,
): Array<{ key: string; value: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row.iso);
    map.set(key, (map.get(key) ?? 0) + row.value);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, value }));
}

export const RANGES = ['4w', '12w', '6m', '1y'] as const;
export type RangeKey = (typeof RANGES)[number];
const RANGE_DAYS: Record<RangeKey, number> = { '4w': 28, '12w': 84, '6m': 182, '1y': 365 };

export function rangeFromIso(range: RangeKey): string {
  return new Date(Date.now() - RANGE_DAYS[range] * 86400000).toISOString();
}
