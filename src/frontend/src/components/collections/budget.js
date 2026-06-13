import { COLLECTION_MIN_DURATION_SEC } from '../../constants/aspectRatios';

/**
 * Duration-budget mechanics for collection Play-all (T3610 §0B.5, EPIC #7).
 *
 * A collection defaults to ALL of its clips; "Set Duration" trims it down. The
 * slider runs 30s -> the collection's full ratio duration (no 5m cap, so "all
 * clips" is always reachable) and snaps to 15s steps. Membership is the reels
 * that fit the budget, greedy-with-skip over the members in order (newest-first
 * until T3630 ranking lands).
 */

const SNAP_STEP_SEC = 15;

/** Slider cap for a collection = its full ratio duration (>= 30s). */
export function budgetCap(totalRatioDurationSec) {
  return Math.max(COLLECTION_MIN_DURATION_SEC, Math.round(totalRatioDurationSec || 0));
}

/** Default slider position: the full collection (all clips). */
export function defaultBudget(cap) {
  return cap;
}

/** Snap a slider value to 15s steps within [30s, cap]; the cap is always reachable. */
export function snapToStep(value, cap) {
  if (value >= cap) return cap;
  const snapped = Math.round(value / SNAP_STEP_SEC) * SNAP_STEP_SEC;
  return Math.min(cap, Math.max(COLLECTION_MIN_DURATION_SEC, snapped));
}

/** Sum of member durations (NULLs treated as 0). */
export function sumDuration(members) {
  return members.reduce((s, m) => s + (m.duration || 0), 0);
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
