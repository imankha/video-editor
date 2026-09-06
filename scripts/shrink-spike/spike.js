// T8830 shrink spike - throwaway benchmark, never imported by app code.
//
// Pipeline: streaming demux (mp4box) -> VideoDecoder -> crop+scale (OffscreenCanvas)
// -> VideoEncoder -> mux (mp4-muxer) -> Blob. Audio is skipped entirely (per task file).
//
// Must be served over http(s) - file:// does not support module scripts.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// mp4box's build has no real ESM exports (see index.html) - it's loaded as a
// classic script that sets these globals before this module runs.
const { MP4Box, DataStream } = window;

const IN_FLIGHT_CAP = 8;
const ENCODE_TARGET_WIDTH = 2688;
const ENCODE_BITRATE = 12_000_000;
const H264_CODEC = 'avc1.640033';
const REALTIME_FPS = 29.97;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB reads for the streaming File.slice demux

const fileInput = document.getElementById('file-input');
const runBtn = document.getElementById('run-btn');
const resultsEl = document.getElementById('results');
const playbackEl = document.getElementById('playback');

let selectedFile = null;

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] ?? null;
  runBtn.disabled = !selectedFile;
});

runBtn.addEventListener('click', () => {
  runBtn.disabled = true;
  run(selectedFile).finally(() => {
    runBtn.disabled = false;
  });
});

function report(lines) {
  resultsEl.textContent = lines.join('\n');
}

async function run(file) {
  const lines = [`File: ${file.name} (${(file.size / 1e9).toFixed(2)} GB)`];
  report([...lines, 'Probing container...']);

  let probe;
  try {
    probe = await probeFile(file);
  } catch (err) {
    report([...lines, `DEMUX PROBE FAILED: ${err.message}`]);
    throw err;
  }

  const { codec, codedWidth, codedHeight, description } = probe;
  lines.push(`Input codec: ${codec} (${codedWidth}x${codedHeight})`);
  report([...lines, 'Checking VideoDecoder support...']);

  const decoderSupport = await VideoDecoder.isConfigSupported({
    codec,
    codedWidth,
    codedHeight,
  });

  if (!decoderSupport.supported) {
    lines.push(`SUPPORT VERDICT: NO-GO - VideoDecoder does not support ${codec} at ${codedWidth}x${codedHeight}`);
    report(lines);
    return;
  }
  lines.push('Decode support: YES');

  const outHeight = Math.round((codedHeight / codedWidth) * ENCODE_TARGET_WIDTH / 2) * 2;
  const encoderChoice = await pickEncoder(ENCODE_TARGET_WIDTH, outHeight);
  if (!encoderChoice) {
    lines.push('SUPPORT VERDICT: NO-GO - no supported output encoder (H.264 or HEVC) at target size');
    report(lines);
    return;
  }
  lines.push(`Encode target: ${encoderChoice.codec} @ ${ENCODE_TARGET_WIDTH}x${outHeight}, ${ENCODE_BITRATE / 1e6} Mbps`);
  report(lines);

  const startTime = performance.now();
  let framesDecoded = 0;
  let framesEncoded = 0;
  let inFlight = 0;
  let resumeAppend = null;
  let firstDecodeTime = null;
  let lastEncodeTime = null;

  const canvas = new OffscreenCanvas(ENCODE_TARGET_WIDTH, outHeight);
  const ctx = canvas.getContext('2d');

  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: encoderChoice.muxerCodec,
      width: ENCODE_TARGET_WIDTH,
      height: outHeight,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
      framesEncoded += 1;
      lastEncodeTime = performance.now();
    },
    error: (err) => {
      lines.push(`ENCODER ERROR: ${err.message}`);
      report(lines);
    },
  });
  encoder.configure({
    codec: encoderChoice.codec,
    width: ENCODE_TARGET_WIDTH,
    height: outHeight,
    bitrate: ENCODE_BITRATE,
    framerate: REALTIME_FPS,
  });

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (firstDecodeTime === null) firstDecodeTime = performance.now();
      framesDecoded += 1;

      // Crop+scale: source is the full 8K frame, output is the encode target size.
      // A real shrink implementation would take a user-chosen crop rect; the spike
      // times a representative center-crop-and-scale instead.
      ctx.drawImage(
        frame,
        0, 0, frame.codedWidth, frame.codedHeight,
        0, 0, ENCODE_TARGET_WIDTH, outHeight,
      );
      frame.close();

      const videoFrame = new VideoFrame(canvas, { timestamp: frame.timestamp });
      encoder.encode(videoFrame);
      videoFrame.close();

      inFlight -= 1;
      if (inFlight <= IN_FLIGHT_CAP / 2 && resumeAppend) {
        const resume = resumeAppend;
        resumeAppend = null;
        resume();
      }
    },
    error: (err) => {
      lines.push(`DECODER ERROR: ${err.message}`);
      report(lines);
    },
  });
  decoder.configure({ codec, codedWidth, codedHeight, description });

  report([...lines, 'Decoding + encoding...']);

  await demuxAndDecode(file, decoder, {
    onBackpressureCheck: () => {
      inFlight += 1;
      const shouldPause = decoder.decodeQueueSize > IN_FLIGHT_CAP || inFlight > IN_FLIGHT_CAP;
      if (!shouldPause) return null;
      return new Promise((resolve) => {
        resumeAppend = resolve;
      });
    },
    onProgress: (decoded) => {
      report([...lines, `Decoding + encoding... ${decoded} frames`]);
    },
  });

  await decoder.flush();
  await encoder.flush();
  decoder.close();
  encoder.close();
  muxer.finalize();

  const wallSeconds = (performance.now() - startTime) / 1000;
  const decodeFps = firstDecodeTime !== null
    ? framesDecoded / ((lastEncodeTime ?? performance.now()) - startTime) * 1000
    : 0;
  const endToEndFps = framesEncoded / wallSeconds;
  const realtimeMultiplier = endToEndFps / REALTIME_FPS;

  const outputBlob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
  playbackEl.src = URL.createObjectURL(outputBlob);

  let playable = 'not verified (press play on the video element above)';
  try {
    playable = await verifyPlayback(playbackEl);
  } catch (err) {
    playable = `FAILED: ${err.message}`;
  }

  lines.push(
    '',
    `Frames decoded: ${framesDecoded}`,
    `Frames encoded: ${framesEncoded}`,
    `Wall seconds: ${wallSeconds.toFixed(2)}`,
    `Decode fps: ${decodeFps.toFixed(2)}`,
    `End-to-end fps: ${endToEndFps.toFixed(2)}`,
    `Realtime multiplier: ${realtimeMultiplier.toFixed(3)}x (source ~${REALTIME_FPS}fps)`,
    `Output size: ${(outputBlob.size / 1e6).toFixed(1)} MB`,
    `Output playability: ${playable}`,
    '',
    `VERDICT (fill into README.md): ${realtimeMultiplier >= 0.5 ? 'GO' : realtimeMultiplier >= 0.25 ? 'GO WITH CAVEATS' : 'NO-GO'} on THIS machine - see README.md for the cross-machine rule`,
  );
  report(lines);
}

