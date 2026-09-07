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
 *   audio: { codec: string, sampleRate: number, numberOfChannels: number, description: Uint8Array|null }|null,
 *   timestampOriginUs: number }} options
 */
export function createMuxer({ target, writable, video, audio, timestampOriginUs }) {
  const muxerAudioCodec = audio ? deriveMuxerAudioCodec(audio.codec) : null;

  const muxer = new Muxer({
    target,
    video: { codec: video.codec, width: video.width, height: video.height },
    audio: audio ? { codec: muxerAudioCodec, numberOfChannels: audio.numberOfChannels, sampleRate: audio.sampleRate } : undefined,
    // moov-at-end is fine and deliberate: the upload path relocates moov via T1380
    // in 6-15 ms anyway (T8834), so the shrunk file still lands fast-start on R2.
    fastStart: false,
    // Deliberately NOT 'offset': it rebases each track independently and would
    // desync A/V (design §2.2 mux). ONE shared t0 is subtracted below instead, so
    // the muxer can run in its default 'strict' mode.
  });

  let audioDescriptionSent = false;

  return {
    addVideoChunk(chunk, meta) {
      muxer.addVideoChunk(chunk, meta, chunk.timestamp - timestampOriginUs);
    },
    /** Raw copy-through, no AudioEncoder (design §2.2 mux / task file R4). */
    addAudioSample(sample) {
      if (!audio) throw new Error('mux.addAudioSample: muxer was created without an audio track');
      const timestamp = (sample.cts / sample.timescale) * 1e6 - timestampOriginUs;
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
