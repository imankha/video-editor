// T8830 / T8832 shrink spike - throwaway benchmark, never imported by app code.
//
// Pipeline: demux (mp4box) -> VideoDecoder -> crop+scale (OffscreenCanvas) ->
// VideoEncoder -> mux (mp4-muxer) -> Blob. Audio is skipped entirely (per task file).
//
// TWO demux modes share the same decode/crop/encode/mux tail:
//
//   * single-shot (T8830): read the whole file with `file.arrayBuffer()` and feed
//     mp4box one `appendBuffer`. Correct by construction (order-independent), but
//     `file.arrayBuffer()` fails in Chrome on the real 3.3 GB DJI file
//     (NotReadableError) - so this mode is capped at files small enough to fit one
//     Blob read. Kept as the reference/oracle for frame counts.
//
//   * streaming (T8832): feed mp4box fixed-size chunks taken from a FASTSTART-ORDERED
//     view of the file, so moov arrives first and every sample streams forward -
//     ordinary sequential demux, no random access, no rewrite. Real DJI files are
//     non-fast-start (mdat before moov), so we lean on T1380's `mp4Faststart.js`
//     (`analyzeMp4Faststart` + `getReorderedSlice`) to present a logical
//     `ftyp | patched-moov | mdat` layout without materializing a new file. This is
//     the demux T8840 is meant to adopt; this spike exists to prove it holds memory
//     flat over a long run.
//
// Must be served over http(s) - file:// does not support module scripts.

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { createFile, DataStream } from 'mp4box';
// mp4Faststart.js is a plain-ESM app util with no imports; the spike importing an app
// util is fine (the banned direction is app code importing the spike). Served from repo
// root so this relative path resolves - see README "How to run".
import { analyzeMp4Faststart, getReorderedSlice } from '../../src/frontend/src/utils/mp4Faststart.js';

// 32, not 8: Chromium's hardware H.264 decoder holds a number of inputs in its own
// pipeline before emitting the first output. With the cap at 8 the Legends 1080p
// control clip decoded exactly 8 frames and then stalled forever (no error event,
// no output, inFlight never decremented) - the cap was below the decoder's pipeline
// depth. The DJI HEVC path has a shallower pipeline and never hit it. A production
// implementation (T8840) should drive backpressure off `decoder.decodeQueueSize` /
// the `dequeue` event with a generous cap, never a small hand-rolled in-flight count.
const IN_FLIGHT_CAP = 32;
const ENCODE_TARGET_WIDTH = 2688;
const ENCODE_BITRATE = 12_000_000;
const H264_CODEC = 'avc1.640033';
const REALTIME_FPS = 29.97;

// mp4box extraction batch size. Small so mp4box hands us samples in small groups and
// we can release them promptly; matches T8830's single-shot value.
const EXTRACTION_NB_SAMPLES = 100;
// Release consumed samples back to mp4box every this many decoded samples, so its
// internal buffer list (mp4boxFile.stream.buffers) does not grow across the run.
const RELEASE_EVERY = 100;
// Per-bucket throughput reporting window (wall clock).
const BUCKET_MS = 30_000;
// Memory sampling interval.
const MEM_SAMPLE_MS = 5_000;

const fileInput = document.getElementById('file-input');
const runBtn = document.getElementById('run-btn');
const resultsEl = document.getElementById('results');
const playbackEl = document.getElementById('playback');
const modeEl = document.getElementById('mode');
const chunkSizeEl = document.getElementById('chunk-size');
const decodeOnlyEl = document.getElementById('decode-only');

let selectedFile = null;

fileInput.addEventListener('change', () => {
  selectedFile = fileInput.files[0] ?? null;
  runBtn.disabled = !selectedFile;
});

runBtn.addEventListener('click', () => {
  runBtn.disabled = true;
  const options = {
    mode: modeEl.value, // 'single-shot' | 'streaming'
    chunkSizeMB: Math.max(1, Number(chunkSizeEl.value) || 8),
    decodeOnly: decodeOnlyEl.checked,
  };
  run(selectedFile, options).catch((err) => {
    resultsEl.textContent += `\n\nRUN FAILED: ${err.message}\n${err.stack ?? ''}`;
  }).finally(() => {
    runBtn.disabled = false;
  });
});

function report(lines) {
  resultsEl.textContent = lines.join('\n');
}

