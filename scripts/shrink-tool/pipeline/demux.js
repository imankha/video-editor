/**
 * T8840 pipeline/demux.js -- faststart-ordered forward streaming demux (design §2.2).
 *
 * Proven approach (scripts/shrink-spike/README.md "Verdict for T8840"): reuse T1380's
 * `mp4Faststart.js` to get a logical faststart-ordered (`ftyp | patched-moov | mdat`)
 * view of any MP4 layout, then feed mp4box fixed-size forward chunks of that view.
 * ONE demux loop (design §1.3 smell 2 -- no separate single-shot/streaming paths).
 * Backpressure lives entirely in the caller's `onVideoSample` (awaited); this module
 * never gates on its own.
 */

// Relative path, not a bare "mp4box" specifier + import map: this module is loaded
// both by the main document (tool.js/segmentList.js) and by worker.js, and import
// maps are not reliably inherited by module Workers across browsers. A real
// relative path resolves identically in both contexts.
// T8845: the app's bundler (Vite) resolves bare specifiers fine, so this and the
// mp4Faststart import below are the two edits the port needs.
import { createFile, DataStream } from '../node_modules/mp4box/dist/mp4box.all.mjs';
import { analyzeMp4Faststart, getReorderedSlice } from '../../../src/frontend/src/utils/mp4Faststart.js';

const DEFAULT_CHUNK_SIZE_MB = 32;
const EXTRACTION_NB_SAMPLES = 100; // T8832-proven batch size
const RELEASE_EVERY = 100; // T8832-proven release cadence

/**
 * Opens a faststart-ordered logical view over any MP4 layout (T8832 caveat 1).
 * @param {File} file
 * @returns {Promise<{ logicalSize: number, slice: (start: number, end: number) => Blob, layout: 'relocated'|'verbatim', info: object }>}
 */
export async function openReader(file) {
  const info = await analyzeMp4Faststart(file);
  if (info.needsRelocation) {
    return {
      logicalSize: info.newSize,
      slice: (start, end) => getReorderedSlice(file, info, start, end),
      layout: 'relocated',
      info,
    };
  }
  return {
    logicalSize: file.size,
    slice: (start, end) => file.slice(start, end),
    layout: 'verbatim',
    info,
  };
}

/** Extracts the avcC/hvcC decoder-config box payload (T8830's getCodecDescription). */
function getVideoDescription(trak) {
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC ?? entry.hvcC;
  if (!box) return undefined;
  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 8); // skip the box header (size + fourcc)
}

// MPEG-4 descriptor tags (ISO/IEC 14496-1) -- tag-based lookup via mp4box's own
// `Descriptor.findDescriptor`, robust to nesting depth changes across mp4box versions.
const DECODER_CONFIG_DESCR_TAG = 0x04;
const DECODER_SPECIFIC_INFO_TAG = 0x05;

/** Extracts the raw AudioSpecificConfig from an `esds` box, for mp4-muxer's audio decoderConfig.description. */
function getAudioDescription(trak) {
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const esd = entry.esds?.esd;
  if (!esd) return null;
  const configDescr = esd.findDescriptor(DECODER_CONFIG_DESCR_TAG);
  const specificInfo = configDescr?.findDescriptor(DECODER_SPECIFIC_INFO_TAG);
  return specificInfo?.data ? new Uint8Array(specificInfo.data) : null;
}

/**
 * Streams the first chunks until moov is parsed. Never reads mdat.
 * @param {{ logicalSize: number, slice: Function }} reader
 * @param {{ chunkSizeMB?: number }} [options]
 */
export function probeContainer(reader, { chunkSizeMB = DEFAULT_CHUNK_SIZE_MB } = {}) {
  const chunkSize = chunkSizeMB * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile();
    let settled = false;

    mp4boxFile.onError = (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(String(err)));
    };
    mp4boxFile.onReady = (info) => {
      if (settled) return;
      settled = true;

      const videoTrackInfo = info.videoTracks[0];
      if (!videoTrackInfo) {
        reject(new Error('demux.probeContainer: no video track in moov'));
        return;
      }
      const videoTrak = mp4boxFile.getTrackById(videoTrackInfo.id);
      const movieTimescale = info.timescale;
      const containerDurationSec = info.duration / movieTimescale;

      // mp4box's per-track `duration` is in the TRACK's own timescale (mdhd), not
      // the movie's (mvhd) -- dividing by movieTimescale here silently produced a
      // wildly wrong fps (caught by qa/t8840-smoke.mjs: 90s@30fps read back as ~1382s).
      const videoDurationSec = videoTrackInfo.duration / videoTrackInfo.timescale;
      const video = {
        trackId: videoTrackInfo.id,
        codec: videoTrackInfo.codec,
        codedWidth: videoTrackInfo.video.width,
        codedHeight: videoTrackInfo.video.height,
        description: getVideoDescription(videoTrak),
        nbSamples: videoTrackInfo.nb_samples,
        timescale: videoTrackInfo.timescale,
        durationSec: videoDurationSec,
        fps: videoTrackInfo.nb_samples / videoDurationSec,
      };

      const audioTrackInfo = info.audioTracks[0] ?? null;
      let audio = null;
      if (audioTrackInfo) {
        const audioTrak = mp4boxFile.getTrackById(audioTrackInfo.id);
        audio = {
          trackId: audioTrackInfo.id,
          codec: audioTrackInfo.codec,
          sampleRate: audioTrackInfo.audio.sample_rate,
          numberOfChannels: audioTrackInfo.audio.channel_count,
          nbSamples: audioTrackInfo.nb_samples,
          timescale: audioTrackInfo.timescale,
          description: getAudioDescription(audioTrak),
        };
      }

      // Anything that isn't the chosen video/audio track is dropped from the mux
      // (caveat 8: DJI djmd/dbgi/tmcd). Reported so the tool can display it.
      const keptIds = new Set([video.trackId, audio?.trackId].filter((id) => id != null));
      const droppedTracks = info.tracks
        .filter((t) => !keptIds.has(t.id))
        .map((t) => ({ id: t.id, type: t.type }));

      resolve({
        video,
        audio,
        createdAt: info.created ?? null,
        durationSec: containerDurationSec,
        droppedTracks,
      });
    };

    (async () => {
      for (let off = 0; off < reader.logicalSize && !settled; off += chunkSize) {
        const end = Math.min(off + chunkSize, reader.logicalSize);
        const buf = await reader.slice(off, end).arrayBuffer();
        buf.fileStart = off;
        mp4boxFile.appendBuffer(buf);
      }
      if (!settled) {
        mp4boxFile.flush();
        if (!settled) {
          settled = true;
          reject(new Error('demux.probeContainer: moov not found in stream'));
        }
      }
    })().catch((e) => {
      if (!settled) {
        settled = true;
        reject(e);
      }
    });
  });
}

