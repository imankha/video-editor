/**
 * T8840 pipeline/cropScale.js -- design §2.2.
 *
 * `resolveCropRect` is PURE and fully unit-testable without a canvas.
 *
 * Frame ownership rule (single owner, always): `transform(frame)` closes `frame`
 * before it returns and hands back a NEW `VideoFrame` that the caller must close
 * immediately after `encoder.encode()`. There is never a moment where two
 * references to the same frame exist.
 */

const MIN_CROP_FRACTION = 0.1; // task file: crop clamps so width/height >= 10% of the source

/**
 * @param {{ x: number, y: number, w: number, h: number }} crop - normalized 0..1, origin top-left
 * @param {number} sourceWidth
 * @param {number} sourceHeight
 * @returns {{ sx: number, sy: number, sw: number, sh: number }} integer pixel rect, clamped into the frame
 */
export function resolveCropRect(crop, sourceWidth, sourceHeight) {
  const clamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

  let w = Math.max(MIN_CROP_FRACTION, Math.min(1, clamp01(crop.w)));
  let h = Math.max(MIN_CROP_FRACTION, Math.min(1, clamp01(crop.h)));
  let x = Math.min(1 - w, clamp01(crop.x));
  let y = Math.min(1 - h, clamp01(crop.y));
  x = Math.max(0, x);
  y = Math.max(0, y);

  let sx = Math.round(x * sourceWidth);
  let sy = Math.round(y * sourceHeight);
  let sw = Math.round(w * sourceWidth);
  let sh = Math.round(h * sourceHeight);

  sx = Math.min(Math.max(0, sx), Math.max(0, sourceWidth - 1));
  sy = Math.min(Math.max(0, sy), Math.max(0, sourceHeight - 1));
  sw = Math.min(Math.max(1, sw), sourceWidth - sx);
  sh = Math.min(Math.max(1, sh), sourceHeight - sy);

  return { sx, sy, sw, sh };
}

/**
 * @param {{ sourceWidth: number, sourceHeight: number, crop: object, outWidth: number, outHeight: number }} options
 * @returns {{ transform: (frame: VideoFrame) => VideoFrame, close: () => void }}
 */
export function createCropScaler({ sourceWidth, sourceHeight, crop, outWidth, outHeight }) {
  const { sx, sy, sw, sh } = resolveCropRect(crop, sourceWidth, sourceHeight);
  const canvas = new OffscreenCanvas(outWidth, outHeight);
  const ctx = canvas.getContext('2d');

  return {
    transform(frame) {
      const timestamp = frame.timestamp;
      const duration = frame.duration ?? undefined;
      ctx.drawImage(frame, sx, sy, sw, sh, 0, 0, outWidth, outHeight);
      frame.close();
      return new VideoFrame(canvas, { timestamp, duration });
    },
    close() {
      // No explicit resource to release; present for symmetry with the other stages.
    },
  };
}
