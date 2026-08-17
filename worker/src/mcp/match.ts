/**
 * Exercise-name matching for MCP tools — pure, so it is testable without D1.
 *
 * MCP clients guess names from natural language ("hack squat", "ﾍﾞﾝﾁﾌﾟﾚｽ"), so
 * exact matching alone strands them. Matching widens in tiers and stops at the
 * first tier that identifies exactly one exercise; anything wider than that
 * would risk logging sets against the wrong exercise and splitting history.
 */

export type ExerciseCandidate = {
  id: string;
  nameEn: string;
  nameJa: string | null;
};

export type MatchResult =
  | { kind: 'match'; exercise: ExerciseCandidate }
  | { kind: 'ambiguous'; suggestions: ExerciseCandidate[] }
  | { kind: 'none'; suggestions: ExerciseCandidate[] };

const MAX_SUGGESTIONS = 5;
/** Dice coefficient below which a name is too far off to be worth suggesting. */
const SUGGESTION_THRESHOLD = 0.3;

/**
 * Fold away the differences that never distinguish two exercises: case,
 * spacing, ASCII hyphens/underscores, and half-width vs full-width forms.
 *
 * NFKC handles the width folding (ﾍﾞﾝﾁ → ベンチ, Ｌｅｇ → Leg, U+3000 → space).
 * The katakana prolonged sound mark (ー, U+30FC) is deliberately NOT stripped —
 * it is a letter in Japanese, not punctuation, and dropping it would collide
 * distinct words (カール vs カル).
 */
export function normalizeExerciseName(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\s\-_]+/g, '');
}

/** Character bigrams of a normalized string, as a set. */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/** Sørensen–Dice similarity over character bigrams, 0–1. */
function similarity(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.size === 0 || bb.size === 0) return a === b ? 1 : 0;
  let shared = 0;
  for (const g of ba) if (bb.has(g)) shared++;
  return (2 * shared) / (ba.size + bb.size);
}

/** Normalized names a candidate can be addressed by. */
function namesOf(c: ExerciseCandidate): string[] {
  const names = [normalizeExerciseName(c.nameEn)];
  if (c.nameJa) names.push(normalizeExerciseName(c.nameJa));
  return names;
}

/** Best similarity between the query and any of a candidate's names. */
function bestSimilarity(c: ExerciseCandidate, query: string): number {
  return Math.max(...namesOf(c).map((n) => similarity(n, query)));
}

/** Closest candidates by bigram similarity, best first, above the threshold. */
function fuzzySuggestions(candidates: ExerciseCandidate[], query: string): ExerciseCandidate[] {
  return candidates
    .map((c) => ({ c, score: bestSimilarity(c, query) }))
    .filter(({ score }) => score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ c }) => c);
}

/**
 * Resolve a user-supplied name against the catalog.
 *
 * Tier 1 — exact (case-insensitive). A duplicate name is a data problem, not a
 *          reason to refuse, so the first hit wins.
 * Tier 2 — normalized equality (spacing/width/hyphens folded).
 * Tier 3 — the query as a substring of a name.
 *
 * Tiers 2 and 3 only resolve when they identify exactly one exercise; several
 * hits mean the caller has to be more specific.
 */
export function matchExercise(candidates: ExerciseCandidate[], query: string): MatchResult {
  const lowered = query.toLowerCase();
  const exact = candidates.find(
    (c) => c.nameEn.toLowerCase() === lowered || c.nameJa?.toLowerCase() === lowered,
  );
  if (exact) return { kind: 'match', exercise: exact };

  const normalized = normalizeExerciseName(query);
  if (normalized === '') return { kind: 'none', suggestions: [] };

  const normalizedHits = candidates.filter((c) => namesOf(c).includes(normalized));
  if (normalizedHits.length === 1) return { kind: 'match', exercise: normalizedHits[0]! };
  if (normalizedHits.length > 1) {
    return { kind: 'ambiguous', suggestions: normalizedHits.slice(0, MAX_SUGGESTIONS) };
  }

  const substringHits = candidates.filter((c) => namesOf(c).some((n) => n.includes(normalized)));
  if (substringHits.length === 1) return { kind: 'match', exercise: substringHits[0]! };
  if (substringHits.length > 1) {
    return { kind: 'ambiguous', suggestions: substringHits.slice(0, MAX_SUGGESTIONS) };
  }

  return { kind: 'none', suggestions: fuzzySuggestions(candidates, normalized) };
}
