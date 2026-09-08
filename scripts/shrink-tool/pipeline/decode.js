/**
 * T8840 pipeline/decode.js -- owns the backpressure gate (design §2.2, §1.3 smell 1).
 *
 * `push(sample)` is where backpressure lives: the caller (demux.streamSamples) cannot
 * forget to await it, because `onVideoSample` is awaited by contract. The gate watches
 * the decoder's OWN queue depth AND the encoder's queue depth (new versus the spike --
 * an encode-bound pipeline can pile up VideoFrames in GPU memory otherwise).
 */

// >= hardware pipeline depth. T8830: a cap of 8 stalled the Legends 1080p control
// forever (Chromium's hardware H.264 decoder holds more than 8 inputs before its
// first output); 32 is proven safe on both the HEVC and H.264 paths.
export const IN_FLIGHT_CAP = 32;

function sampleToChunk(sample) {
  return new EncodedVideoChunk({
    type: sample.is_sync ? 'key' : 'delta',
    timestamp: (sample.cts * 1e6) / sample.timescale,
    duration: (sample.duration * 1e6) / sample.timescale,
    data: sample.data,
  });
}

/**
 * @param {{ video: object, onFrame: Function, onError?: Function, encoderQueueDepth: Function, inFlightCap?: number, signal?: AbortSignal }} options
 * @returns {Promise<{ push: Function, wake: Function, flush: Function, close: Function, stats: Function }>}
 */
/**
 * Prefer the hardware media engine, fall back to the browser's own choice only if
 * the strict flag isn't reported as supported (never hard-refuse on it alone).
 * Returns the `hardwareAcceleration` value that isConfigSupported accepted.
 */
export async function pickAcceleration(config, Codec = VideoDecoder) {
  if (typeof Codec === 'undefined' || !Codec?.isConfigSupported) return 'no-preference';
  for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
    try {
      const res = await Codec.isConfigSupported({ ...config, hardwareAcceleration });
      if (res?.supported) return hardwareAcceleration;
    } catch {
      // try the next preference
    }
  }
  return 'no-preference';
}

export async function createDecodeStage({ video, onFrame, onError, encoderQueueDepth, inFlightCap = IN_FLIGHT_CAP, signal }) {
  let framesDecoded = 0;
  let inFlight = 0; // samples handed to decoder.decode(), not yet output
  let liveFrames = 0; // frames emitted by the decoder, still owned downstream
  const pendingFrames = new Set();
  const waiters = [];

  function shouldPause() {
    return decoder.decodeQueueSize > inFlightCap || inFlight > inFlightCap || encoderQueueDepth() > inFlightCap;
  }

  function resumeWaiters() {
    while (waiters.length && !shouldPause()) {
      waiters.shift()();
    }
  }

  // B2 fix: `resumeWaiters` only drains waiters whose gate condition has ALREADY
  // cleared. It was only ever called from decoder-side events -- on an encode-bound
  // pipeline (every real machine, caveat 4) the decoder drains fully and stops
  // firing those events while the encoder queue is still over cap, parking `push()`
  // forever. The orchestrator wires the encoder's own `dequeue` event to `wake()`.
  function wake() {
    resumeWaiters();
  }

  // A parked push() must also unpark on abort -- otherwise a pipeline error or a
  // Cancel whose queues never drain (both routes through this same gate) can never
  // reach the teardown code that follows it (B2 second consequence).
  function unparkAll() {
    while (waiters.length) waiters.shift()();
  }
  signal?.addEventListener('abort', unparkAll, { once: true });

  const decoder = new VideoDecoder({
    output: (frame) => {
      framesDecoded += 1;
      inFlight -= 1;
      liveFrames += 1;
      // The frame ownership rule (cropScale.js) guarantees `onFrame` closes every
      // frame it touches before its promise settles -- this is what makes
      // `liveFrames === 0` after flush()/close() a real assertion, not a hope.
      const p = Promise.resolve(onFrame(frame))
        .catch((err) => onError?.(err))
        .finally(() => {
          liveFrames -= 1;
          pendingFrames.delete(p);
          resumeWaiters();
        });
      pendingFrames.add(p);
      resumeWaiters();
    },
    error: (err) => onError?.(err),
  });
  // Ask for the GPU media engine explicitly. The WebCodecs default ('no-preference')
  // lets the browser silently fall back to software, which at 8K would fail the
  // speed probe anyway -- so state the intent, but don't hard-refuse on
  // 'prefer-hardware' alone: some platforms misreport that flag even when the
  // hardware path exists. Record which one was granted so the UI can show it.
  const baseConfig = {
    codec: video.codec,
    codedWidth: video.codedWidth,
    codedHeight: video.codedHeight,
    description: video.description,
  };
  const decoderAcceleration = await pickAcceleration(baseConfig);
  decoder.configure({ ...baseConfig, hardwareAcceleration: decoderAcceleration });
  decoder.addEventListener('dequeue', resumeWaiters);

  return {
    async push(sample) {
      inFlight += 1;
      decoder.decode(sampleToChunk(sample));
      if (shouldPause() && !signal?.aborted) {
        await new Promise((resolve) => waiters.push(resolve));
      }
    },
    wake,
    async flush() {
      await decoder.flush();
      await Promise.all(pendingFrames);
    },
    close() {
      // Hard teardown, no flush: queued inputs are discarded, their frames never
      // created (design §3.5). Frames already in flight are the orchestrator's
      // responsibility to drop.
      decoder.close();
    },
    stats() {
      return { framesDecoded, inFlight, liveFrames, decoderAcceleration };
    },
  };
}