async function run(file, options) {
  const { mode, chunkSizeMB, decodeOnly } = options;
  const chunkSize = chunkSizeMB * 1024 * 1024;
  const lines = [
    `File: ${file.name} (${(file.size / 1e9).toFixed(2)} GB)`,
    `Mode: ${mode}` + (mode === 'streaming' ? ` | chunk ${chunkSizeMB} MB` : '') +
      ` | ${decodeOnly ? 'decode-only' : 'decode+encode'}`,
  ];
  report(lines);

  // --- Probe: get codec/size/description + expected sample count. -----------------
  let probe;
  let wholeBuffer = null;   // single-shot only
  let reader = null;        // streaming only

  if (mode === 'single-shot') {
    report([...lines, 'Reading whole file into memory...']);
    wholeBuffer = await file.arrayBuffer();
    report([...lines, 'Probing container...']);
    probe = probeBuffer(wholeBuffer);
  } else {
    report([...lines, 'Analyzing faststart layout...']);
    const info = await analyzeMp4Faststart(file);
    reader = makeReader(file, info);
    if (info.needsRelocation) {
      lines.push(
        `Faststart: RELOCATING moov (non-fast-start source). ` +
        `logicalSize=${(info.newSize / 1e6).toFixed(1)} MB, moov=${(info.moovSize / 1024).toFixed(0)} KB, ` +
        `mdatRegion=${(info.mdatSize / 1e6).toFixed(1)} MB`,
      );
    } else {
      lines.push(
        `Faststart: already fast-start (moov@${info.moovOffset} before mdat@${info.mdatOffset}) ` +
        `- streaming original file bytes verbatim, logicalSize=${(reader.logicalSize / 1e6).toFixed(1)} MB`,
      );
    }
    report([...lines, 'Probing container (streaming first chunks until moov)...']);
    probe = await probeReader(reader, chunkSize);
  }

  const { codec, codedWidth, codedHeight, nbSamples } = probe;
  lines.push(`Input codec: ${codec} (${codedWidth}x${codedHeight})` +
    (nbSamples != null ? `, moov reports ${nbSamples} samples` : ''));
  report(lines);

  // --- Build the shared decode/(crop+encode)/mux pipeline. ------------------------
  const pipeline = await buildPipeline(probe, { decodeOnly, lines, report });
  if (!pipeline.ok) {
    lines.push(`SUPPORT VERDICT: NO-GO - ${pipeline.reason}`);
    report(lines);
    return;
  }
  report(lines);

  pipeline.startMemorySampling();
  report([...lines, decodeOnly ? 'Decoding...' : 'Decoding + encoding...']);

  // --- Drive the chosen demux; both funnel samples into the same decoder. ---------
  let demuxStats = {};
  if (mode === 'single-shot') {
    await demuxSingleShot(wholeBuffer, pipeline.decoder, {
      beforeDecode: pipeline.beforeDecode,
      onProgress: (n) => report([...lines, `${decodeOnly ? 'Decoding' : 'Decoding + encoding'}... ${n} frames`]),
    });
  } else {
    demuxStats = await demuxStreaming(reader, chunkSize, pipeline.decoder, {
      beforeDecode: pipeline.beforeDecode,
      onProgress: (n) => report([...lines, `${decodeOnly ? 'Decoding' : 'Decoding + encoding'}... ${n} frames`]),
    });
  }

  await pipeline.finalize({ lines, report, mode, chunkSizeMB, decodeOnly, nbSamples, demuxStats });
}

// ================================================================================
// Unified read interface over the two possible faststart layouts.
// ================================================================================

// Returns { logicalSize, slice(start, end) -> Blob } that presents a single logical
// byte stream in faststart order (moov before mdat) regardless of the source layout.
//
// - needsRelocation: true  -> the source has mdat before moov. Use T1380's zero-copy
//   reordered view (ftyp | patched-moov | mdat); logical size is info.newSize.
// - needsRelocation: false -> the source is ALREADY in the right order (or too small /
//   not relocatable). Stream the ORIGINAL file bytes verbatim, fileStart = true offset.
//   This preserves every stco/co64 offset exactly (they are absolute and unchanged),
//   which recomposing [ftyp|moov] + [mdat] would NOT if any box sits between moov and
//   mdat - so verbatim is both simpler and strictly more correct here.
function makeReader(file, info) {
  if (info.needsRelocation) {
    return {
      logicalSize: info.newSize,
      slice: (start, end) => getReorderedSlice(file, info, start, end),
    };
  }
  return {
    logicalSize: file.size,
    slice: (start, end) => file.slice(start, end),
  };
}

