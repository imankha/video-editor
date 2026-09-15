/**
 * T9950 Slice 2 -- pure crop-geometry helpers for the "wider frame" edit and its
 * derived "is this clip wide?" read. No React, no I/O: every write goes through
 * FocusContainer's existing addOrUpdateKeyframe + persistKeyframeEdit pair
 * (design doc docs/plans/tasks/T9950-design.md section 2.1 "single write path").
 *
 * "Use a wider frame" is a crop EDIT, not a view toggle (design doc section 3):
 * it rewrites the crop keyframes to a bounded 2x scale of the default crop size,
 * so the choice reaches the renderer through the only thing it reads
 * (working_clips.crop_data).
 *
 * section 9.2 correction: the widen target is 2x the DEFAULT crop, not literal
 * max-fit. A full max-fit crop (crop height == source height) leaves zero
 * vertical positioning freedom, so widening would collapse every keyframe's
 * distinct vertical framing to the same value -- a toggle-off after reload
 * could not restore it. maxFitCrop stays as the safety-net clamp for small
 * sources (a source small enough that 2x would exceed it still needs the
 * upper bound), never the button's direct target.
 */

export const WIDE_FRAME_SCALE = 2;

// Video encoders want even dimensions. Rounds to nearest, then nudges down by
// one if that lands on odd (matches the direction FFmpeg-facing code in this
// repo already rounds -- see ai_upscaler/__init__.py "Ensure even dimensions").
function toEvenDimension(value) {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

/**
 * The largest rect of `aspectValue` (width/height) that fits inside the source.
 * Kept as the safety-net clamp for small sources -- never the widen button's
 * direct target (see wideFrameTarget below).
 *
 * @param {number} videoW
 * @param {number} videoH
 * @param {number} aspectValue - target width/height ratio
 * @returns {{width: number, height: number}}
 */
export function maxFitCrop(videoW, videoH, aspectValue) {
  if (!videoW || !videoH || !aspectValue) return { width: 0, height: 0 };
  const videoRatio = videoW / videoH;
  let width, height;
  if (videoRatio > aspectValue) {
    height = videoH;
    width = height * aspectValue;
  } else {
    width = videoW;
    height = width / aspectValue;
  }
  return { width: toEvenDimension(width), height: toEvenDimension(height) };
}

/**
 * The widen button's actual target (design doc section 9.2): WIDE_FRAME_SCALE x
 * the default crop size, clamped per-axis to maxFitCrop so a small source never
 * asks for more pixels than it has. `defaultCropSize` and `maxFitCrop` share the
 * same output aspect, so the per-axis min does not distort the ratio in the
 * common case (it can drift by a rounding pixel or two on the smallest sources,
 * which is the same tolerance `isWideFraming`'s epsilon already absorbs).
 *
 * @param {number} videoW
 * @param {number} videoH
 * @param {number} aspectValue
 * @param {{width: number, height: number}} defaultCropSize - e.g. useCrop's
 *   calculateDefaultCrop(...) width/height for the current aspect ratio.
 * @returns {{width: number, height: number}}
 */
export function wideFrameTarget(videoW, videoH, aspectValue, defaultCropSize) {
  const maxFit = maxFitCrop(videoW, videoH, aspectValue);
  return {
    width: Math.min(defaultCropSize.width * WIDE_FRAME_SCALE, maxFit.width),
    height: Math.min(defaultCropSize.height * WIDE_FRAME_SCALE, maxFit.height),
  };
}

/**
 * Resize a crop rect to (targetW, targetH) about its current center, clamped
 * into [0, 0, videoW, videoH]. Used for both the widen edit and its toggle-off
 * (shrink back to defaultCropSize at the same center). Straighten's inscribed
 * safe-area clamp is layered on top by the caller (FocusContainer), the same
 * way handleCropComplete already applies clampCropForCurrentRotation -- this
 * function only knows about the unrotated source bounds.
 *
 * @param {{x:number,y:number,width:number,height:number}} rect
 * @param {number} targetW
 * @param {number} targetH
 * @param {number} videoW
 * @param {number} videoH
 * @returns {{x:number,y:number,width:number,height:number}}
 */
export function resizeAboutCenter(rect, targetW, targetH, videoW, videoH) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  const maxX = Math.max(0, videoW - targetW);
  const maxY = Math.max(0, videoH - targetH);
  const x = Math.min(Math.max(Math.round(centerX - targetW / 2), 0), maxX);
  const y = Math.min(Math.max(Math.round(centerY - targetH / 2), 0), maxY);
  return { x, y, width: Math.round(targetW), height: Math.round(targetH) };
}

/**
 * Derived "is this clip widely framed?" -- NEVER stored (design doc section
 * 2.1/3.3). True only when every keyframe's size is within `epsilon` (fraction
 * of the target width) of the CURRENT wide-frame target -- the same 2x-scaled
 * target the button writes, not max-fit. A definition change (e.g. a different
 * default crop size) just makes an old wide clip read as "not wide"; nothing
 * is lost, one tap re-widens (design doc section 3.3).
 *
 * @param {Array<{width:number,height:number}>} keyframes
 * @param {{width:number,height:number}} videoDims
 * @param {number} aspectValue
 * @param {{width:number,height:number}} defaultCropSize
 * @param {number} [epsilon=0.01] - fraction of target width used as tolerance
 * @returns {boolean}
 */
export function isWideFraming(keyframes, videoDims, aspectValue, defaultCropSize, epsilon = 0.01) {
  if (!keyframes || keyframes.length === 0) return false;
  if (!videoDims?.width || !videoDims?.height) return false;
  const target = wideFrameTarget(videoDims.width, videoDims.height, aspectValue, defaultCropSize);
  if (!target.width || !target.height) return false;
  const tolerance = target.width * epsilon;
  return keyframes.every(kf =>
    Math.abs(kf.width - target.width) <= tolerance &&
    Math.abs(kf.height - target.height) <= tolerance
  );
}
