/**
 * Canonical reel ordering (T3630) — the frontend mirror of the backend
 * ORDER_BY_RANK fragment (services/collection_metadata.py). Used to re-sort
 * cached reel lists optimistically after a ranking result; fresh fetches already
 * arrive in this order from the server.
 *
 * Order: Glicko `rating` DESC (seeded from the star, so sane before any matchup;
 * nulls last) -> `quality_score` DESC (secondary tiebreak, nulls last) ->
 * `created_at` DESC (recency).
 */

/** Compare two maybe-null numbers DESC with nulls last; null when both null/equal. */
function descNullsLast(a, b) {
  if (a != null && b != null) return a === b ? null : b - a;
  if (a != null) return -1; // a present -> a first
  if (b != null) return 1;  // b present -> b first
  return null;              // both null -> continue
}

export function compareReels(a, b) {
  const byRating = descNullsLast(a.rating, b.rating);
  if (byRating !== null) return byRating;

  const byQuality = descNullsLast(a.quality_score, b.quality_score);
  if (byQuality !== null) return byQuality;

  // recency DESC — ISO 'Z' timestamps compare lexically
  return (b.created_at || '').localeCompare(a.created_at || '');
}

/** Stable-sorted copy of reels in canonical order. */
export function sortReels(reels) {
  return [...reels].sort(compareReels);
}