// ================================================================================
// Probes
// ================================================================================

// Single-shot probe: whole file already in memory, one synchronous appendBuffer.
function probeBuffer(wholeBuffer) {
  const mp4boxFile = createFile();
  let result = null;
  let error = null;

  mp4boxFile.onError = (err) => { error = new Error(String(err)); };
  mp4boxFile.onReady = (info) => {
    const track = info.videoTracks[0];
    if (!track) { error = new Error('No video track found'); return; }
    const trak = mp4boxFile.getTrackById(track.id);
    result = {
      codec: track.codec,
      codedWidth: track.video.width,
      codedHeight: track.video.height,
      description: getCodecDescription(trak),
      nbSamples: track.nb_samples,
    };
  };

  wholeBuffer.fileStart = 0;
  mp4boxFile.appendBuffer(wholeBuffer);
  mp4boxFile.flush();

  if (error) throw error;
  if (!result) throw new Error('Probe never reached onReady - moov box not found');
  return result;
}

// Streaming probe: feed reader chunks into a throwaway mp4box until onReady fires
// (moov is at the front of the reordered view, so this happens within the first
// chunk or two). No sample extraction - just header parsing to learn codec+config.
function probeReader(reader, chunkSize) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile();
    let settled = false;

    mp4boxFile.onError = (err) => { if (!settled) { settled = true; reject(new Error(String(err))); } };
    mp4boxFile.onReady = (info) => {
      if (settled) return;
      settled = true;
      const track = info.videoTracks[0];
      if (!track) { reject(new Error('No video track found')); return; }
      const trak = mp4boxFile.getTrackById(track.id);
      resolve({
        codec: track.codec,
        codedWidth: track.video.width,
        codedHeight: track.video.height,
        description: getCodecDescription(trak),
        nbSamples: track.nb_samples,
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
        if (!settled) { settled = true; reject(new Error('Probe never reached onReady - moov not found in stream')); }
      }
    })().catch((e) => { if (!settled) { settled = true; reject(e); } });
  });
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

// ================================================================================
// Shared pipeline: decoder (+ crop/scale/encoder/muxer unless decode-only),
// backpressure gate, memory sampler, per-bucket throughput, throughput report,
// mux + playback verify.
// ================================================================================

