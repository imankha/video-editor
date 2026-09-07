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
      preset: PRESETS.smallest,
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
      preset: PRESETS.sharpest,
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
      worker.postMessage({ cmd: 'probe', file, crop: { x: 0, y: 0, w: 1, h: 1 }, preset: PRESETS.smallest });
      probeMsg = await waitFor('probe', 60000);

      worker.postMessage({
        cmd: 'start', file, crop: { x: 0, y: 0, w: 1, h: 1 }, preset: PRESETS.smallest,
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
    results = await page.evaluate(runInPage, { fixtureUrl: baseUrl + FIXTURE_URL, expectedFrames: EXPECTED_FRAMES });
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
    for (const name of ['demux', 'capability', 'fullRun', 'cancel', 'worker']) {
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
