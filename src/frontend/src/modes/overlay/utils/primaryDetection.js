/**
 * primaryDetection - choose the MAIN CENTERED player from a YOLO detection set,
 * and derive the auto/pre-selected spotlight ellipse from it.
 *
 * Bug 38 (glitch 2): the auto/pre-selected spotlight used to sit at the
 * geometric frame center (`videoWidth/2, videoHeight/2`), IGNORING the detected
 * players entirely -- so it never actually chose the main centered player. The
 * intended rule is to spotlight the MAIN subject: the box nearest the frame
 * center AND prominent (large bounding box == closest to the action / camera).
 *
 * Confidence is only a final TIE-BREAK, never a selection driver, so a
 * high-confidence bystander at the edge does not beat the centered subject
 * (explicitly required by the report: "centered + prominent beats off-center /
 * high-confidence").
 *
 * Coordinate space: boxes are in SOURCE-VIDEO pixel space and `x`/`y` are the
 * box CENTER -- matching the YOLO producer (multi_clip.py) and the manual
 * click path (`PlayerDetectionOverlay.handlePlayerClick`), so the ellipse this
 * module produces is byte-identical in shape to a user-clicked pick.
 *
 * No fabricated data: when there is nothing usable to pick, the pickers return
 * null and the caller degrades visibly (a neutral centered default, not a
 * random box) per the project "no silent fallbacks for internal data" rule.
 */

// Weights: centeredness dominates, prominence assists. A perfectly centered
// small box (0.6) still beats a large box parked in a corner, while size breaks
// near-center ties toward the player closest to the action.
export const CENTER_WEIGHT = 0.6;
export const PROMINENCE_WEIGHT = 0.4;

// Spotlight radius padding around the chosen box -- matches the manual click
// path (`PlayerDetectionOverlay.handlePlayerClick`) so auto == manual shape.
export const SPOTLIGHT_RADIUS_SCALE = 1.3;

const SCORE_EPS = 1e-9;

/**
 * Score a single detection box for "main centered player" fitness in [0, 1].
 * Higher is better. Center distance is normalized against the corner distance
 * so it is resolution-independent; prominence is the box's fraction of frame
 * area (clamped to 1).
 */
export function scoreDetectionBox(box, videoWidth, videoHeight) {
  const cx = videoWidth / 2;
  const cy = videoHeight / 2;
  const maxDist = Math.hypot(cx, cy) || 1;
  const frameArea = videoWidth * videoHeight || 1;

  const dist = Math.hypot(box.x - cx, box.y - cy) / maxDist; // 0 center .. ~1 corner
  const centerScore = 1 - Math.min(dist, 1);
  const prominence = Math.min((box.width * box.height) / frameArea, 1);

  return CENTER_WEIGHT * centerScore + PROMINENCE_WEIGHT * prominence;
}

/**
 * Pick the primary (main centered + prominent) box from a detection box set.
 *
 * @param {Array<{x:number,y:number,width:number,height:number,confidence?:number}>} boxes
 *        box centers in source-video pixel space
 * @param {number} videoWidth  source frame width  (px)
 * @param {number} videoHeight source frame height (px)
 * @returns the winning box, or null when there is nothing valid to pick
 */
export function pickPrimaryDetectionBox(boxes, videoWidth, videoHeight) {
  if (!Array.isArray(boxes) || boxes.length === 0) return null;
  if (!videoWidth || !videoHeight) return null;

  let best = null;
  let bestScore = -Infinity;
  for (const box of boxes) {
    if (!box || typeof box.x !== 'number' || typeof box.y !== 'number') continue;
    if (!(box.width > 0) || !(box.height > 0)) continue;

    const score = scoreDetectionBox(box, videoWidth, videoHeight);
    const conf = typeof box.confidence === 'number' ? box.confidence : 0;
    const bestConf = best && typeof best.confidence === 'number' ? best.confidence : 0;

    if (score > bestScore + SCORE_EPS ||
        (Math.abs(score - bestScore) <= SCORE_EPS && conf > bestConf)) {
      best = box;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Return the `boxes` of the detection whose timestamp is nearest `time`.
 * Detections carry an absolute `timestamp` (seconds); fall back to `frame`/fps
 * when a timestamp is absent. Returns [] when nothing matches.
 */
export function detectionBoxesNearestTime(detections, time, fps = 30) {
  if (!Array.isArray(detections) || detections.length === 0) return [];

  let best = null;
  let bestDist = Infinity;
  for (const d of detections) {
    let t = null;
    if (typeof d.timestamp === 'number') t = d.timestamp;
    else if (typeof d.frame === 'number') t = d.frame / (fps || 30);
    if (t === null) continue;

    const dist = Math.abs(t - time);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best?.boxes || [];
}

/**
 * Build the spotlight ellipse (geometry only) from a chosen detection box.
 * Mirrors the manual click formula in `PlayerDetectionOverlay.handlePlayerClick`.
 * Returns null for a null box (caller degrades visibly).
 */
export function highlightFromDetectionBox(box) {
  if (!box) return null;
  return {
    x: box.x,
    y: box.y,
    radiusX: (box.width / 2) * SPOTLIGHT_RADIUS_SCALE,
    radiusY: (box.height / 2) * SPOTLIGHT_RADIUS_SCALE,
  };
}
