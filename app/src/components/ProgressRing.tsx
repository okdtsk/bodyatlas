export function ProgressRing({ done, total }: { done: number; total: number | null }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = total && total > 0 ? Math.min(done / total, 1) : 0;
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" role="img" aria-label={`${done}${total ? `/${total}` : ''}`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
      {total !== null && total > 0 && (
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          transform="rotate(-90 32 32)"
        />
      )}
      <text x="32" y="37" textAnchor="middle" fill="var(--text)" fontSize="13" fontWeight="800">
        {total && total > 0 ? `${done}/${total}` : done}
      </text>
    </svg>
  );
}
