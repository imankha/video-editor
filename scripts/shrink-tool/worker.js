/**
 * T8840 worker.js -- postMessage protocol adapter (design §2.4). Rewritten (not
 * mechanically ported) by T8845; everything it calls into (`pipeline/*.js`) IS the
 * mechanical port.
 *
 * Protocol (design §2.4, "additions marked" over the task file's original):
 *   in  {cmd:'start', file, crop, preset, dirHandle, outName}
 *   in  {cmd:'probe',  file, crop, preset}
 *   in  {cmd:'cancel'}
 *   in  {cmd:'pause'} / {cmd:'resume'}                        design Q7
 *   out {type:'progress', framesDone, framesTotal, fps}       throttled to ~2/s HERE
 *   out {type:'done', file, bytes, encodedBytes, framesDone, wallSeconds, pixelsPerSecond}
 *   out {type:'probe', framesMeasured, wallSeconds, fps, sourceFps, realtimeMultiplier, pixelsPerSecond, verdict}
 *   out {type:'error', stage, message}
 *   out {type:'cancelled'}
 *
 * One worker for the whole job, reused across segments (module load + mp4box init
 * are not re-paid per segment) -- tool.js owns that lifecycle, not this file.
 */

import { shrinkSegment, createPauseGate, StageError } from './pipeline/shrinkSegment.js';
import { runSpeedProbe } from './pipeline/probe.js';

const PROGRESS_THROTTLE_MS = 500; // ~2/s

let activeAbort = null;
let activePauseGate = null;

/** Leading + trailing edge: never drops the final call in a burst (e.g. framesDone === framesTotal). */
function throttle(fn, ms) {
  let last = -Infinity;
  let timer = null;
  let trailingArgs = null;
  return (...args) => {
    const now = performance.now();
    const elapsed = now - last;
    if (elapsed >= ms) {
      last = now;
      fn(...args);
    } else {
      trailingArgs = args;
      if (!timer) {
        timer = setTimeout(() => {
          timer = null;
          last = performance.now();
          fn(...trailingArgs);
          trailingArgs = null;
        }, ms - elapsed);
      }
    }
  };
}

function postError(err) {
  self.postMessage({ type: 'error', stage: err instanceof StageError ? err.stage : 'unknown', message: err.message });
}

async function handleStart({ file, crop, preset, dirHandle, outName }) {
  activeAbort = new AbortController();
  activePauseGate = createPauseGate();
  const onProgress = throttle(({ framesDone, framesTotal, fps }) => {
    self.postMessage({ type: 'progress', framesDone, framesTotal, fps });
  }, PROGRESS_THROTTLE_MS);

  try {
    const result = await shrinkSegment({
      file,
      crop,
      preset,
      sink: { dirHandle, filename: outName },
      signal: activeAbort.signal,
      pauseGate: activePauseGate,
      onProgress,
    });

    if (result.cancelled) {
      self.postMessage({ type: 'cancelled' });
      return;
    }

    // B1: the persisted size must be the REAL OPFS file size -- `result.encodedBytes`
    // is only the encoded video/audio payload and excludes ftyp/mdat header/moov
    // (can be MB on a long segment), which made checkpoint.js's exact-equality
    // verifyOutputs check fail and delete every finished segment on reload.
    const outFile = await result.outputHandle.getFile();
    self.postMessage({
      type: 'done',
      file: outFile,
      bytes: outFile.size,
      encodedBytes: result.encodedBytes,
      framesDone: result.framesDone,
      wallSeconds: result.wallSeconds,
      pixelsPerSecond: result.pixelsPerSecond,
      mp4boxBuffers: result.mp4boxBuffers,
    });
  } catch (err) {
    postError(err);
  } finally {
    activeAbort = null;
    activePauseGate = null;
  }
}

async function handleProbe({ file, crop, preset }) {
  activeAbort = new AbortController();
  try {
    const result = await runSpeedProbe({ file, crop, preset, signal: activeAbort.signal });
    self.postMessage({ type: 'probe', ...result });
  } catch (err) {
    postError(err);
  } finally {
    activeAbort = null;
  }
}

function handleCancel() {
  if (activeAbort) {
    activeAbort.abort(); // shrinkSegment's own abort handler does the teardown (design §3.5) and this handler's try/finally posts 'cancelled' or 'done'/'error'
  } else {
    // Nothing running -- still acknowledge so tool.js's timer clears immediately.
    self.postMessage({ type: 'cancelled' });
  }
}

/** Pause (design Q7): "I need my laptop for 20 minutes" costs nothing, unlike Cancel. */
function handlePause() {
  activePauseGate?.pause();
}

function handleResume() {
  activePauseGate?.resume();
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg?.cmd === 'start') handleStart(msg);
  else if (msg?.cmd === 'probe') handleProbe(msg);
  else if (msg?.cmd === 'cancel') handleCancel();
  else if (msg?.cmd === 'pause') handlePause();
  else if (msg?.cmd === 'resume') handleResume();
};
