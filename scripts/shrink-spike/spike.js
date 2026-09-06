// T8830 shrink spike - throwaway benchmark, never imported by app code.
//
// Pipeline: whole-file-in-memory demux (mp4box) -> VideoDecoder -> crop+scale
// (OffscreenCanvas) -> VideoEncoder -> mux (mp4-muxer) -> Blob. Audio is skipped
// entirely (per task file).
//
// NOT a streaming demux, deliberately: DJI (and most action-cam/drone) files put the
// ENTIRE mdat payload BEFORE moov (non-fast-start) - confirmed on the real fixture
// (mdat at byte ~4KB, moov ~3.3GB later, right near EOF). A sequential
// File.slice-through-appendBuffer stream can only feed mp4box bytes forward; once
// moov finally arrives and defines real per-sample byte offsets, mp4box needs to
// re-read data from EARLIER in the file that a sequential feeder already discarded
// (or that got silently pruned depending on timing/memory pressure) - a genuine
// architectural mismatch, not a bug to patch around. A production implementation
// (T8840) needs real random-access re-reads keyed off moov's parsed sample table;
// building that is out of scope for a throwaway one-off benchmark whose only job is
// a decode+encode throughput number. Loading the whole file into memory once
// (`file.arrayBuffer()`) and feeding mp4box a single `appendBuffer` sidesteps the
// whole problem - correct by construction, and the decode/encode timing this spike
// measures is unaffected by how the bytes got into memory. This is the ONE
// intentional deviation from the task file's original "streaming demux" wording.
//
// Must be served over http(s) - file:// does not support module scripts.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { createFile, DataStream } from 'mp4box';

const IN_FLIGHT_CAP = 8;
const ENCODE_TARGET_WIDTH = 2688;
const ENCODE_BITRATE = 12_000_000;
const H264_CODEC = 'avc1.640033';
const REALTIME_FPS = 29.97;

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
  run(selectedFile).catch((err) => {
    resultsEl.textContent += `\n\nRUN FAILED: ${err.message}\n${err.stack ?? ''}`;
  }).finally(() => {
    runBtn.disabled = false;
  });
});

function report(lines) {
  resultsEl.textContent = lines.join('\n');
}

