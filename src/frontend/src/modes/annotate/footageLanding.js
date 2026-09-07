import {
  buildFullVideoTimeline,
  buildGameTimeline,
  hasOverlappingAngles,
  videoDisplayName,
} from './hooks/useVirtualTimeline';

/**
 * Landing outcomes for footage added inside Annotate (T8910). Pure so the
 * three-variant decision — the part that is easy to get subtly wrong — is unit
 * testable without a rendered container.
 */
export const LANDING = { ANGLE: 'angle', MAIN: 'main', AMBER: 'amber' };

// Epsilon for "offset equals prefix-sum" (same 0.5s slack the backend's
// placement tolerance implies). Below this the placement was by prefix-sum.
const PREFIX_SUM_EPSILON_S = 0.5;

/**
 * Given the full, fresh video list (server-computed `offset_seconds`, from
 * GET /load or the attach response) and how many rows were just appended,
 * return one outcome per newly-added video:
 *   { sequence, name, variant, pos, virtualEnd }
 *
 * The variant is DERIVED FROM THE SERVER PLACEMENT, never re-inferred from the
 * raw timestamps client-side:
 *   ANGLE - overlaps existing footage -> a real angle lane (buildGameTimeline)
 *   AMBER - no usable recorded time -> placed by prefix-sum (appended at end);
 *           mirrors the backend's own branch (games.py compute_video_offsets),
 *           so it catches BOTH recorded_at == null AND the >12h-window case
 *           (both fall back to prefix-sum), which a `recorded_at == null` check
 *           alone would miss.
 *   MAIN  - placed on the main track at a real recorded-time position.
 *
 * `pos` is the video's start on the SAME virtual axis the timeline renders
 * against (so a toast's mm:ss and an amber bar's left edge both line up).
 */
export function computeLandingOutcomes(videos, addedCount) {
  if (!Array.isArray(videos) || videos.length === 0 || !addedCount) return [];
  const vids = [...videos].sort((a, b) => a.sequence - b.sequence);
  const added = vids.slice(-addedCount); // append-only tail (MAX(sequence)+1)
  const overlap = vids.length > 1 && hasOverlappingAngles(vids);
  const tl = vids.length > 1
    ? (overlap ? buildGameTimeline(vids) : buildFullVideoTimeline(vids))
    : null;

  return added.map((v) => {
    const name = videoDisplayName(v.original_filename, v.sequence - 1);
    const angle = overlap ? tl.angles.find((a) => a.sequence === v.sequence) : null;
    if (angle) {
      return {
        sequence: v.sequence,
        name,
        variant: LANDING.ANGLE,
        pos: angle.virtualStart,
        virtualEnd: angle.virtualEnd,
      };
    }

    const prefixSum = vids
      .filter((m) => m.sequence < v.sequence)
      .reduce((sum, m) => sum + (m.duration || 0), 0);
    const placedByPrefixSum =
      v.offset_seconds == null || Math.abs(v.offset_seconds - prefixSum) < PREFIX_SUM_EPSILON_S;

    let pos = 0;
    if (tl && overlap) pos = tl.sourceTimeToVirtual(v.sequence, 0);
    else if (tl) pos = tl.getVideoOffset(v.sequence);

    return {
      sequence: v.sequence,
      name,
      variant: placedByPrefixSum ? LANDING.AMBER : LANDING.MAIN,
      pos,
      virtualEnd: pos + (v.duration || 0),
    };
  });
}