// Probes the container for the first video track's codec string, coded size, and
// decoder description (avcC/hvcC), without decoding any frames.
function probeFile(file) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    let resolved = false;

    mp4boxFile.onError = (err) => {
      if (!resolved) reject(new Error(String(err)));
    };

    mp4boxFile.onReady = (info) => {
      const track = info.videoTracks[0];
      if (!track) {
        reject(new Error('No video track found'));
        return;
      }

      const trak = mp4boxFile.getTrackById(track.id);
      const description = getCodecDescription(trak);

      resolved = true;
      resolve({
        codec: track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description,
      });
    };

    // Only the moov box is needed for the probe; stop feeding data once onReady
    // has fired instead of streaming the whole multi-GB file.
    readProbeChunks(file, mp4boxFile, () => resolved).catch((err) => {
      if (!resolved) reject(err);
    });
  });
}

async function readProbeChunks(file, mp4boxFile, isDone) {
  let offset = 0;
  while (offset < file.size && !isDone()) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    buffer.fileStart = offset;
    mp4boxFile.appendBuffer(buffer);
    offset += CHUNK_SIZE;
  }
}

// Extracts the avcC/hvcC decoder-config box, stripped of its box header, as required
// by VideoDecoder's `description` field. Pattern matches the WebCodecs samples repo.
function getCodecDescription(trak) {
  const entry = trak.mdia.minf.stbl.stsd.entries[0];
  const box = entry.avcC ?? entry.hvcC;
  if (!box) return undefined;

  const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
  box.write(stream);
  return new Uint8Array(stream.buffer, 8); // skip the box header (size + fourcc)
}