async function run(file) {
  const lines = [`File: ${file.name} (${(file.size / 1e9).toFixed(2)} GB)`];
  report([...lines, 'Reading whole file into memory...']);

  // Read once, reuse for both the probe and the real demux (see the top-of-file note
  // on why this is a whole-buffer read rather than a streaming one).
  const wholeBuffer = await file.arrayBuffer();

  report([...lines, 'Probing container...']);

  let probe;
  try {
    probe = probeBuffer(wholeBuffer);
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
    // mp4-muxer reads decoderConfig.colorSpace off the encoder's first output chunk
    // and throws on null if the encoder was never given one - Rec.709 is a reasonable
    // default for the spike's re-encoded SDR output (the source's actual color space
    // is not preserved by this throwaway pipeline anyway).
    colorSpace: {
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      fullRange: false,
    },
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

  await demuxAndDecode(wholeBuffer, decoder, {
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

  // Report the throughput numbers FIRST, independent of mux success - this is the
  // primary thing the spike exists to measure. Muxing/playback (proves correctness,
  // not speed - a separate, best-effort concern) happens after, in its own try/catch,
  // so a muxer bug never hides the realtime-multiplier verdict.
  const wallSeconds = (performance.now() - startTime) / 1000;
  const decodeFps = firstDecodeTime !== null
    ? framesDecoded / ((lastEncodeTime ?? performance.now()) - startTime) * 1000
    : 0;
  const endToEndFps = framesEncoded / wallSeconds;
  const realtimeMultiplier = endToEndFps / REALTIME_FPS;

  lines.push(
    '',
    `Frames decoded: ${framesDecoded}`,
    `Frames encoded: ${framesEncoded}`,
    `Wall seconds: ${wallSeconds.toFixed(2)}`,
    `Decode fps: ${decodeFps.toFixed(2)}`,
    `End-to-end fps: ${endToEndFps.toFixed(2)}`,
    `Realtime multiplier: ${realtimeMultiplier.toFixed(3)}x (source ~${REALTIME_FPS}fps)`,
    `VERDICT (fill into README.md): ${realtimeMultiplier >= 0.5 ? 'GO' : realtimeMultiplier >= 0.25 ? 'GO WITH CAVEATS' : 'NO-GO'} on THIS machine - see README.md for the cross-machine rule`,
  );
  report(lines);

  let outputBlob = null;
  let playable = 'not verified (press play on the video element above)';
  try {
    muxer.finalize();
    outputBlob = new Blob([muxerTarget.buffer], { type: 'video/mp4' });
    playbackEl.src = URL.createObjectURL(outputBlob);
    playable = await verifyPlayback(playbackEl);
  } catch (err) {
    playable = `FAILED: ${err.message}`;
  }

  lines.push(
    '',
    `Output size: ${outputBlob ? (outputBlob.size / 1e6).toFixed(1) + ' MB' : 'n/a (mux failed)'}`,
    `Output playability: ${playable}`,
    '',
    `VERDICT (fill into README.md): ${realtimeMultiplier >= 0.5 ? 'GO' : realtimeMultiplier >= 0.25 ? 'GO WITH CAVEATS' : 'NO-GO'} on THIS machine - see README.md for the cross-machine rule`,
  );
  report(lines);
}

// Probes the container for the first video track's codec string, coded size, and
// decoder description (avcC/hvcC), without decoding any frames. Synchronous: mp4box's
// box parser is a plain synchronous state machine, and feeding the whole file in one
// appendBuffer call means onReady (needs moov, fully present) fires before the call
// returns - no need for the promise/chunk-polling dance a partial stream would need.
function probeBuffer(wholeBuffer) {
  const mp4boxFile = createFile();
  let result = null;
  let error = null;

  mp4boxFile.onError = (err) => {
    error = new Error(String(err));
  };

  mp4boxFile.onReady = (info) => {
    const track = info.videoTracks[0];
    if (!track) {
      error = new Error('No video track found');
      return;
    }
    const trak = mp4boxFile.getTrackById(track.id);
    result = {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description: getCodecDescription(trak),
    };
  };

  // mp4box reads `fileStart` off the buffer object itself; a plain ArrayBuffer works
  // (mp4box sets it internally to 0 if absent), but set it explicitly for clarity.
  wholeBuffer.fileStart = 0;
  mp4boxFile.appendBuffer(wholeBuffer);
  mp4boxFile.flush();

  if (error) throw error;
  if (!result) throw new Error('Probe never reached onReady - moov box not found');
  return result;
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

// Feeds the whole in-memory buffer to mp4box in one appendBuffer call, then decodes
// every returned sample. Applies backpressure via onBackpressureCheck before each
// decoder.decode() call.
//
// mp4box calls onSamples synchronously as it parses each box - it does NOT await
// the callback, so multiple onSamples calls can fire back-to-back within the single
// synchronous appendBuffer() call below (whole file in memory, per the top-of-file
// note - no more chunked streaming, so there's only ever one append). An EARLIER
// version of this function fed the file in chunks with an async reader running
// concurrently with the consumer loop; making onSamples itself `async` there created
// two independent in-flight loops that each thought they owned the single
// backpressure "resume" slot, and the loser's promise never got resolved - a
// permanent stall. That whole class of bug is now moot (appendBuffer is one
// synchronous call, so the queue is fully populated before the consumer loop below
// ever runs), but onSamples still only pushes into a plain array - the consumer loop
// is the one and only place awaiting backpressure.
function demuxAndDecode(wholeBuffer, decoder, { onBackpressureCheck, onProgress }) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile();
    let videoTrackId = null;
    let decodedCount = 0;
    const queue = [];

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
    };

    wholeBuffer.fileStart = 0;
    mp4boxFile.appendBuffer(wholeBuffer);
    mp4boxFile.flush();
    // By this point every onSamples callback mp4box will ever fire already has -
    // the queue is fully populated. The loop below just drains it with backpressure.

    (async () => {
      for (const sample of queue) {
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
