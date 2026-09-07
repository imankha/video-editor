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
 * @param {{ video: object, onFrame: Function, onError?: Function, encoderQueueDepth: Function, inFlightCap?: number }} options
 * @returns {Promise<{ push: Function, flush: Function, close: Function, stats: Function }>}
 */
export async function createDecodeStage({ video, onFrame, onError, encoderQueueDepth, inFlightCap = IN_FLIGHT_CAP }) {
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
  decoder.configure({
    codec: video.codec,
    codedWidth: video.codedWidth,
    codedHeight: video.codedHeight,
    description: video.description,
  });
  decoder.addEventListener('dequeue', resumeWaiters);

  return {
    async push(sample) {
      inFlight += 1;
      decoder.decode(sampleToChunk(sample));
      if (shouldPause()) {
        await new Promise((resolve) => waiters.push(resolve));
      }
    },
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
      return { framesDecoded, inFlight, liveFrames };
    },
  };
}
