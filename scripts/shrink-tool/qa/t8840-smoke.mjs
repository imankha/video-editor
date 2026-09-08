// T8840 headless smoke test (container-safe, synthetic fixture). Modeled on
// scripts/shrink-spike/qa/t8832-streaming-smoke.mjs.
//
// Proves the MECHANISM is correct on a synthetic non-fast-start A/V fixture:
//   - demux frame-count equivalence with the moov's own sample count (2700)
//   - a full shrinkSegment run (real OPFS sink, Smallest preset) produces a
//     playable output, smaller than the source, with both tracks present
//   - mp4box's internal buffer list stays bounded WITH audio extraction on
//   - cancel mid-run leaves liveFrames === 0 (design §3.5's whole guarantee)
//   - the worker.js postMessage protocol actually works end to end (probe +
//     start/progress/done), including a FileSystemDirectoryHandle surviving
//     structured clone into a module Worker
//
// This is NOT the real acceptance test: no GPU / no real DJI files here, and
// this container cannot see them. Absolute speed and the real speed-probe
// verdict mean nothing on unaccelerated container hardware. See the task file
// / README for what only the supervisor/user can prove on real hardware.
//
// Run from repo root:  node scripts/shrink-tool/qa/t8840-smoke.mjs
// (playwright is borrowed from src/frontend/node_modules)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const FIXTURE_URL = '/scripts/shrink-tool/fixtures/synthetic_90s_av.mp4';
const HARNESS_PATH = '/scripts/shrink-tool/qa/harness.html';
const EXPECTED_FRAMES = 2700; // 90s * 30fps
const AV_OFFSET_TOLERANCE_MS = 40; // ~1 video frame, allows for sample-duration rounding

const { chromium } = require(path.join(REPO_ROOT, 'src/frontend/node_modules/playwright/index.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(REPO_ROOT, urlPath);
    if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403); res.end(); return; }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404); res.end('not found'); return; }
      const ext = path.extname(filePath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
        'Cross-Origin-Resource-Policy': 'same-origin',
      });
      fs.createReadStream(filePath).pipe(res);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const log = [];
function out(line = '') { console.log(line); log.push(line); }

