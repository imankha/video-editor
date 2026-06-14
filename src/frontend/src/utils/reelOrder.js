/**
 * Canonical reel ordering (T3630) — the frontend mirror of the backend
 * ORDER_BY_RANK fragment (services/collection_metadata.py). Used to re-sort
 * cached reel lists optimistically after a rank gesture; fresh fetches already
 * arrive in this order from the server.
 *
 * Order: user season_rank ASC (ranked above unranked) -> quality_score DESC
 * (unranked, nulls last) -> created_at DESC (recency).
 */

function nullsLastAsc(a, b) {
  // returns a comparison, or null if both present-and-equal / both null (continue)
  if (a != null && b != null) return a === b ? null : a - b;
  if (a != null) return -1;   // a present -> a first
  if (b != null) return 1;    // b present -> b first
  return null;                // both null -> continue
}

export function compareReels(a, b) {
  const rank = nullsLastAsc(a.season_rank, b.season_rank);
  if (rank !== null) return rank;

  // both unranked -> quality DESC (nulls last): flip the sign of the asc compare
  const qa = a.quality_score, qb = b.quality_score;
  if (qa != null && qb != null) { if (qa !== qb) return qb - qa; }
  else if (qa != null) return -1;
  else if (qb != null) return 1;

  // recency DESC — ISO 'Z' timestamps compare lexically
  return (b.created_at || '').localeCompare(a.created_at || '');
}

/** Stable-sorted copy of reels in canonical order. */
export function sortReels(reels) {
  return [...reels].sort(compareReels);
}
