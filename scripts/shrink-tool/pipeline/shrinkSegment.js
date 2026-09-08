/**
 * T8840 pipeline/shrinkSegment.js -- the 9th pipeline module (design §2.2, §6.3): the
 * DOM-free orchestrator wiring demux -> decode -> cropScale -> encode -> mux. This is
 * the single most delicate ~150 lines of the task (backpressure, the `t0` handshake,
 * teardown order) -- kept out of worker.js on purpose so T8845's port stays mechanical.
 *
 * `runSpeedProbe` (pipeline/probe.js) calls this SAME function with `limits.sampleFrames`
 * set (design §2.3) -- there is no second pipeline to keep in sync.
 */

import { openReader, probeContainer, streamSamples } from './demux.js';
import { createDecodeStage } from './decode.js';
import { resolveCropRect, createCropScaler } from './cropScale.js';
import { pickOutputCodec, createEncodeStage } from './encode.js';
import { createOpfsSink, createMuxer } from './mux.js';
import { resolveOutputSize } from './presets.js';

const DEFAULT_CHUNK_SIZE_MB = 32;
const DEFAULT_IN_FLIGHT_CAP = 32;

/** Closed stage vocabulary (design §2.2): what {type:'error', stage, message} reports. */
export class StageError extends Error {
  constructor(stage, message) {
    super(message);
    this.name = 'StageError';
    this.stage = stage;
  }
}

async function createThrowawaySink() {
  const root = await navigator.storage.getDirectory();
  const scratchDir = await root.getDirectoryHandle('shrink-tool-scratch', { create: true });
  const filename = `probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}.part`;
  return { dirHandle: scratchDir, filename, throwaway: true };
}

/**
 * Pause (design Q7, approved): distinct from Cancel -- "I need my laptop for
 * 20 minutes" should cost nothing, not a whole re-encoded segment. The demux
 * loop (`streamSamples`) awaits this gate between chunks; decode/encode/mux
 * simply stop being fed while paused, which is enough to free the machine up.
 */
export function createPauseGate() {
  let paused = false;
  let resolveWait = null;
  return {
    pause() {
      paused = true;
    },
    resume() {
      paused = false;
      if (resolveWait) {
        const r = resolveWait;
        resolveWait = null;
        r();
      }
    },
    isPaused() {
      return paused;
    },
    async wait() {
      if (!paused) return;
      await new Promise((resolve) => {
        resolveWait = resolve;
      });
    },
  };
}