// Streams the file into mp4box in CHUNK_SIZE pieces, decoding each returned sample
// as it becomes available. Applies backpressure via onBackpressureCheck before each
// decoder.decode() call.
//
// mp4box calls onSamples synchronously as it parses each box - it does NOT await
// the callback, so multiple onSamples calls can fire back-to-back before an async
// handler for the first one finishes. Making onSamples itself `async` (an earlier
// version of this function did) creates two independent in-flight loops that each
// think they own the single backpressure "resume" slot, and the loser's promise
// never gets resolved - a permanent stall. Fix: onSamples only pushes into a plain
// array; a single consumer loop drains it one sample at a time, so there is only
// ever one place awaiting backpressure.
function demuxAndDecode(file, decoder, { onBackpressureCheck, onProgress }) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = MP4Box.createFile();
    let videoTrackId = null;
    let decodedCount = 0;
    let readingDone = false;
    const queue = [];
    let notifyQueue = null;

    const wake = () => {
      if (notifyQueue) {
        const notify = notifyQueue;
        notifyQueue = null;
        notify();
      }
    };

    mp4boxFile.onError = (err) => reject(new Error(String(err)));

    mp4boxFile.onReady = (info) => {
      const track = info.videoTracks[0];
      videoTrackId = track.id;
      mp4boxFile.setExtractionOptions(videoTrackId, null, { nbSamples: 100 });
      mp4boxFile.start();
    };

    mp4boxFile.onSamples = (trackId, user, samples) => {
      if (trackId !== videoTrackId) return;
      queue.push(...samples);
      wake();
    };

    readChunksInto(file, mp4boxFile).then(() => {
      readingDone = true;
      wake();
    }, reject);

    (async () => {
      while (true) {
        if (queue.length === 0) {
          if (readingDone) break;
          await new Promise((resolveWake) => {
            notifyQueue = resolveWake;
          });
          continue;
        }

        const sample = queue.shift();
        const wait = onBackpressureCheck();
        if (wait) await wait;

        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts * 1e6) / sample.timescale,
          duration: (sample.duration * 1e6) / sample.timescale,
          data: sample.data,
        });
        decoder.decode(chunk);
        decodedCount += 1;
        onProgress(decodedCount);
      }
      resolve();
    })().catch(reject);
  });
}

// Shared streaming reader: File.slice through mp4box's appendBuffer, in CHUNK_SIZE
// pieces, so the whole 3.3 GB file is never held in memory at once.
async function readChunksInto(file, mp4boxFile) {
  let offset = 0;
  while (offset < file.size) {
    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    buffer.fileStart = offset;
    mp4boxFile.appendBuffer(buffer);
    offset += CHUNK_SIZE;
  }
  mp4boxFile.flush();
}

// Tries H.264 first (per task file), then HEVC if isConfigSupported says yes.
async function pickEncoder(width, height) {
  const h264Support = await VideoEncoder.isConfigSupported({
    codec: H264_CODEC,
    width,
    height,
    bitrate: ENCODE_BITRATE,
    framerate: REALTIME_FPS,
  });
  if (h264Support.supported) {
    return { codec: H264_CODEC, muxerCodec: 'avc' };
  }

  const hevcCodec = 'hev1.1.6.L120.90';
  const hevcSupport = await VideoEncoder.isConfigSupported({
    codec: hevcCodec,
    width,
    height,
    bitrate: ENCODE_BITRATE,
    framerate: REALTIME_FPS,
  });
  if (hevcSupport.supported) {
    return { codec: hevcCodec, muxerCodec: 'hevc' };
  }

  return null;
}

// Proves mux correctness (not just speed): plays 5 seconds of the output Blob.
function verifyPlayback(videoEl) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('playback timed out')), 10_000);

    videoEl.addEventListener('loadedmetadata', async () => {
      try {
        await videoEl.play();
        setTimeout(() => {
          videoEl.pause();
          clearTimeout(timeout);
          resolve(videoEl.currentTime > 0 ? 'OK (played back)' : 'FAILED (currentTime did not advance)');
        }, 5000);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    }, { once: true });

    videoEl.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('video element error - output likely not playable'));
    }, { once: true });
  });
}
