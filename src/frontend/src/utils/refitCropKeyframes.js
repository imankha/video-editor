import { DEFAULT_CROP_SIZES } from '../modes/focus/defaultCropSizes';

/**
 * In-memory preview of the server's aspect-ratio re-fit (T10990). Mirrors
 * refit_crop_keyframes in src/backend/app/services/default_crop.py: each box keeps its
 * center, takes the new ratio's default size, and is clamped to the frame. It is shown only
 * until the POST answers; the server's crops then replace it, so a drift is never persisted.
 *
 * @param {Array} keyframes - crop keyframes ({frame, x, y, width, height, ...})
 * @param {number|null} videoWidth
 * @param {number|null} videoHeight
 * @param {string} aspectRatio - a product ratio with a DEFAULT_CROP_SIZES entry
 */
export function refitCropKeyframes(keyframes, videoWidth, videoHeight, aspectRatio) {
  const size = DEFAULT_CROP_SIZES[aspectRatio];
  if (!size) throw new Error(`refitCropKeyframes: no default crop size for ${aspectRatio}`);
  const hasBounds = Boolean(videoWidth) && Boolean(videoHeight);
  // A source smaller than the box: the server fits the box to the video instead.
  const fits = !hasBounds || (size.width <= videoWidth && size.height <= videoHeight);
  let { width, height } = size;
  if (!fits) {
    const [ratioW, ratioH] = aspectRatio.split(':').map(Number);
    const ratio = ratioW / ratioH;
    if (videoWidth / videoHeight > ratio) {
      height = videoHeight;
      width = Math.round(height * ratio);
    } else {
      width = videoWidth;
      height = Math.round(width / ratio);
    }
  }
  return keyframes.map((kf) => {
    if ([kf.x, kf.y, kf.width, kf.height].some((v) => v == null)) return { ...kf };
    let x = Math.max(Math.round(kf.x + kf.width / 2 - width / 2), 0);
    let y = Math.max(Math.round(kf.y + kf.height / 2 - height / 2), 0);
    if (hasBounds) {
      x = Math.min(x, Math.max(0, videoWidth - width));
      y = Math.min(y, Math.max(0, videoHeight - height));
    }
    return { ...kf, x, y, width, height };
  });
}