async function buildPipeline(probe, { decodeOnly }) {
  const { codec, codedWidth, codedHeight, description } = probe;

  const decoderSupport = await VideoDecoder.isConfigSupported({ codec, codedWidth, codedHeight });
  if (!decoderSupport.supported) {
    return { ok: false, reason: `VideoDecoder does not support ${codec} at ${codedWidth}x${codedHeight}` };
  }

  const outHeight = Math.round((codedHeight / codedWidth) * ENCODE_TARGET_WIDTH / 2) * 2;

  let encoderChoice = null;
  let ctx = null;
  let canvas = null;
  let muxer = null;
  let muxerTarget = null;
  let encoder = null;

  if (!decodeOnly) {
    encoderChoice = await pickEncoder(ENCODE_TARGET_WIDTH, outHeight);
    if (!encoderChoice) {
      return { ok: false, reason: 'no supported output encoder (H.264 or HEVC) at target size' };
    }
    canvas = new OffscreenCanvas(ENCODE_TARGET_WIDTH, outHeight);
    ctx = canvas.getContext('2d');
    muxerTarget = new ArrayBufferTarget();
    muxer = new Muxer({
      target: muxerTarget,
      video: { codec: encoderChoice.muxerCodec, width: ENCODE_TARGET_WIDTH, height: outHeight },
      fastStart: 'in-memory',
      firstTimestampBehavior: 'offset',
    });
  }

  // --- metrics + throughput state ---
  const startTime = performance.now();
  let framesDecoded = 0;
  let framesEncoded = 0;
  let firstDecodeTime = null;
  let lastOutputTime = null;

  // per-bucket (30 s wall-clock) counted-frame tallies. "counted" = encoded frames in
  // decode+encode mode (the end-to-end unit), decoded frames in decode-only mode.
  const buckets = [];
  function countFrame(nowWall) {
    const idx = Math.floor((nowWall - startTime) / BUCKET_MS);
    buckets[idx] = (buckets[idx] ?? 0) + 1;
  }

  // --- memory sampler ---
  const memSamples = []; // { t, bytes }
  let memTimer = null;
  let memMethod = 'none';
  async function takeMemSample() {
    let bytes = null;
    if (globalThis.crossOriginIsolated && performance.measureUserAgentSpecificMemory) {
      try {
        const r = await performance.measureUserAgentSpecificMemory();
        bytes = r.bytes;
        memMethod = 'measureUserAgentSpecificMemory';
      } catch { /* fall through to heap */ }
    }
    if (bytes === null && performance.memory) {
      bytes = performance.memory.usedJSHeapSize;
      memMethod = 'performance.memory.usedJSHeapSize';
    }
    if (bytes !== null) memSamples.push({ t: performance.now() - startTime, bytes });
  }

  // --- backpressure gate (shared by both demux paths) ---
  let inFlight = 0;
  let resumeAppend = null;
  function beforeDecode() {
    inFlight += 1;
    const shouldPause = decoder.decodeQueueSize > IN_FLIGHT_CAP || inFlight > IN_FLIGHT_CAP;
    if (!shouldPause) return null;
    return new Promise((resolve) => { resumeAppend = resolve; });
  }

  if (!decodeOnly) {
    encoder = new VideoEncoder({
      output: (chunk, meta) => {
        muxer.addVideoChunk(chunk, meta);
        framesEncoded += 1;
        lastOutputTime = performance.now();
        countFrame(lastOutputTime);
      },
      error: (err) => { console.error('ENCODER ERROR', err); },
    });
    encoder.configure({
      codec: encoderChoice.codec,
      width: ENCODE_TARGET_WIDTH,
      height: outHeight,
      bitrate: ENCODE_BITRATE,
      framerate: REALTIME_FPS,
      // mp4-muxer reads decoderConfig.colorSpace off the encoder's first output chunk
      // and throws on null - Rec.709 is a reasonable default for the spike's SDR output.
      colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
    });
  }

  const decoder = new VideoDecoder({
    output: (frame) => {
      if (firstDecodeTime === null) firstDecodeTime = performance.now();
      framesDecoded += 1;

      if (decodeOnly) {
        const now = performance.now();
        lastOutputTime = now;
        frame.close();
        countFrame(now);
      } else {
        // Crop+scale: source is the full frame, output is the encode target size.
        // A real shrink implementation would take a user-chosen crop rect; the spike
        // times a representative center-crop-and-scale instead.
        const ts = frame.timestamp;
        ctx.drawImage(frame, 0, 0, frame.codedWidth, frame.codedHeight, 0, 0, ENCODE_TARGET_WIDTH, outHeight);
        frame.close();
        const videoFrame = new VideoFrame(canvas, { timestamp: ts });
        encoder.encode(videoFrame);
        videoFrame.close();
      }

      inFlight -= 1;
      if (inFlight <= IN_FLIGHT_CAP / 2 && resumeAppend) {
        const resume = resumeAppend;
        resumeAppend = null;
        resume();
      }
    },
    error: (err) => { console.error('DECODER ERROR', err); },
  });
  decoder.configure({ codec, codedWidth, codedHeight, description });

  return {
    ok: true,
    decoder,
    beforeDecode,
    encoderChoice,
    outHeight,
    startMemorySampling() {
      takeMemSample();
      memTimer = setInterval(takeMemSample, MEM_SAMPLE_MS);
    },
    async finalize({ lines, report, mode, chunkSizeMB, decodeOnly: dOnly, nbSamples, demuxStats }) {
      await decoder.flush();
      if (encoder) await encoder.flush();
      decoder.close();
      if (encoder) encoder.close();

      if (memTimer) clearInterval(memTimer);
      await takeMemSample(); // final reading after flush

      const wallSeconds = (performance.now() - startTime) / 1000;
      const countedFrames = dOnly ? framesDecoded : framesEncoded;
      const endToEndFps = countedFrames / wallSeconds;
      const realtimeMultiplier = endToEndFps / REALTIME_FPS;

      lines.push(
        '',
        `--- Throughput (${mode}${mode === 'streaming' ? `, ${chunkSizeMB} MB chunks` : ''}, ${dOnly ? 'decode-only' : 'decode+encode'}) ---`,
        `Frames decoded: ${framesDecoded}` + (nbSamples != null ? ` / ${nbSamples} expected (moov)` : ''),
        dOnly ? `Frames encoded: n/a (decode-only)` : `Frames encoded: ${framesEncoded}`,
        `Frame count matches moov: ${nbSamples != null ? (framesDecoded === nbSamples ? 'YES' : `NO (${framesDecoded} vs ${nbSamples})`) : 'unknown'}`,
        `Wall seconds: ${wallSeconds.toFixed(2)}`,
        `End-to-end fps: ${endToEndFps.toFixed(2)}`,
        `Realtime multiplier: ${realtimeMultiplier.toFixed(3)}x (source ~${REALTIME_FPS}fps)`,
      );

      // Per-bucket throughput (endurance / slope).
      lines.push('', 'Per-bucket throughput (30 s wall-clock buckets):');
      let minBucketFps = Infinity;
      for (let i = 0; i < buckets.length; i++) {
        const framesInBucket = buckets[i] ?? 0;
        // last bucket may be partial
        const isLast = i === buckets.length - 1;
        const bucketSeconds = isLast ? Math.max(0.001, wallSeconds - i * (BUCKET_MS / 1000)) : (BUCKET_MS / 1000);
        const fps = framesInBucket / bucketSeconds;
        if (framesInBucket > 0) minBucketFps = Math.min(minBucketFps, fps);
        lines.push(`  [${i * 30}-${(i + 1) * 30}s] ${framesInBucket} frames, ${fps.toFixed(2)} fps`);
      }
      if (minBucketFps === Infinity) minBucketFps = 0;
      lines.push(`Min bucket fps: ${minBucketFps.toFixed(2)}`);

      // Memory.
      const peakBytes = memSamples.reduce((m, s) => Math.max(m, s.bytes), 0);
      const finalBytes = memSamples.length ? memSamples[memSamples.length - 1].bytes : 0;
      lines.push(
        '',
        `Memory (${memMethod}):`,
        `  Peak: ${(peakBytes / 1e6).toFixed(1)} MB`,
        `  Final: ${(finalBytes / 1e6).toFixed(1)} MB`,
        `  Samples (MB over time): [${memSamples.map((s) => (s.bytes / 1e6).toFixed(0)).join(', ')}]`,
      );

      if (mode === 'streaming') {
        lines.push(
          '',
          `mp4box internal buffers (must stay bounded = releaseUsedSamples working):`,
          `  max retained buffer count during run: ${demuxStats.maxMp4boxBuffers}`,
          `  final buffer count: ${demuxStats.finalMp4boxBuffers}`,
          `  releaseUsedSamples calls: ${demuxStats.releaseCalls}`,
        );
      }

      report(lines);

      // Mux + playback (skipped entirely in decode-only mode).
      if (dOnly) {
        lines.push('', 'Output: skipped (decode-only mode)');
        report(lines);
        return;
      }

      let outputBlob = null;
      let playable = 'not verified';
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
      );
      report(lines);
    },
  };
}

