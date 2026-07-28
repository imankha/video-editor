/**
 * Straighten-tool angle math (T5640).
 *
 * The user drags a reference line along something that should be level (a
 * horizon) or vertical (a goalpost). correctionAngle() converts that screen-space
 * drag into the content-correction angle theta (degrees, positive = rotate
 * content counter-clockwise — see rotationSafeArea.js for the full convention).
 */

import { MAX_ROT, ROTATION_EPSILON } from './rotationSafeArea';

/**
 * The correction angle (degrees) that levels the dragged reference line.
 *
 * dx/dy are screen-space (y-down). We reduce the drag angle mod 90 into
 * (-45, 45] so a near-horizontal drag levels to the nearest horizontal and a
 * near-vertical drag levels to the nearest vertical — the user just drags along
 * "the thing that should be straight." theta = -tilt rotates the content the
 * opposite way to bring the reference to level.
 *
 * NOT clamped here — callers clamp the committed value to +/- MAX_ROT.
 */
export function correctionAngle(p0, p1) {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const alpha = Math.atan2(dy, dx) * 180 / Math.PI;
  // Reduce to (-45, 45]: nearest level OR vertical.
  const tilt = ((((alpha + 45) % 90) + 90) % 90) - 45;
  return -tilt;
}

/**
 * Clamp a rotation (degrees) to the hard cap, and snap FP residue to exactly 0.
 *
 * This is the single chokepoint every committed rotation passes through
 * (`useCrop.setRotation` -> `clampRotation(deg)` -> surgical `set_rotation`), so
 * snapping any |deg| < ROTATION_EPSILON to 0 here keeps trig/accumulation noise
 * (T6170: `0.1+0.1+0.1-0.1-0.1-0.1 === 2.7755575615628914e-17`) out of the DB —
 * garbage never reaches persistence. It also normalizes the live preview value so
 * a nudged-to-zero dial reads exactly 0. The epsilon is 100,000x below the finest
 * 0.1-degree user step, so a real adjustment is never snapped away.
 */
export function clampRotation(deg) {
  if (Math.abs(deg) < ROTATION_EPSILON) return 0;
  return Math.max(-MAX_ROT, Math.min(MAX_ROT, deg));
}
