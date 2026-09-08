/**
 * T8840 pipeline/probe.js -- design §2.2, §4.
 *
 * ADAPTATION NOTE vs. design §7 (R-CAP-2): the design specified a pure
 * `capabilityFromTrack({codec, codedWidth, codedHeight}, outputConfig)` half, split
 * from parsing, so `checkCapability` could reuse the moov this tool's own
 * `demux.probeContainer` already parsed. T8838 landed BEFORE this design and ships
 * exactly what its own task-file caveat 11 specified instead:
 * `probeShrinkCapability(file, faststartInfo)` -- a single function that does its
 * OWN internal moov parse (T8838's own docs call the resulting duplicate parse
 * "harmless at 16-124 ms"). `checkCapability` here is adapted to that actual shape
 * (`(file, faststartInfo)`, not `(videoTrack, outputConfig)`) rather than
 * reimplementing the pure split T8838 didn't ship. A real, separate limitation this
 * carries: `probeShrinkCapability`'s encode check is hardcoded to the Recommended
 * preset's 2688-wide/12 Mbps target (T8838 §"ENCODE_WIDTH/ENCODE_BITRATE"), so it
 * does not verify encoder support at Sharpest's or Smallest's actual output size --
 * `runSpeedProbe` below (which runs the REAL preset through the REAL pipeline) is
 * what actually validates the chosen preset; capability is only a coarse yes/no gate
 * on WebCodecs existing at all (caveat 6: "supported" is not "fast enough").
 *
 * `checkCapability` is called from tool.js on the MAIN THREAD only, never from
 * worker.js -- `probeShrinkCapability`'s dynamic `import('mp4box')` (a bare
 * specifier) needs the import map declared in index.html, and module Workers do
 * not reliably inherit a document's import map across browsers (see worker.js's
 * import of this file: it only pulls in `runSpeedProbe`, which never calls
 * `checkCapability`/`probeShrinkCapability`, so the worker's module graph never
 * triggers that dynamic import).
 */

import { probeShrinkCapability } from '../../../src/frontend/src/utils/shrinkCapability.js';
import { openReader, probeContainer } from './demux.js';
import { resolveCropRect } from './cropScale.js';
import { resolveOutputSize } from './presets.js';
import { shrinkSegment, StageError } from './shrinkSegment.js';

export const SPEED_GO_MULTIPLIER = 0.5; // >= this: green, proceed
export const SPEED_REFUSE_MULTIPLIER = 0.25; // < this: red, refuse
export const PROBE_WARMUP_FRAMES = 30; // ~1s, discarded from timing (decoder/encoder/GPU spin-up)
export const PROBE_MEASURE_FRAMES = 90; // ~3s, the measured window
export const MAX_COMFORTABLE_SECONDS = 4 * 3600; // design §4.2 guard 1: a 3h+ job is a bad idea even at a green multiplier

/**
 * Capability gate: does WebCodecs support this file's codec at all? Delegates to
 * the shared T8838 module; never throws (design contract).
 * @param {File} file
 * @param {object} faststartInfo - from openReader(file).info (analyzeMp4Faststart shape)
 */
export async function checkCapability(file, faststartInfo) {
  try {
    const result = await probeShrinkCapability(file, faststartInfo);
    return {
      decode: result.decode,
      encode: result.encode,
      codecFamily: result.codecFamily,
      resBucket: result.resBucket,
    };
  } catch (err) {
    return { decode: 'unavailable', encode: 'unavailable', codecFamily: 'other', resBucket: 'gt4k', error: err.message };
  }
}

/**
 * The probe IS the real pipeline with `limits.sampleFrames` set (design §2.3) --
 * there is no second decode+encode path to keep in sync.
 * @param {{ file: File, crop: object, preset: object, signal?: AbortSignal }} options
 */
export async function runSpeedProbe({ file, crop, preset, signal }) {
  const reader = await openReader(file);
  const tracks = await probeContainer(reader);
  if (!tracks.video) throw new StageError('probe', 'no video track');

  const src = resolveCropRect(crop, tracks.video.codedWidth, tracks.video.codedHeight);
  const out = resolveOutputSize(preset, src.sw, src.sh);
  const sourceFps = tracks.video.fps;

  let warmupEndTime = null;
  let measureEndTime = null;
  const probeFrameCount = PROBE_WARMUP_FRAMES + PROBE_MEASURE_FRAMES;

  const result = await shrinkSegment({
    file,
    crop,
    preset,
    sink: null, // throwaway OPFS file; shrinkSegment deletes it before returning
    signal,
    limits: { sampleFrames: probeFrameCount },
    onProgress: ({ framesDone }) => {
      const now = performance.now();
      if (framesDone === PROBE_WARMUP_FRAMES) warmupEndTime = now;
      if (framesDone === probeFrameCount) measureEndTime = now;
    },
  });

  // M5(a): a segment shorter than the probe window never completes it -- both
  // timestamps must exist before any number is trusted. The old `?? 0` fallback
  // made elapsed time = time-since-worker-start (potentially hundreds of
  // seconds), collapsing fps and manufacturing a false 'too-slow' refusal on a
  // perfectly capable machine. Report 'unknown' instead of inventing a verdict.
  if (warmupEndTime == null || measureEndTime == null) {
    return {
      framesMeasured: 0, wallSeconds: 0, fps: 0, sourceFps,
      realtimeMultiplier: 0, pixelsPerSecond: 0, verdict: 'unknown',
    };
  }

  // M5(b): the numerator must be exactly the timed window (PROBE_MEASURE_FRAMES),
  // not `result.framesDone - PROBE_WARMUP_FRAMES` -- decoder.flush() after the
  // window closes drains additional queued frames through onFrame, so framesDone
  // can overshoot what the timer actually measured, overstating fps by up to ~70%.
  const framesMeasured = PROBE_MEASURE_FRAMES;
  const wallSeconds = Math.max(0.001, (measureEndTime - warmupEndTime) / 1000);
  const fps = framesMeasured / wallSeconds;
  const realtimeMultiplier = fps / sourceFps;
  const pixelsPerSecond = out.width * out.height * fps;
  const verdict = realtimeMultiplier >= SPEED_GO_MULTIPLIER ? 'go' : realtimeMultiplier >= SPEED_REFUSE_MULTIPLIER ? 'slow' : 'too-slow';

  return { framesMeasured, wallSeconds, fps, sourceFps, realtimeMultiplier, pixelsPerSecond, verdict };
}
