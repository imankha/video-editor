// T8824: lane assignment extracted verbatim from buildGameTimeline (T8880) so
// the footage-intake picker and Annotate draw the SAME lanes for the same
// files (invariant P, docs/plans/tasks/T8824-design.md §2.1). Zero behaviour
// change from the pre-extraction code -- see useVirtualTimeline.test.js /
// useVirtualTimeline.overlap.test.js, which must pass unmodified.

// 1-2s of recording-split slop must not manufacture a phantom lane, so two
// intervals whose overlap is within this tolerance are treated as adjacent.
export const OVERLAP_EPSILON_S = 1.0;

/** Interval overlap with the recording-split tolerance baked in. */
export function intervalsOverlap(a, b) {
  return a.start < b.end - OVERLAP_EPSILON_S && b.start < a.end - OVERLAP_EPSILON_S;
}

/**
 * Assign lanes to a set of intervals: lane 0 = backbone (the "main camera"),
 * lanes 1+ = angles.
 *
 * LANE ALGORITHM (do not "improve" -- the count is provably minimal):
 *   - Backbone (lane 0) = the "main camera" = the LONGEST interval (tie:
 *     earliest start, then input order), grown forward/backward by admitting
 *     every interval, in start order, that overlaps NO current backbone
 *     member. This anchors the spine to the main camera so an earlier-but-
 *     shorter overlapping angle (incl. a negative-offset attach) can never
 *     steal lane 0 (the inversion a naive "earliest interval wins lane 0"
 *     greedy produces).
 *   - Angles (lanes 1+) = every remaining interval, colored by the standard
 *     minimal-lane greedy: in start order, take the lowest lane >= 1 whose
 *     last interval ends <= this start (+OVERLAP_EPSILON_S). Greedy coloring
 *     on start-sorted intervals uses exactly max-concurrency lanes, which is
 *     optimal; pre-seeding lane 0 with the backbone changes WHICH interval is
 *     on lane 0, never HOW MANY lanes exist.
 *
 * @param {Array<{key: string|number, start: number, end: number, duration: number}>} intervals
 * @returns {{ laneOf: Map<string|number, number>, backbone: Array<string|number>, laneCount: number }}
 */
export function assignLanes(intervals) {
  if (!intervals || intervals.length === 0) {
    return { laneOf: new Map(), backbone: [], laneCount: 0 };
  }

  const items = intervals.map((iv, idx) => ({ ...iv, idx }));
  const byStart = [...items].sort((a, b) => a.start - b.start || a.idx - b.idx);

  // ---- Backbone (lane 0): longest interval spine, grown by non-overlap ----
  const seed = [...items].sort(
    (a, b) => b.duration - a.duration || a.start - b.start || a.idx - b.idx,
  )[0];
  const backbone = [seed];
  const backboneKeys = new Set([seed.key]);
  for (const v of byStart) {
    if (backboneKeys.has(v.key)) continue;
    if (backbone.every((b) => !intervalsOverlap(b, v))) {
      backbone.push(v);
      backboneKeys.add(v.key);
    }
  }
  backbone.sort((a, b) => a.start - b.start || a.idx - b.idx);

  // ---- Angles (lanes 1+): minimal-lane greedy over the rest ----
  const angleItems = byStart.filter((v) => !backboneKeys.has(v.key));
  const laneEnds = []; // laneEnds[k] = last end on angle-lane (k+1)
  const laneOf = new Map(backbone.map((v) => [v.key, 0]));
  for (const v of angleItems) {
    let lane = -1;
    for (let k = 0; k < laneEnds.length; k++) {
      if (laneEnds[k] <= v.start + OVERLAP_EPSILON_S) {
        laneEnds[k] = v.end;
        lane = k + 1;
        break;
      }
    }
    if (lane === -1) {
      laneEnds.push(v.end);
      lane = laneEnds.length;
    }
    laneOf.set(v.key, lane);
  }

  return { laneOf, backbone: backbone.map((v) => v.key), laneCount: laneEnds.length + 1 };
}
