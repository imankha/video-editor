/**
 * T8840 pipeline/autoCrop.js -- pure math, no DOM. Suggests a crop rect from a set of
 * sampled RGBA frames by finding where content actually CHANGES across the clip
 * (players, ball) versus what stays visually constant (sky, empty field, background).
 *
 * Deliberately variance-over-widely-spaced-samples, not frame-to-frame differencing:
 * a slow lighting drift (a cloud passing) changes a cell's brightness gradually and
 * would still register as "changing" under naive diffing, but its variance across
 * ~8 samples spread over the whole clip is small next to a region where players
 * enter and leave repeatedly. This is a suggestion only -- the caller (tool.js) still
 * lets the user drag/resize it, per the project's own rule that framing stays a
 * human call ([[feedback_invisible_quality_neutral_optimizations]]).
 */

const DEFAULT_GRID_COLS = 24;
const DEFAULT_GRID_ROWS = 14;
const DEFAULT_THRESHOLD_FRACTION = 0.15; // fraction of the max cell's variance
const DEFAULT_PADDING_FRACTION = 0.03; // extra margin around the detected bbox
const MIN_AXIS_FRACTION = 0.1; // matches cropScale.resolveCropRect's own floor

/**
 * @param {Array<Uint8ClampedArray|Uint8Array>} frames - RGBA pixel buffers, all the
 *   SAME width*height*4, sampled at different timestamps across one segment.
 * @param {number} width
 * @param {number} height
 * @param {{ gridCols?: number, gridRows?: number, thresholdFraction?: number,
 *   paddingFraction?: number }} [opts]
 * @returns {{ x:number, y:number, w:number, h:number } | null} normalized 0..1 crop
 *   rect, or null if fewer than 2 frames or the clip shows no detectable change
 *   anywhere (caller should fall back to the full frame / today's manual default).
 */
export function suggestCropFromFrames(frames, width, height, opts = {}) {
  const {
    gridCols = DEFAULT_GRID_COLS,
    gridRows = DEFAULT_GRID_ROWS,
    thresholdFraction = DEFAULT_THRESHOLD_FRACTION,
    paddingFraction = DEFAULT_PADDING_FRACTION,
  } = opts;
  if (!Array.isArray(frames) || frames.length < 2 || width <= 0 || height <= 0) return null;

  const energy = computeCellVariance(frames, width, height, gridCols, gridRows);
  const maxEnergy = Math.max(...energy);
  if (!(maxEnergy > 0)) return null; // fully static across every sample -- nothing to suggest

  const threshold = maxEnergy * thresholdFraction;
  const bbox = boundingBoxAboveThreshold(energy, gridCols, gridRows, threshold);
  if (!bbox) return null;

  return padAndClampToMinimum(bbox, gridCols, gridRows, paddingFraction);
}

/** Per-grid-cell variance of mean luminance across the sampled frames. Exported for
 * direct unit testing without needing a full suggestCropFromFrames round trip. */
export function computeCellVariance(frames, width, height, gridCols, gridRows) {
  const cellW = width / gridCols;
  const cellH = height / gridRows;
  const cellCount = gridCols * gridRows;
  const perFrameMeans = frames.map((frame) => meanLuminancePerCell(frame, width, height, gridCols, gridRows, cellW, cellH));

  const variance = new Float64Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    let mean = 0;
    for (const means of perFrameMeans) mean += means[i];
    mean /= perFrameMeans.length;
    let sq = 0;
    for (const means of perFrameMeans) sq += (means[i] - mean) ** 2;
    variance[i] = sq / perFrameMeans.length;
  }
  return variance;
}

function meanLuminancePerCell(frame, width, height, gridCols, gridRows, cellW, cellH) {
  const cellCount = gridCols * gridRows;
  const sums = new Float64Array(cellCount);
  const counts = new Int32Array(cellCount);
  for (let y = 0; y < height; y++) {
    const row = Math.min(gridRows - 1, Math.floor(y / cellH));
    for (let x = 0; x < width; x++) {
      const col = Math.min(gridCols - 1, Math.floor(x / cellW));
      const idx = row * gridCols + col;
      const p = (y * width + x) * 4;
      // Rec. 601 luma weights -- good enough for a coarse motion heuristic.
      sums[idx] += 0.299 * frame[p] + 0.587 * frame[p + 1] + 0.114 * frame[p + 2];
      counts[idx]++;
    }
  }
  for (let i = 0; i < cellCount; i++) sums[i] /= counts[i] || 1;
  return sums;
}

function boundingBoxAboveThreshold(energy, gridCols, gridRows, threshold) {
  let minRow = gridRows, maxRow = -1, minCol = gridCols, maxCol = -1;
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      if (energy[row * gridCols + col] >= threshold) {
        if (row < minRow) minRow = row;
        if (row > maxRow) maxRow = row;
        if (col < minCol) minCol = col;
        if (col > maxCol) maxCol = col;
      }
    }
  }
  return maxRow < 0 ? null : { minRow, maxRow, minCol, maxCol };
}

function padAndClampToMinimum({ minRow, maxRow, minCol, maxCol }, gridCols, gridRows, paddingFraction) {
  let x0 = minCol / gridCols, x1 = (maxCol + 1) / gridCols;
  let y0 = minRow / gridRows, y1 = (maxRow + 1) / gridRows;

  const padX = (x1 - x0) * paddingFraction;
  const padY = (y1 - y0) * paddingFraction;
  x0 = Math.max(0, x0 - padX); x1 = Math.min(1, x1 + padX);
  y0 = Math.max(0, y0 - padY); y1 = Math.min(1, y1 + padY);

  growToMinimum(() => x1 - x0, (grow) => { x0 = Math.max(0, x0 - grow); x1 = Math.min(1, x1 + grow); });
  growToMinimum(() => y1 - y0, (grow) => { y0 = Math.max(0, y0 - grow); y1 = Math.min(1, y1 + grow); });

  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function growToMinimum(getSize, apply) {
  const size = getSize();
  if (size < MIN_AXIS_FRACTION) apply((MIN_AXIS_FRACTION - size) / 2);
}