// ================================================================================
// Demux paths
// ================================================================================

// Single-shot: whole buffer already in memory, one appendBuffer, drain with backpressure.
// (T8830's original path, adapted to the shared beforeDecode gate.)
function demuxSingleShot(wholeBuffer, decoder, { beforeDecode, onProgress }) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile();
    let videoTrackId = null;
    let decodedCount = 0;
    const queue = [];

    mp4boxFile.onError = (err) => reject(new Error(String(err)));
    mp4boxFile.onReady = (info) => {
      videoTrackId = info.videoTracks[0].id;
      mp4boxFile.setExtractionOptions(videoTrackId, null, { nbSamples: EXTRACTION_NB_SAMPLES });
      mp4boxFile.start();
    };
    mp4boxFile.onSamples = (trackId, user, samples) => {
      if (trackId !== videoTrackId) return;
      queue.push(...samples);
    };

    wholeBuffer.fileStart = 0;
    mp4boxFile.appendBuffer(wholeBuffer);
    mp4boxFile.flush();

    (async () => {
      for (const sample of queue) {
        const wait = beforeDecode();
        if (wait) await wait;
        decoder.decode(sampleToChunk(sample));
        decodedCount += 1;
        onProgress(decodedCount);
      }
      resolve();
    })().catch(reject);
  });
}