// ---------------------------------------------------------------------------
// The whole test suite runs INSIDE the page via one evaluate call, so pipeline
// modules can be dynamically imported same-origin and OPFS/WebCodecs are
// available. Returns a single JSON-serializable results object.
// ---------------------------------------------------------------------------
async function runInPage({ fixtureUrl, expectedFrames }) {
  const results = {};

  async function loadFixtureFile() {
    const res = await fetch(fixtureUrl);
    const blob = await res.blob();
    return new File([blob], 'synthetic_90s_av.mp4', { type: 'video/mp4' });
  }

  async function attempt(name, fn) {
    try {
      results[name] = await fn();
    } catch (err) {
      results[name] = { error: err.stack ?? err.message };
    }
  }

  // ---- Test 1: demux frame-count equivalence ----
  await attempt('demux', async () => {
    const { openReader, probeContainer, streamSamples } = await import('/scripts/shrink-tool/pipeline/demux.js');
    const file = await loadFixtureFile();
    const reader = await openReader(file);
    const tracks = await probeContainer(reader);
    let videoSamples = 0;
    let audioSamples = 0;
    const demuxResult = await streamSamples(reader, tracks, {
      onVideoSample: async () => { videoSamples += 1; },
      onAudioSample: () => { audioSamples += 1; },
    });
    return {
      moovNbSamples: tracks.video.nbSamples,
      videoFps: tracks.video.fps,
      videoSamplesCounted: videoSamples,
      audioSamplesGreaterThanZero: audioSamples > 0,
      matchesMoov: videoSamples === tracks.video.nbSamples,
      maxMp4boxBuffers: demuxResult.maxMp4boxBuffers,
      releaseCalls: demuxResult.releaseCalls,
      hasAudioTrack: !!tracks.audio,
    };
  });

  // ---- Test 2: capability check wiring (T8838 shared module) ----
  await attempt('capability', async () => {
    const { openReader } = await import('/scripts/shrink-tool/pipeline/demux.js');
    const { checkCapability } = await import('/scripts/shrink-tool/pipeline/probe.js');
    const file = await loadFixtureFile();
    const reader = await openReader(file);
    return checkCapability(file, reader.info);
  });

  // ---- Test 3: full shrinkSegment run, real OPFS sink, Smallest preset ----
  await attempt('fullRun', async () => {
    const { shrinkSegment } = await import('/scripts/shrink-tool/pipeline/shrinkSegment.js');
    const { PRESETS } = await import('/scripts/shrink-tool/pipeline/presets.js');
    const file = await loadFixtureFile();

    const opfsRoot = await navigator.storage.getDirectory();
    const testDir = await opfsRoot.getDirectoryHandle('t8840-smoke-out', { create: true });

    const progressCalls = [];
    const result = await shrinkSegment({
      file,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      preset: PRESETS.small,
      sink: { dirHandle: testDir, filename: 'full-run.mp4' },
      onProgress: (p) => progressCalls.push(p.framesDone),
    });

    const outFile = await result.outputHandle.getFile();

    // Output plays: attach to a real <video>, wait for metadata.
    const playable = await new Promise((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      const url = URL.createObjectURL(outFile);
      const timer = setTimeout(() => { URL.revokeObjectURL(url); resolve(false); }, 15000);
      video.addEventListener('loadedmetadata', () => {
        clearTimeout(timer);
        const ok = video.duration > 0 && !Number.isNaN(video.duration);
        URL.revokeObjectURL(url);
        resolve(ok);
      });
      video.addEventListener('error', () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(false); });
      video.src = url;
    });

    // Re-probe the OUTPUT to confirm both tracks survived the mux.
    const { openReader, probeContainer } = await import('/scripts/shrink-tool/pipeline/demux.js');
    const outReader = await openReader(outFile);
    const outTracks = await probeContainer(outReader);

    return {
      framesDone: result.framesDone,
      framesTotal: result.framesTotal,
      framesMatchExpected: result.framesDone === expectedFrames,
      outputBytes: outFile.size,
      smallerThanSource: outFile.size < file.size,
      mp4boxBuffersBounded: result.mp4boxBuffers < 10,
      progressReported: progressCalls.length > 0,
      playable,
      outputHasVideoTrack: !!outTracks.video,
      outputHasAudioTrack: !!outTracks.audio,
    };
  });

  // ---- Test 4: cancel mid-run leaves liveFrames === 0 ----
  await attempt('cancel', async () => {
    const { shrinkSegment } = await import('/scripts/shrink-tool/pipeline/shrinkSegment.js');
    const { PRESETS } = await import('/scripts/shrink-tool/pipeline/presets.js');
    const file = await loadFixtureFile();
    const controller = new AbortController();

    const cancelResult = await shrinkSegment({
      file,
      crop: { x: 0, y: 0, w: 1, h: 1 },
      preset: PRESETS.sharp,
      sink: null, // throwaway OPFS file
      signal: controller.signal,
      onProgress: (p) => { if (p.framesDone >= 15) controller.abort(); },
    });

    return {
      cancelled: cancelResult.cancelled === true,
      liveFrames: cancelResult.liveFrames,
      framesDoneWhenCancelled: cancelResult.framesDone,
    };
  });

  // ---- Test 5: worker.js postMessage protocol end to end ----
  await attempt('worker', async () => {
    const opfsRoot = await navigator.storage.getDirectory();
    const workerTmpDir = await opfsRoot.getDirectoryHandle('t8840-smoke-worker-tmp', { create: true });
    const file = await loadFixtureFile();

    const worker = new Worker('/scripts/shrink-tool/worker.js', { type: 'module' });
    const messages = [];
    const waitFor = (type, timeoutMs) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out waiting for '${type}'`)), timeoutMs);
      function handler(event) {
        messages.push(event.data.type);
        if (event.data.type === type) {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          resolve(event.data);
        } else if (event.data.type === 'error') {
          clearTimeout(timer);
          worker.removeEventListener('message', handler);
          reject(new Error(`worker error at stage ${event.data.stage}: ${event.data.message}`));
        }
      }
      worker.addEventListener('message', handler);
    });

    const { PRESETS } = await import('/scripts/shrink-tool/pipeline/presets.js');

    let probeMsg = null;
    let doneMsg = null;
    let workerError = null;
    try {
      worker.postMessage({ cmd: 'probe', file, crop: { x: 0, y: 0, w: 1, h: 1 }, preset: PRESETS.small });
      probeMsg = await waitFor('probe', 60000);

      worker.postMessage({
        cmd: 'start', file, crop: { x: 0, y: 0, w: 1, h: 1 }, preset: PRESETS.small,
        dirHandle: workerTmpDir, outName: 'worker-run.part',
      });
      doneMsg = await waitFor('done', 120000);
    } catch (err) {
      workerError = err.message;
    } finally {
      worker.terminate();
    }

    return {
      error: workerError,
      probeHasVerdict: typeof probeMsg?.verdict === 'string',
      progressMessageSeen: messages.includes('progress'),
      doneReceived: !!doneMsg,
      doneBytes: doneMsg?.bytes ?? null,
      dirHandleSurvivedPostMessage: !!doneMsg,
    };
  });

  // ---- Test 6 (B2 regression): decode.js's gate has an encoder-side wake source ----
  await attempt('backpressureWake', async () => {
    const { openReader, probeContainer, streamSamples } = await import('/scripts/shrink-tool/pipeline/demux.js');
    const { createDecodeStage, IN_FLIGHT_CAP } = await import('/scripts/shrink-tool/pipeline/decode.js');
    const file = await loadFixtureFile();
    const reader = await openReader(file);
    const tracks = await probeContainer(reader);

    // Collect a few real samples via one throwaway demux pass -- this test
    // isolates decode.js's OWN gate, not the full pipeline's wiring (that's
    // covered by the 'fullRun' test, which runs on hardware too slow to ever
    // actually flip the encoder queue over cap -- see the revision notes).
    const samples = [];
    const gatherAbort = new AbortController();
    await streamSamples(reader, tracks, {
      onVideoSample: async (sample) => {
        samples.push(sample);
        if (samples.length >= 3) gatherAbort.abort();
      },
      signal: gatherAbort.signal,
    }).catch(() => {});

    let encoderQueueDepth = 0;
    const decoder = await createDecodeStage({
      video: tracks.video,
      encoderQueueDepth: () => encoderQueueDepth,
      onFrame: async (frame) => { frame.close(); },
    });

    // B2 repro: force the encoder-side gate to read as permanently full. Before
    // the fix, nothing but a DECODER-side event ever called resumeWaiters(), so
    // this push() would park forever regardless of what the encoder does later.
    encoderQueueDepth = IN_FLIGHT_CAP + 100;
    let pushResolved = false;
    const pushPromise = decoder.push(samples[0]).then(() => { pushResolved = true; });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const parkedWhileFull = !pushResolved;

    // Now simulate the encoder draining and confirm decoder.wake() -- the
    // encoder's own onDequeue callback in shrinkSegment.js -- actually unparks it.
    encoderQueueDepth = 0;
    decoder.wake();
    await Promise.race([
      pushPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('push() never unparked after wake()')), 5000)),
    ]);

    return { parkedWhileFull, unparkedAfterWake: pushResolved };
  });

  // ---- Test 7 (B1 regression): promote -> simulate reload -> verifyOutputs round trip ----
  await attempt('checkpointRoundTrip', async () => {
    const { shrinkSegment } = await import('/scripts/shrink-tool/pipeline/shrinkSegment.js');
    const { PRESETS } = await import('/scripts/shrink-tool/pipeline/presets.js');
    const {
      openWorkspace, newManifest, reduceSegment, writeManifest, readManifest,
      verifyOutputs, promoteOutput, tmpPartName, discardWorkspace,
    } = await import('/scripts/shrink-tool/pipeline/checkpoint.js');
    const file = await loadFixtureFile();

    const ws0 = await openWorkspace();
    await discardWorkspace(ws0.root).catch(() => {}); // clean slate for this test
    const ws = await openWorkspace();

    let manifest = newManifest({
      jobId: 'smoke-b1',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      preset: 'smallest',
      segments: [{ name: file.name, size: file.size, lastModified: file.lastModified, durationSec: 90, framesTotal: expectedFrames }],
    });
    await writeManifest(ws.root, manifest);
    manifest.segments[0] = reduceSegment(manifest.segments[0], { type: 'start' });
    await writeManifest(ws.root, manifest);

    const outName = tmpPartName(manifest.segments[0]);
    const result = await shrinkSegment({
      file, crop: manifest.crop, preset: PRESETS[manifest.preset],
      sink: { dirHandle: ws.tmpDir, filename: outName },
    });
    const outFile = await result.outputHandle.getFile();

    // B1 regression: outputBytes must be the REAL file size -- an encoded-payload
    // count (missing ftyp/mdat header/moov) would mismatch verifyOutputs' exact-
    // equality check below and get this successfully-finished segment deleted.
    manifest.segments[0] = reduceSegment(manifest.segments[0], { type: 'finalizing', framesDone: result.framesDone, outputBytes: outFile.size });
    await writeManifest(ws.root, manifest);
    const outputName = await promoteOutput(ws.root, manifest.segments[0]);
    manifest.segments[0] = reduceSegment(manifest.segments[0], { type: 'finish', outputName });
    await writeManifest(ws.root, manifest);

    // Simulate a reload: re-read the manifest fresh and run the on-load repair pass.
    const reloaded = await readManifest(ws.root);
    const repaired = await verifyOutputs(ws.root, reloaded);

    return {
      stateAfterReload: repaired.segments[0].state,
      outputBytesMatchesRealSize: repaired.segments[0].outputBytes === outFile.size,
    };
  });

  // ---- Test 8 (B3 regression): staggered A/V start times must not throw ----
  //
  // Fabricates the skew directly against mux.js rather than trying to coax an
  // ffmpeg-generated fixture into genuine cross-track skew: ffmpeg's own muxer
  // actively normalizes stream start times (avoid_negative_ts), so an
  // -itsoffset'd source still comes out with both tracks at CTS 0 -- the
  // synthetic_90s_av fixture used by every other test has the same property,
  // which is exactly why it never caught B3. Real AAC bytes/description are
  // reused from that fixture (audio codec data is irrelevant to this bug);
  // only the audio sample's `cts` is shifted before handing it to `addAudioSample`,
  // which is the exact value mux.js's `firstTimestampBehavior` logic acts on.
  //
  // Investigated and confirmed empirically (not just read from docs): mp4-muxer
  // never writes an edit list (elst) box, so ISO BMFF's own rule that a track's
  // first sample sits at media-internal time 0 means `cross-track-offset` cannot
  // make a genuinely-later track visibly start later in the file -- the offset
  // gets absorbed into the gap between the first and second sample instead (an
  // inaudible one-time stretch for realistic sub-frame hardware jitter, but not
  // a faithful "starts N ms late" for a large synthetic gap). This is a real,
  // confirmed LIMITATION of the mp4-muxer dependency worth flagging upstream --
  // see the revision status log -- not something fixable inside mux.js. The
  // assertion below checks what B3 actually broke (the throw) plus what genuinely
  // IS preserved: the track's own internal sample-to-sample cadence.
  await attempt('staggeredAV', async () => {
    const AUDIO_OFFSET_US = 5_000; // ~1 AAC frame (21.3ms @ 48kHz) -- realistic hardware-jitter scale
    const { openReader, probeContainer, streamSamples } = await import('/scripts/shrink-tool/pipeline/demux.js');
    const { createOpfsSink, createMuxer } = await import('/scripts/shrink-tool/pipeline/mux.js');
    const { pickOutputCodec } = await import('/scripts/shrink-tool/pipeline/encode.js');

    const file = await loadFixtureFile();
    const reader = await openReader(file);
    const tracks = await probeContainer(reader);

    const audioSamples = [];
    const gatherAbort = new AbortController();
    await streamSamples(reader, tracks, {
      onVideoSample: async () => {},
      onAudioSample: (s) => {
        // mp4box clears/recycles the sample object's `data` once the onSamples
        // batch it belongs to returns -- must copy the bytes out SYNCHRONOUSLY
        // here, not stash a reference to `s` for use after this callback returns.
        if (audioSamples.length < 3) {
          audioSamples.push({ cts: s.cts, timescale: s.timescale, duration: s.duration, is_sync: s.is_sync, size: s.size, data: s.data.slice() });
        }
        if (audioSamples.length >= 3) gatherAbort.abort();
      },
      signal: gatherAbort.signal,
    }).catch(() => {});
    // Shift by exactly AUDIO_OFFSET_US, converted into the audio track's own timescale.
    const offsetAudioSamples = audioSamples.map((s) => ({
      ...s, cts: s.cts + Math.round((AUDIO_OFFSET_US * s.timescale) / 1e6),
    }));

    const opfsRoot = await navigator.storage.getDirectory();
    const testDir = await opfsRoot.getDirectoryHandle('t8840-smoke-staggered', { create: true });
    const sink = await createOpfsSink(testDir, 'staggered-mux-out.mp4');

    const codecChoice = await pickOutputCodec({
      width: tracks.video.codedWidth, height: tracks.video.codedHeight, bitrate: 1_000_000, framerate: tracks.video.fps,
    });
    const muxer = createMuxer({
      target: sink.target, writable: sink.writable,
      video: { codec: codecChoice.muxerCodec, width: tracks.video.codedWidth, height: tracks.video.codedHeight },
      audio: tracks.audio,
    });

    // A handful of real encoded video chunks, timestamps starting at 0 -- the
    // video track's first chunk is exactly where B3's fixed t0 landed before.
    const canvas = new OffscreenCanvas(tracks.video.codedWidth, tracks.video.codedHeight);
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
    const videoChunks = [];
    const encoder = new VideoEncoder({ output: (chunk, meta) => videoChunks.push({ chunk, meta }), error: () => {} });
    encoder.configure({
      codec: codecChoice.codec, width: tracks.video.codedWidth, height: tracks.video.codedHeight,
      bitrate: 1_000_000, framerate: tracks.video.fps,
      colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
    });
    for (let i = 0; i < 3; i += 1) {
      const frame = new VideoFrame(canvas, { timestamp: i * 33333 });
      encoder.encode(frame, { keyFrame: i === 0 });
      frame.close();
    }
    await encoder.flush();
    encoder.close();

    // B3 regression: this used to throw ("the first chunk for your media track
    // must have a timestamp of 0") the instant the two tracks' first timestamps
    // genuinely differed, which is exactly this setup.
    for (const { chunk, meta } of videoChunks) muxer.addVideoChunk(chunk, meta);
    for (const sample of offsetAudioSamples) muxer.addAudioSample(sample);
    await muxer.finalize();

    const outFile = await sink.handle.getFile();
    const outReader = await openReader(outFile);
    const outTracks = await probeContainer(outReader);
    const outAudioUs = [];
    const outVideoCount = { n: 0 };
    await streamSamples(outReader, outTracks, {
      onVideoSample: async () => { outVideoCount.n += 1; },
      onAudioSample: (s) => { outAudioUs.push((s.cts / s.timescale) * 1e6); },
    }).catch(() => {});

    // What genuinely IS preserved: the NATURAL spacing between audio sample 2
    // and sample 3 (both past the absorbed first-gap) should match the source's
    // own AAC frame duration, proving the track's internal cadence survived the
    // mux uncorrupted -- the offset itself does not survive (see comment above).
    const naturalDeltaUs = audioSamples[2].cts / audioSamples[2].timescale * 1e6 - audioSamples[1].cts / audioSamples[1].timescale * 1e6;
    const outputDeltaUs = outAudioUs.length >= 3 ? outAudioUs[2] - outAudioUs[1] : null;

    return {
      videoSampleCount: outVideoCount.n,
      audioSampleCount: outAudioUs.length,
      firstAudioCtsUs: outAudioUs[0] ?? null,
      cadenceDriftUs: outputDeltaUs == null ? null : Math.abs(naturalDeltaUs - outputDeltaUs),
    };
  });

  return results;
}

async function main() {
  const fixturePath = path.join(REPO_ROOT, 'scripts/shrink-tool/fixtures/synthetic_90s_av.mp4');
  if (!fs.existsSync(fixturePath)) {
    out(`FIXTURE MISSING: ${fixturePath}`);
    out('Generate it with the ffmpeg command in README.md / the T8840 kickoff.');
    process.exit(2);
  }

  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  out(`Serving ${REPO_ROOT} at ${baseUrl} (COOP/COEP on)`);
  out(`Fixture: ${fixturePath} (${(fs.statSync(fixturePath).size / 1e6).toFixed(1)} MB), expected frames: ${EXPECTED_FRAMES}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => log.push(`  [console.${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => log.push(`  [pageerror] ${err.message}`));

  let results;
  let driverError = null;
  try {
    await page.goto(baseUrl + HARNESS_PATH, { waitUntil: 'load' });
    const coi = await page.evaluate(() => globalThis.crossOriginIsolated === true);
    out(`crossOriginIsolated: ${coi}`);
    results = await page.evaluate(runInPage, {
      fixtureUrl: baseUrl + FIXTURE_URL,
      expectedFrames: EXPECTED_FRAMES,
    });
  } catch (err) {
    driverError = err.stack ?? err.message;
  } finally {
    await browser.close();
    server.close();
  }

  out('\n\n================ RESULTS ================');
  out(JSON.stringify(results, null, 2));

  out('\n\n================ VERDICT ================');
  const checks = [];
  if (driverError) {
    out(`DRIVER ERROR: ${driverError}`);
  } else {
    for (const name of ['demux', 'capability', 'fullRun', 'cancel', 'worker', 'backpressureWake', 'checkpointRoundTrip', 'staggeredAV']) {
      checks.push([`${name}: test ran without throwing`, results[name]?.error == null]);
    }
    const d = results.demux ?? {};
    checks.push(['demux: video sample count == expected (2700)', d.videoSamplesCounted === EXPECTED_FRAMES]);
    checks.push(['demux: sample count matches moov', d.matchesMoov === true]);
    checks.push(['demux: audio samples extracted (>0)', d.audioSamplesGreaterThanZero === true]);
    checks.push(['demux: mp4box buffers bounded (<10) with audio on', d.maxMp4boxBuffers < 10]);
    checks.push(['demux: releaseUsedSamples called (>0)', d.releaseCalls > 0]);

    const cap = results.capability ?? {};
    checks.push(['capability: checkCapability did not throw, returned decode/encode', typeof cap.decode === 'string' && typeof cap.encode === 'string']);

    const f = results.fullRun ?? {};
    checks.push(['full run: frames decoded == expected (2700)', f.framesMatchExpected === true]);
    checks.push(['full run: output smaller than source', f.smallerThanSource === true]);
    checks.push(['full run: mp4box buffers bounded (<10)', f.mp4boxBuffersBounded === true]);
    checks.push(['full run: progress events reported', f.progressReported === true]);
    checks.push(['full run: output plays (loadedmetadata, duration > 0)', f.playable === true]);
    checks.push(['full run: output has video track', f.outputHasVideoTrack === true]);
    checks.push(['full run: output has audio track', f.outputHasAudioTrack === true]);

    const c = results.cancel ?? {};
    checks.push(['cancel: shrinkSegment reports cancelled', c.cancelled === true]);
    checks.push(['cancel: liveFrames === 0 after teardown', c.liveFrames === 0]);

    const w = results.worker ?? {};
    checks.push(['worker: no error', w.error == null]);
    checks.push(['worker: probe message has a verdict', w.probeHasVerdict === true]);
    checks.push(['worker: progress messages seen', w.progressMessageSeen === true]);
    checks.push(['worker: done message received (dirHandle survived postMessage)', w.doneReceived === true]);

    const bp = results.backpressureWake ?? {};
    checks.push(['B2: push() parks while the encoder queue reads as full', bp.parkedWhileFull === true]);
    checks.push(['B2: push() unparks once wake() is called after draining', bp.unparkedAfterWake === true]);

    const cr = results.checkpointRoundTrip ?? {};
    checks.push(['B1: segment survives verifyOutputs after a simulated reload (state stays done)', cr.stateAfterReload === 'done']);
    checks.push(['B1: persisted outputBytes matches the real OPFS file size', cr.outputBytesMatchesRealSize === true]);

    const av = results.staggeredAV ?? {};
    checks.push(['B3: muxing genuinely-staggered A/V tracks does not throw', av.error == null]);
    checks.push(['B3: all 3 video + 3 audio samples survived the mux', av.videoSampleCount === 3 && av.audioSampleCount === 3]);
    checks.push([`B3: audio track's own internal cadence is uncorrupted (drift < ${AV_OFFSET_TOLERANCE_MS}ms)`, av.cadenceDriftUs != null && av.cadenceDriftUs / 1000 < AV_OFFSET_TOLERANCE_MS]);
  }

  let allPass = !driverError;
  for (const [name, ok] of checks) {
    out(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
    if (!ok) allPass = false;
  }
  out(`\nMECHANISM SMOKE: ${allPass ? 'PASS' : 'FAIL'}`);
  out('\nNOT proven here (container has no GPU, no real files): real-hardware speed,');
  out('real DJI A/V sync by ear, thermal endurance, checkpoint/resume across an actual');
  out('reload, Save-to-disk UX. See README.md for the user\'s own test recipe.');

  const logPath = path.join(REPO_ROOT, 'scripts/shrink-tool/qa/t8840-smoke.log');
  fs.writeFileSync(logPath, log.join('\n') + '\n');
  out(`\nEvidence written to ${logPath}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  out(`DRIVER ERROR: ${err.stack ?? err.message}`);
  const logPath = path.join(REPO_ROOT, 'scripts/shrink-tool/qa/t8840-smoke.log');
  try { fs.writeFileSync(logPath, log.join('\n') + '\n'); } catch { /* ignore */ }
  process.exit(3);
});
