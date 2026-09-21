// T10890: the browser's `seeked` event snaps to frame boundaries, which can land
// slightly outside a region's [startTime, endTime] (e.g. seek(30) -> seeked fires
// with 29.967). One tolerance policy, shared by every playhead/region containment
// check (previously AnnotateContainer's auto-deselect effect alone had this
// tolerance while the containment filter feeding region lookup did not, so a
// click landing exactly on a region's edge could select nothing).
export const FRAME_TOLERANCE = 0.15; // ~4 frames at 30fps

/**
 * T10890: given regions whose [startTime, endTime] already contains a query
 * time, pick the one whose CENTER is closest to that time. Overlapping plays
 * (angle clips, closely-timed marks) can have more than one candidate; the
 * previous behavior (Array.find / first array-order match) picked whichever
 * happened to sort first, not the one the user was actually pointing at.
 * Ties (equal center distance) go to the SHORTER span — the more specific
 * match — rather than falling back to array order.
 *
 * @param {Array<{startTime: number, endTime: number}>} candidates - regions
 *   already filtered to ones containing `time` (this function does not filter)
 * @param {number} time
 * @returns {object|null}
 */
export function pickNearestCenterRegion(candidates, time) {
  let best = null;
  let bestDistance = Infinity;
  let bestSpan = Infinity;
  for (const region of candidates) {
    const span = region.endTime - region.startTime;
    const center = (region.startTime + region.endTime) / 2;
    const distance = Math.abs(time - center);
    if (distance < bestDistance || (distance === bestDistance && span < bestSpan)) {
      bestDistance = distance;
      bestSpan = span;
      best = region;
    }
  }
  return best;
}
