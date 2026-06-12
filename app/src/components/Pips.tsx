export function Pips({ done, planned }: { done: number; planned: number | null }) {
  const total = Math.max(done, planned ?? 0);
  if (total === 0 || total > 12) return null; // sanity cap for layout
  return (
    <span className="pips" aria-label={`${done}/${planned ?? done}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < done ? 'pip on' : 'pip'} />
      ))}
    </span>
  );
}
