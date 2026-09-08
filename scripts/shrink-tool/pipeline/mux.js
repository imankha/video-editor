/**
 * T8840 pipeline/mux.js -- design §2.2. Streaming OPFS target (caveat 7): NEVER
 * ArrayBufferTarget, NEVER `fastStart:'in-memory'`.
 *
 * Adaptation note vs. the design's abbreviated signature: `createMuxer` also takes
 * `writable` (in addition to `target`), because `finalize()`/`abort()` must close or
 * abort the underlying `FileSystemWritableFileStream` and mp4-muxer's
 * `FileSystemWritableFileStreamTarget` does not expose the stream it wraps back out.
 * `createOpfsSink` already returns both, so this is a one-line concretization of the
 * pseudocode, not a behavior change.
 */

// Relative path, not a bare "mp4-muxer" specifier: see demux.js's mp4box import
// for why (this module is loaded by worker.js, and import maps are not reliably
// inherited by module Workers across browsers).
import { Muxer, FileSystemWritableFileStreamTarget } from '../node_modules/mp4-muxer/build/mp4-muxer.mjs';

/**
 * Streaming OPFS target (caveat 7). NEVER ArrayBufferTarget, NEVER fastStart:'in-memory'.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 */
export async function createOpfsSink(dirHandle, filename) {
  const handle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  const target = new FileSystemWritableFileStreamTarget(writable);
  return { handle, writable, target };
}

/** Maps a real RFC 6381 / mp4box codec string to mp4-muxer's small audio enum. */
function deriveMuxerAudioCodec(codec) {
  const c = String(codec || '').toLowerCase();
  if (c.startsWith('mp4a')) return 'aac';
  if (c.startsWith('opus') || c === '.opus') return 'opus';
  throw new Error(`mux.createMuxer: unsupported audio codec for copy-through: ${codec}`);
}

/**
 * @param {{ target: FileSystemWritableFileStreamTarget, writable: FileSystemWritableFileStream,
 *   video: { codec: 'avc'|'hevc', width: number, height: number },
 *   audio: { codec: string, sampleRate: number, numberOfChannels: number, description: Uint8Array|null }|null }} options
 */
export function createMuxer({ target, writable, video, audio }) {
  const muxerAudioCodec = audio ? deriveMuxerAudioCodec(audio.codec) : null;

  const muxer = new Muxer({
    target,
    video: { codec: video.codec, width: video.width, height: video.height },
    audio: audio ? { codec: muxerAudioCodec, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } : undefined,
    // moov-at-end is fine and deliberate: the upload path relocates moov via T1380
    // in 6-15 ms anyway (T8834), so the shrunk file still lands fast-start on R2.
    fastStart: false,
    // B3 fix: the default 'strict' mode throws unless EACH track's first chunk
    // lands exactly on timestamp 0 -- with a single shared origin, only the
    // earlier track hits 0 and the other throws
    // ("The first chunk for your media track must have a timestamp of 0").
    // 'cross-track-offset' is mp4-muxer's own implementation of exactly this
    // design's shared-t0 scheme: it computes min(firstVideoTs, firstAudioTs)
    // internally and subtracts it from BOTH tracks. This is NOT 'offset', which
    // rebases each track independently and would desync A/V. Raw (un-adjusted)
    // timestamps are passed in below; the muxer does the subtraction.
    firstTimestampBehavior: 'cross-track-offset',
  });

  let audioDescriptionSent = false;

  return {
    addVideoChunk(chunk, meta) {
      muxer.addVideoChunk(chunk, meta);
    },
    /** Raw copy-through, no AudioEncoder (design §2.2 mux / task file R4). */
    addAudioSample(sample) {
      if (!audio) throw new Error('mux.addAudioSample: muxer was created without an audio track');
      const timestamp = (sample.cts / sample.timescale) * 1e6;
      const duration = (sample.duration / sample.timescale) * 1e6;
      const type = sample.is_sync ? 'key' : 'delta';
      const meta = !audioDescriptionSent
        ? { decoderConfig: { codec: muxerAudioCodec, description: audio.description, sampleRate: audio.sampleRate, numberOfChannels: audio.numberOfChannels } }
        : undefined;
      audioDescriptionSent = true;
      muxer.addAudioChunkRaw(sample.data, type, timestamp, duration, meta);
    },
    /** muxer.finalize() then writable.close() -- never called after abort(). */
    async finalize() {
      muxer.finalize();
      await writable.close();
    },
    /** writable.abort() -- NOT finalize; the .part file is left invalid on purpose. */
    async abort() {
      await writable.abort();
    },
  };
}