// Streaming: feed mp4box fixed-size chunks from the faststart-ordered reader. After
// EACH chunk's appendBuffer, drain whatever samples mp4box emitted (with backpressure)
// and release them, so mp4box's internal buffer list never grows unbounded. Fully
// serialized (feed -> drain -> feed) inside ONE async loop: onSamples only pushes to a
// plain array and is never async, so there is no second in-flight loop competing for
// the single backpressure resume slot (the stall class documented in T8830).
function demuxStreaming(reader, chunkSize, decoder, { beforeDecode, onProgress }) {
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile();
    let videoTrackId = null;
    let decodedCount = 0;
    let lastSampleNumber = -1;
    let lastReleasedNumber = -1;
    let releaseCalls = 0;
    let maxMp4boxBuffers = 0;
    const queue = [];

    mp4boxFile.onError = (err) => reject(new Error(String(err)));
    mp4boxFile.onReady = (info) => {
      videoTrackId = info.videoTracks[0].id;
      mp4boxFile.setExtractionOptions(videoTrackId, null, { nbSamples: EXTRACTION_NB_SAMPLES });
      mp4boxFile.start();
    };
    mp4boxFile.onSamples = (trackId, user, samples) => {
      if (trackId !== videoTrackId) return;
      queue.push(...samples);
    };

    function bufferCount() {
      return mp4boxFile.stream?.buffers?.length ?? 0;
    }

    async function drain() {
      while (queue.length) {
        const sample = queue.shift();
        const wait = beforeDecode();
        if (wait) await wait;
        decoder.decode(sampleToChunk(sample));
        decodedCount += 1;
        lastSampleNumber = sample.number;
        // Release consumed samples so mp4box frees the underlying appended buffers.
        if (sample.number - lastReleasedNumber >= RELEASE_EVERY) {
          mp4boxFile.releaseUsedSamples(videoTrackId, sample.number);
          lastReleasedNumber = sample.number;
          releaseCalls += 1;
        }
        onProgress(decodedCount);
      }
    }

    (async () => {
      for (let off = 0; off < reader.logicalSize; off += chunkSize) {
        const end = Math.min(off + chunkSize, reader.logicalSize);
        const buf = await reader.slice(off, end).arrayBuffer();
        buf.fileStart = off;
        mp4boxFile.appendBuffer(buf);
        maxMp4boxBuffers = Math.max(maxMp4boxBuffers, bufferCount());
        await drain();
      }
      mp4boxFile.flush();
      await drain();
      if (videoTrackId !== null && lastSampleNumber > lastReleasedNumber) {
        mp4boxFile.releaseUsedSamples(videoTrackId, lastSampleNumber);
        lastReleasedNumber = lastSampleNumber;
        releaseCalls += 1;
      }
      resolve({ maxMp4boxBuffers, finalMp4boxBuffers: bufferCount(), releaseCalls });
    })().catch(reject);
  });
}

function sampleToChunk(sample) {
  return new EncodedVideoChunk({
    type: sample.is_sync ? 'key' : 'delta',
    timestamp: (sample.cts * 1e6) / sample.timescale,
    duration: (sample.duration * 1e6) / sample.timescale,
    data: sample.data,
  });
}

// ================================================================================
// Encoder pick + playback verify (unchanged from T8830)
// ================================================================================

// Tries H.264 first (per task file), then HEVC if isConfigSupported says yes.
async function pickEncoder(width, height) {
  const h264Support = await VideoEncoder.isConfigSupported({
    codec: H264_CODEC, width, height, bitrate: ENCODE_BITRATE, framerate: REALTIME_FPS,
  });
  if (h264Support.supported) return { codec: H264_CODEC, muxerCodec: 'avc' };

  const hevcCodec = 'hev1.1.6.L120.90';
  const hevcSupport = await VideoEncoder.isConfigSupported({
    codec: hevcCodec, width, height, bitrate: ENCODE_BITRATE, framerate: REALTIME_FPS,
  });
  if (hevcSupport.supported) return { codec: hevcCodec, muxerCodec: 'hevc' };

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
