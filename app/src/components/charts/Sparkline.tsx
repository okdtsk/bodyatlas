/** Tiny token-colored sparkline. Single series, 120×32, no dots or labels. */
export function Sparkline({ points }: { points: Array<{ x: number; y: number }> }) {
  if (points.length === 0) return null;
  const w = 120;
  const h = 32;
  const padX = 4;
  const padY = 4;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const sx = (x: number) => (xMax === xMin ? w / 2 : padX + ((x - xMin) / (xMax - xMin)) * (w - 2 * padX));
  const sy = (y: number) => (yMax === yMin ? h / 2 : h - padY - ((y - yMin) / (yMax - yMin)) * (h - 2 * padY));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} role="img">
      <polyline
        fill="none"
        stroke="var(--accent-ink)"
        strokeWidth={2}
        strokeLinecap="round"
        points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ')}
      />
    </svg>
  );
}
