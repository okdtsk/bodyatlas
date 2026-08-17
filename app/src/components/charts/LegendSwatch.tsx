/**
 * Draws the actual stroke and dash pattern it describes. The previous legend used
 * a text em-dash and two hyphens, which matched no real stroke at any zoom level.
 */
export function LegendSwatch({
  stroke,
  dashed,
  label,
}: {
  stroke: string;
  dashed: boolean;
  label: string;
}) {
  return (
    <span className="row legend-swatch" style={{ gap: 'var(--sp-2)' }}>
      <svg width="20" height="8" aria-hidden focusable="false">
        <line
          x1="0" y1="4" x2="20" y2="4"
          stroke={stroke} strokeWidth="2"
          strokeDasharray={dashed ? '4 3' : undefined}
        />
      </svg>
      <span className="muted">{label}</span>
    </span>
  );
}