function anySignal(signals) {
  const real = signals.filter(Boolean);
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(real);
  const controller = new AbortController();
  for (const s of real) {
    if (s.aborted) controller.abort();
    else s.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return controller.signal;
}

function makeFpsTracker() {
  let ewma = 0;
  let lastT = null;
  return (now) => {
    if (lastT !== null) {
      const dt = (now - lastT) / 1000;
      if (dt > 0) {
        const instantaneous = 1 / dt;
        ewma = ewma === 0 ? instantaneous : ewma * 0.7 + instantaneous * 0.3;
      }
    }
    lastT = now;
    return ewma;
  };
}

/**
 * @param {{ file: File, crop: object, preset: object, sink: {dirHandle, filename}|null,
 *   onProgress?: Function, signal?: AbortSignal, pauseGate?: ReturnType<typeof createPauseGate>,
 *   limits?: { chunkSizeMB?: number, inFlightCap?: number, sampleFrames?: number|null } }} options
 */
export async function shrinkSegment({ file, crop, preset, sink, onProgress = () => {}, signal, pauseGate, limits = {} }) {
  const resolvedSink = sink ?? (await createThrowawaySink());
  try {
    return await runShrinkSegment({ file, crop, preset, sink: resolvedSink, onProgress, signal, pauseGate, limits });
  } finally {
    if (resolvedSink.throwaway) {
      await resolvedSink.dirHandle.removeEntry(resolvedSink.filename).catch(() => {});
    }
  }
}

async function runShrinkSegment({ file, crop, preset, sink, onProgress, signal, pauseGate, limits }) {
  const { chunkSizeMB = DEFAULT_CHUNK_SIZE_MB, inFlightCap = DEFAULT_IN_FLIGHT_CAP, sampleFrames = null } = limits;
  const startTime = performance.now();
  const fpsTracker = makeFpsTracker();

  let reader;
  let tracks;
  try {
    reader = await openReader(file);
    tracks = await probeContainer(reader, { chunkSizeMB });
  } catch (err) {
    throw new StageError('analyze', err.message);
  }
  if (!tracks.video) throw new StageError('analyze', 'no video track');

  const src = resolveCropRect(crop, tracks.video.codedWidth, tracks.video.codedHeight);
  const out = resolveOutputSize(preset, src.sw, src.sh);

  let codecChoice;
  try {
    codecChoice = await pickOutputCodec({ width: out.width, height: out.height, bitrate: preset.bitrate, framerate: tracks.video.fps });
  } catch (err) {
    throw new StageError('encode', err.message);
  }
  if (!codecChoice) throw new StageError('encode', `no supported output encoder at ${out.width}x${out.height}`);

  let opfsSink;
  try {
    opfsSink = await createOpfsSink(sink.dirHandle, sink.filename);
  } catch (err) {
    throw new StageError('mux', err.message);
  }

  // Diagnostic only (encoded video payload + raw audio payload) -- NEVER the
  // persisted `outputBytes` (B1: that must be the real OPFS file size, which only
  // the caller knows after finalize()/abort() -- see worker.js).
  let encodedBytes = 0;
  const muxer = createMuxer({
    target: opfsSink.target,
    writable: opfsSink.writable,
    video: { codec: codecChoice.muxerCodec, width: out.width, height: out.height },
    audio: tracks.audio,
  });

  let pipelineError = null;
  const sampleAbort = new AbortController();
  const combinedSignal = anySignal([signal, sampleAbort.signal]);
  // A paused demux loop is parked on `pauseGate.wait()`, not the abort check --
  // an abort arriving while paused must wake it too, or Cancel/probe-sample-abort
  // stays stuck forever behind the pause.
  combinedSignal.addEventListener('abort', () => pauseGate?.resume(), { once: true });

  let encoder;
  try {
    encoder = await createEncodeStage({
      width: out.width,
      height: out.height,
      bitrate: preset.bitrate,
      framerate: tracks.video.fps,
      onChunk: (chunk, meta) => {
        encodedBytes += chunk.byteLength;
        muxer.addVideoChunk(chunk, meta);
      },
      onError: (err) => {
        pipelineError = pipelineError ?? new StageError('encode', err.message);
        sampleAbort.abort();
      },
    });
  } catch (err) {
    throw new StageError('encode', err.message);
  }

  const scaler = createCropScaler({
    sourceWidth: tracks.video.codedWidth,
    sourceHeight: tracks.video.codedHeight,
    crop,
    outWidth: out.width,
    outHeight: out.height,
  });

  const framesTotal = sampleFrames ?? tracks.video.nbSamples;
  let framesDone = 0;

  const decoder = await createDecodeStage({
    video: tracks.video,
    inFlightCap,
    encoderQueueDepth: encoder.queueDepth,
    signal: combinedSignal,
    onError: (err) => {
      pipelineError = pipelineError ?? new StageError('decode', err.message);
      sampleAbort.abort();
    },
    onFrame: async (frame) => {
      let scaled;
      try {
        scaled = scaler.transform(frame); // closes `frame`, returns a new one
      } catch (err) {
        frame.close();
        pipelineError = pipelineError ?? new StageError('crop', err.message);
        sampleAbort.abort();
        return;
      }
      encoder.encode(scaled); // closes `scaled` (even if encode() throws -- M3)
      framesDone += 1;
      const now = performance.now();
      onProgress({ framesDone, framesTotal, fps: fpsTracker(now), stage: 'encode' });
      if (sampleFrames && framesDone >= sampleFrames) sampleAbort.abort();
    },
  });

  // B2: the backpressure gate watches the encoder's queue depth but had no
  // encoder-side wake source -- only decoder-side events (`dequeue`, per-frame
  // `finally`) ever called `resumeWaiters()`. On an encode-bound pipeline (every
  // real machine, caveat 4), the decoder drains fully and stops firing its own
  // events while the encoder queue is still over cap, parking `push()` forever.
  // Wire the encoder's own `dequeue` event to the decode stage's `wake()`.
  const unwatchEncoderDequeue = encoder.onDequeue(() => decoder.wake());

  let demuxResult = { samplesRead: 0, releaseCalls: 0, maxMp4boxBuffers: 0, finalMp4boxBuffers: 0 };
  try {
    demuxResult = await streamSamples(reader, tracks, {
      chunkSizeMB,
      onVideoSample: (sample) => decoder.push(sample),
      onAudioSample: (sample) => {
        encodedBytes += sample.size ?? 0;
        muxer.addAudioSample(sample);
      },
      signal: combinedSignal,
      pauseGate,
    });
  } catch (err) {
    if (!signal?.aborted) {
      pipelineError = pipelineError ?? new StageError('demux', err.message);
    }
  } finally {
    unwatchEncoderDequeue();
  }

  const aborted = signal?.aborted === true;
  if (aborted || pipelineError) {
    // Cancel OR pipeline-error teardown, exact order (design §3.5): close (not
    // flush) so queued inputs/outputs are discarded, then abort (not finalize)
    // the sink. M2: a known-bad run must never attempt decoder.flush()/
    // encoder.flush()/muxer.finalize() -- flushing an errored codec throws a
    // generic InvalidStateError that masks the real StageError, and skipping
    // muxer.abort() leaks the FileSystemWritableFileStream on the .part file.
    decoder.close();
    scaler.close();
    encoder.close();
    await muxer.abort();
    if (pipelineError) {
      // A genuine failure (not a user Cancel) leaves an invalid, orphaned
      // .part file behind -- Cancel's own cleanup is the caller's job
      // (tool.js's finishCancel), but nothing else ever cleans up a failed
      // run's partial output, so do it here rather than leaking disk space
      // until a retry happens to overwrite it.
      await sink.dirHandle.removeEntry(sink.filename).catch(() => {});
      throw pipelineError;
    }
    return { cancelled: true, framesDone, framesTotal, liveFrames: decoder.stats().liveFrames };
  }

  await decoder.flush();
  await encoder.flush();
  await muxer.finalize();

  const liveFrames = decoder.stats().liveFrames;
  if (liveFrames !== 0) {
    // Never silently "fix" this -- it means a frame leaked past cropScale's
    // single-owner rule. Log loudly and let the caller decide what to do.
    console.error(`shrinkSegment: expected liveFrames === 0 after teardown, got ${liveFrames}`);
  }

  const wallSeconds = (performance.now() - startTime) / 1000;
  return {
    framesDone,
    framesTotal,
    encodedBytes,
    wallSeconds,
    pixelsPerSecond: wallSeconds > 0 ? (out.width * out.height * framesDone) / wallSeconds : 0,
    outputHandle: opfsSink.handle,
    mp4boxBuffers: demuxResult.maxMp4boxBuffers,
  };
}
