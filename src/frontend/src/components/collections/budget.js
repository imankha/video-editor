import { COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';

/**
 * Duration-budget mechanics for collection Play-all (T3610 §0B.5, EPIC #7).
 *
 * A collection's slider runs 30s -> min(total ratio duration, 5m). Membership is
 * the reels that fit the budget, greedy-with-skip over the members in order
 * (newest-first until T3630 ranking lands).
 */

export const BUDGET_MAX_SEC = 300; // 5m cap
const DETENTS = [30, 60, 120, 180, 300]; // 30s / 1m / 2m / 3m / 5m (EPIC #7)

/** Slider cap for a collection = min(total ratio duration, 5m), >= 30s. */
export function budgetCap(totalRatioDurationSec) {
  return Math.max(
    COLLECTION_MIN_DURATION_SEC,
    Math.min(Math.round(totalRatioDurationSec || 0), BUDGET_MAX_SEC),
  );
}

/** Detent stops within [30s, cap]; the top stop ("Max") is always the cap. */
export function detentsForCap(cap) {
  const stops = DETENTS.filter((d) => d <= cap);
  if (stops[stops.length - 1] !== cap) stops.push(cap);
  return stops;
}

/** Default slider position: 1 minute, or the cap when the collection is shorter. */
export function defaultBudget(cap) {
  return Math.min(60, cap);
}

/** Snap an arbitrary slider value to the nearest detent. */
export function snapToDetent(value, cap) {
  const stops = detentsForCap(cap);
  return stops.reduce(
    (best, d) => (Math.abs(d - value) < Math.abs(best - value) ? d : best),
    stops[0],
  );
}

/**
 * Greedy-with-skip selection of members that fit the budget, in order. A reel is
 * included if it fits the remaining budget, otherwise skipped (a shorter later
 * reel may still fit). NULL-duration reels can't be budgeted and are excluded.
 * Guarantees at least one reel (the first with a duration) so Play-all is never
 * empty for an eligible collection.
 */
export function selectWithinBudget(members, budgetSec) {
  const out = [];
  let used = 0;
  for (const m of members) {
    if (m.duration == null) continue;
    if (used + m.duration <= budgetSec + 1e-6) {
      out.push(m);
      used += m.duration;
    }
  }
  if (out.length === 0) {
    const first = members.find((m) => m.duration != null);
    if (first) out.push(first);
  }
  return out;
}
