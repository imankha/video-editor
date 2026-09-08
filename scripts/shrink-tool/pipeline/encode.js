/**
 * T8840 pipeline/encode.js -- design §2.2.
 *
 * H.264 High 5.1 is the preferred and expected output codec on every device this
 * tool will ever run on (R11: HEVC output is rejected on browser-compatibility
 * grounds -- Firefox and much of Chrome lack HEVC decode). The HEVC fallback below
 * exists only for the rare device that can encode HEVC but not H.264 at all; it is
 * a capability-exhaustion fallback, not an alternative the tool ever prefers.
 */

export const OUTPUT_CODEC = 'avc1.640033'; // H.264 High 5.1, covers all three presets
export const KEYFRAME_INTERVAL_SEC = 2; // tech notes: sane seek/annotate later

const HEVC_FALLBACK_CODEC = 'hev1.1.6.L120.90';

/**
 * @param {{ width: number, height: number, bitrate: number, framerate: number }} config
 * @returns {Promise<{ codec: string, muxerCodec: 'avc'|'hevc' } | null>}
 */
export async function pickOutputCodec({ width, height, bitrate, framerate }) {
  if (typeof VideoEncoder === 'undefined' || !VideoEncoder.isConfigSupported) return null;

  try {
    const h264 = await VideoEncoder.isConfigSupported({ codec: OUTPUT_CODEC, width, height, bitrate, framerate });
    if (h264?.supported) return { codec: OUTPUT_CODEC, muxerCodec: 'avc' };
  } catch {
    // fall through to the HEVC fallback
  }

  try {
    const hevc = await VideoEncoder.isConfigSupported({ codec: HEVC_FALLBACK_CODEC, width, height, bitrate, framerate });
    if (hevc?.supported) return { codec: HEVC_FALLBACK_CODEC, muxerCodec: 'hevc' };
  } catch {
    // no supported output encoder at all
  }

  return null;
}

/**
 * @param {{ width: number, height: number, bitrate: number, framerate: number, onChunk: Function, onError?: Function }} options
 */
export async function createEncodeStage({ width, height, bitrate, framerate, onChunk, onError }) {
  const choice = await pickOutputCodec({ width, height, bitrate, framerate });
  if (!choice) {
    throw new Error(`encode.createEncodeStage: no supported output encoder at ${width}x${height}`);
  }

  let framesEncoded = 0;
  let lastKeyframeSec = null;
  const dequeueListeners = new Set();

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      framesEncoded += 1;
      onChunk(chunk, meta);
    },
    error: (err) => onError?.(err),
  });
  encoder.configure({
    codec: choice.codec,
    width,
    height,
    bitrate,
    framerate,
    // mp4-muxer crashes at finalize without this (caveat 2).
    colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
  });
  // B2: `VideoEncoder` fires `dequeue` too -- this is decode.js's missing
  // encoder-side wake source for its backpressure gate.
  encoder.addEventListener('dequeue', () => {
    for (const cb of dequeueListeners) cb();
  });

  return {
    encode(videoFrame) {
      try {
        const tsSec = videoFrame.timestamp / 1e6;
        const forceKeyFrame = lastKeyframeSec === null || tsSec - lastKeyframeSec >= KEYFRAME_INTERVAL_SEC;
        if (forceKeyFrame) lastKeyframeSec = tsSec;
        encoder.encode(videoFrame, { keyFrame: forceKeyFrame });
      } finally {
        // M3: must close even if encoder.encode() throws (e.g. the cancel race --
        // encoder.close() already ran while this frame was in flight) or the frame
        // leaks, violating the `liveFrames === 0` cancel guarantee (design §3.5).
        videoFrame.close();
      }
    },
    queueDepth() {
      return encoder.encodeQueueSize;
    },
    /** @returns {() => void} unsubscribe */
    onDequeue(cb) {
      dequeueListeners.add(cb);
      return () => dequeueListeners.delete(cb);
    },
    async flush() {
      await encoder.flush();
    },
    close() {
      encoder.close();
    },
    stats() {
      return { framesEncoded };
    },
  };
}
