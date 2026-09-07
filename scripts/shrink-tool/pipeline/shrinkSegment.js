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
 * Peeks at the first video and (if present) first audio sample's real CTS, in
 * microseconds, WITHOUT touching the decoder/encoder/muxer. mp4box only resolves a
 * sample's actual composition time once that sample has streamed through
 * (probeContainer only parses moov headers), so this runs a throwaway demux pass
 * that self-aborts the instant both are known. Needed for the single shared
 * `timestampOriginUs` design §2.2 mux requires -- see mux.js's header comment.
 */
async function peekFirstTimestamps(reader, tracks, chunkSizeMB) {
  let firstVideoCtsUs = null;
  let firstAudioCtsUs = tracks.audio ? null : 0;
  const peekAbort = new AbortController();

  const bothKnown = () => firstVideoCtsUs !== null && firstAudioCtsUs !== null;

  try {
    await streamSamples(reader, tracks, {
      chunkSizeMB,
      onVideoSample: async (sample) => {
        if (firstVideoCtsUs === null) firstVideoCtsUs = (sample.cts / sample.timescale) * 1e6;
        if (bothKnown()) peekAbort.abort();
      },
      onAudioSample: (sample) => {
        if (firstAudioCtsUs === null) firstAudioCtsUs = (sample.cts / sample.timescale) * 1e6;
        if (bothKnown()) peekAbort.abort();
      },
      signal: peekAbort.signal,
    });
  } catch {
    // Deliberate self-abort, or the file ran out of samples before both trakcs
    // reported in (e.g. no audio) -- either way, use whatever was captured.
  }

  return {
    firstVideoCtsUs: firstVideoCtsUs ?? 0,
    firstAudioCtsUs: firstAudioCtsUs ?? 0,
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
 *   onProgress?: Function, signal?: AbortSignal,
 *   limits?: { chunkSizeMB?: number, inFlightCap?: number, sampleFrames?: number|null } }} options
 */
export async function shrinkSegment({ file, crop, preset, sink, onProgress = () => {}, signal, limits = {} }) {
  const resolvedSink = sink ?? (await createThrowawaySink());
  try {
    return await runShrinkSegment({ file, crop, preset, sink: resolvedSink, onProgress, signal, limits });
  } finally {
    if (resolvedSink.throwaway) {
      await resolvedSink.dirHandle.removeEntry(resolvedSink.filename).catch(() => {});
    }
  }
}

async function runShrinkSegment({ file, crop, preset, sink, onProgress, signal, limits }) {
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

  const { firstVideoCtsUs, firstAudioCtsUs } = await peekFirstTimestamps(reader, tracks, chunkSizeMB);
  const timestampOriginUs = tracks.audio ? Math.min(firstVideoCtsUs, firstAudioCtsUs) : firstVideoCtsUs;

  let opfsSink;
  try {
    opfsSink = await createOpfsSink(sink.dirHandle, sink.filename);
  } catch (err) {
    throw new StageError('mux', err.message);
  }

  let bytes = 0;
  const muxer = createMuxer({
    target: opfsSink.target,
    writable: opfsSink.writable,
    video: { codec: codecChoice.muxerCodec, width: out.width, height: out.height },
    audio: tracks.audio,
    timestampOriginUs,
  });

  let pipelineError = null;
  const sampleAbort = new AbortController();
  const combinedSignal = anySignal([signal, sampleAbort.signal]);

  let encoder;
  try {
    encoder = await createEncodeStage({
      width: out.width,
      height: out.height,
      bitrate: preset.bitrate,
      framerate: tracks.video.fps,
      onChunk: (chunk, meta) => {
        bytes += chunk.byteLength;
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
      encoder.encode(scaled); // closes `scaled`
      framesDone += 1;
      const now = performance.now();
      onProgress({ framesDone, framesTotal, fps: fpsTracker(now), stage: 'encode' });
      if (sampleFrames && framesDone >= sampleFrames) sampleAbort.abort();
    },
  });

  let demuxResult = { samplesRead: 0, releaseCalls: 0, maxMp4boxBuffers: 0, finalMp4boxBuffers: 0 };
  try {
    demuxResult = await streamSamples(reader, tracks, {
      chunkSizeMB,
      onVideoSample: (sample) => decoder.push(sample),
      onAudioSample: (sample) => {
        bytes += sample.size ?? 0;
        muxer.addAudioSample(sample);
      },
      signal: combinedSignal,
    });
  } catch (err) {
    if (!signal?.aborted) {
      pipelineError = pipelineError ?? new StageError('demux', err.message);
    }
  }

  if (signal?.aborted) {
    // Cancel teardown, exact order (design §3.5): close (not flush) so queued
    // inputs/outputs are discarded, then abort (not finalize) the sink.
    decoder.close();
    scaler.close();
    encoder.close();
    await muxer.abort();
    return { cancelled: true, framesDone, framesTotal, liveFrames: decoder.stats().liveFrames };
  }

  await decoder.flush();
  await encoder.flush();
  await muxer.finalize();

  if (pipelineError) throw pipelineError;

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
    bytes,
    wallSeconds,
    pixelsPerSecond: wallSeconds > 0 ? (out.width * out.height * framesDone) / wallSeconds : 0,
    outputHandle: opfsSink.handle,
    mp4boxBuffers: demuxResult.maxMp4boxBuffers,
  };
}
