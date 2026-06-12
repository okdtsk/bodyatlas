type Series = { points: Array<{ x: number; y: number }>; stroke: string; dashed?: boolean };

/** Minimal token-colored line chart. x/y are raw values; scales computed from data. */
export function LineChart({ series, height = 160, yUnit = '' }: { series: Series[]; height?: number; yUnit?: string }) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const w = 600;
  const padX = 8;
  const padY = 16;
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number) => (xMax === xMin ? w / 2 : padX + ((x - xMin) / (xMax - xMin)) * (w - 2 * padX));
  const sy = (y: number) => (yMax === yMin ? height / 2 : height - padY - ((y - yMin) / (yMax - yMin)) * (height - 2 * padY));
  return (
    <div>
      <svg viewBox={`0 0 ${w} ${height}`} style={{ width: '100%', height: 'auto' }} role="img">
        {series.map((s, i) => (
          <polyline
            key={i}
            fill="none"
            stroke={s.stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeDasharray={s.dashed ? '6 5' : undefined}
            points={s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
          />
        ))}
        {series.map((s, i) =>
          s.points.map((p, j) => <circle key={`${i}-${j}`} cx={sx(p.x)} cy={sy(p.y)} r={3} fill={s.stroke} />),
        )}
      </svg>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{yMin === yMax ? '' : `${yMin}${yUnit}`}</span>
        <span className="muted">{`${yMax}${yUnit}`}</span>
      </div>
    </div>
  );
}