/**
 * The single forward demux loop. Extracts video AND audio; releases BOTH (design
 * §2.2 -- R2: an extracted-but-never-released audio track re-opens T8832's mp4box
 * buffer leak).
 *
 * @param {{ logicalSize: number, slice: Function }} reader
 * @param {{ video: object, audio: object|null }} tracks - from probeContainer()
 * @param {{ chunkSizeMB?: number, onVideoSample: Function, onAudioSample?: Function, signal?: AbortSignal,
 *   pauseGate?: { wait(): Promise<void> } }} options
 */
export async function streamSamples(reader, tracks, {
  chunkSizeMB = DEFAULT_CHUNK_SIZE_MB,
  onVideoSample,
  onAudioSample = () => {},
  signal,
  pauseGate,
} = {}) {
  const chunkSize = chunkSizeMB * 1024 * 1024;
  const { video, audio } = tracks;

  const mp4boxFile = createFile();
  const videoQueue = [];
  const audioQueue = [];
  let samplesRead = 0;
  let releaseCalls = 0;
  let maxMp4boxBuffers = 0;
  let lastReleasedVideo = -1;
  let lastReleasedAudio = -1;

  mp4boxFile.onSamples = (trackId, user, samples) => {
    if (trackId === video.trackId) videoQueue.push(...samples);
    else if (audio && trackId === audio.trackId) audioQueue.push(...samples);
  };

  let mp4boxError = null;
  mp4boxFile.onError = (err) => {
    mp4boxError = new Error(String(err));
  };

  // mp4box only honors setExtractionOptions/start() once THIS instance's own moov
  // has parsed -- calling them eagerly (before onReady) registers no extraction at
  // all and onSamples silently never fires (caught by qa/t8840-smoke.mjs: 0 of 2700
  // samples). onReady fires synchronously during the appendBuffer call that
  // completes the moov, which -- in the faststart-ordered view -- is always the
  // first chunk (moov sits right after ftyp).
  mp4boxFile.onReady = () => {
    mp4boxFile.setExtractionOptions(video.trackId, null, { nbSamples: EXTRACTION_NB_SAMPLES });
    if (audio) mp4boxFile.setExtractionOptions(audio.trackId, null, { nbSamples: EXTRACTION_NB_SAMPLES });
    mp4boxFile.start();
  };

  function bufferCount() {
    return mp4boxFile.stream?.buffers?.length ?? 0;
  }

  function maybeRelease(trackId, sampleNumber, lastReleased) {
    if (sampleNumber - lastReleased >= RELEASE_EVERY) {
      mp4boxFile.releaseUsedSamples(trackId, sampleNumber);
      releaseCalls += 1;
      return sampleNumber;
    }
    return lastReleased;
  }

  // Fully serialized: feed -> drain -> feed, one async loop (design §1.3 smell 2).
  // Audio samples are forwarded synchronously and never awaited (no queue of our
  // own -- design §2.2 mux "audio lead is bounded structurally"); video samples are
  // awaited one at a time, which IS the backpressure (design §2.2 decode).
  async function drain() {
    while (videoQueue.length || audioQueue.length) {
      if (mp4boxError) throw mp4boxError;
      if (signal?.aborted) return;

      while (audioQueue.length) {
        const sample = audioQueue.shift();
        onAudioSample(sample);
        lastReleasedAudio = maybeRelease(audio.trackId, sample.number, lastReleasedAudio);
      }
      if (videoQueue.length) {
        const sample = videoQueue.shift();
        await onVideoSample(sample);
        samplesRead += 1;
        lastReleasedVideo = maybeRelease(video.trackId, sample.number, lastReleasedVideo);
      }
    }
  }

  for (let off = 0; off < reader.logicalSize; off += chunkSize) {
    if (signal?.aborted) break;
    await pauseGate?.wait(); // Pause (design Q7): parks between chunks, never mid-chunk
    if (signal?.aborted) break;
    const end = Math.min(off + chunkSize, reader.logicalSize);
    const buf = await reader.slice(off, end).arrayBuffer();
    buf.fileStart = off;
    mp4boxFile.appendBuffer(buf);
    if (mp4boxError) throw mp4boxError;
    maxMp4boxBuffers = Math.max(maxMp4boxBuffers, bufferCount());
    await drain();
  }

  if (!signal?.aborted) {
    mp4boxFile.flush();
    if (mp4boxError) throw mp4boxError;
    await drain();
  }

  return {
    samplesRead,
    releaseCalls,
    maxMp4boxBuffers,
    finalMp4boxBuffers: bufferCount(),
  };
}
