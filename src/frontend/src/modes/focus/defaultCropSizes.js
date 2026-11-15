/**
 * Default crop sizes, sized to LIMIT synthetic upscale on a 1080p source (T10150).
 * Each box is 2x the pre-T10150 fixed size: a 1080p source now enlarges ~2x (was ~4x)
 * to the 1440p-capped output — ~10x sharper by lap_var in the no-GAN benchmark
 * (scripts/quality_benchmark.py) — while still keeping the athlete a clear subject of
 * the frame (~18% of frame, vs ~12% for a max-fit crop).
 *
 * For aspect ratios not listed here (or a source too small to hold the box), the crop
 * is calculated to fit the video instead — see useCrop's calculateDefaultCrop.
 * Own module (T10990) so the store's ratio-switch preview (utils/refitCropKeyframes.js)
 * reads it without importing the useCrop hook.
 *
 * MUST stay mirrored with DEFAULT_CROP_SIZES in the backend
 * (src/backend/app/services/default_crop.py) — guarded by test_frontend_backend_parity
 * in src/backend/tests/test_default_crop.py.
 *
 * To add a new aspect ratio with fixed dimensions:
 *   'W:H': { width: X, height: Y }
 */
export const DEFAULT_CROP_SIZES = {
  '9:16': { width: 410, height: 730 },
  '16:9': { width: 1280, height: 720 },
};
