// T8832 streaming-mode smoke test (container-safe, synthetic fixture).
//
// Proves the STREAMING MECHANISM is correct on a synthetic non-fast-start file:
//   - streaming mode decodes the SAME frame count as single-shot on the same file
//   - both chunk sizes (8 MB, 32 MB) run without error
//   - releaseUsedSamples is actually called and mp4box's internal buffer list stays
//     bounded across the run (a smoke check on this hardware, NOT proof of flat memory)
//   - per-30s-bucket throughput prints sane numbers
//   - (best effort) decode+encode output plays back
//
// This is NOT the real acceptance test: no GPU / no real DJI files here. Absolute speed
// and true memory endurance mean nothing on unaccelerated container hardware. See the
// task file / README for what only the supervisor can prove on real hardware.
//
// Run from repo root:  node scripts/shrink-spike/qa/t8832-streaming-smoke.mjs
// (playwright is borrowed from src/frontend/node_modules)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../../../..');
const FIXTURE = path.join(REPO_ROOT, 'scripts/shrink-spike/fixtures/synthetic_90s.mp4');
const PAGE_PATH = '/scripts/shrink-spike/index.html';
const EXPECTED_FRAMES = 2700; // 90 s * 30 fps (ffprobe -count_frames)

// playwright lives in the frontend workspace
const { chromium } = require(path.join(REPO_ROOT, 'src/frontend/node_modules/playwright/index.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
};

// Static server from repo root, with cross-origin isolation headers so the page can use
// performance.measureUserAgentSpecificMemory (falls back to performance.memory otherwise).
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

function parseNum(text, re) {
  const m = text.match(re);
  return m ? Number(m[1]) : null;
}

async function runCase(page, baseUrl, { mode, chunkMB, decodeOnly }) {
  const label = `${mode}${mode === 'streaming' ? ` ${chunkMB}MB` : ''} / ${decodeOnly ? 'decode-only' : 'decode+encode'}`;
  out(`\n=== CASE: ${label} ===`);
  await page.goto(baseUrl + PAGE_PATH, { waitUntil: 'load' });

  const coi = await page.evaluate(() => globalThis.crossOriginIsolated === true);
  out(`crossOriginIsolated: ${coi}`);

  await page.setInputFiles('#file-input', FIXTURE);
  await page.selectOption('#mode', mode);
  await page.fill('#chunk-size', String(chunkMB));
  await page.evaluate((d) => { document.getElementById('decode-only').checked = d; }, decodeOnly);
  await page.click('#run-btn');

  // Completion marker differs by decode-only vs encode.
  const doneRe = decodeOnly ? /Output: skipped|RUN FAILED/ : /Output playability:|RUN FAILED/;
  await page.waitForFunction(
    (reSrc) => new RegExp(reSrc).test(document.getElementById('results').textContent),
    doneRe.source,
    { timeout: 300_000 },
  );

  const text = await page.evaluate(() => document.getElementById('results').textContent);
  out(text);

  return {
    label, mode, chunkMB, decodeOnly, coi, text,
    framesDecoded: parseNum(text, /Frames decoded:\s*(\d+)/),
    matchesMoov: /Frame count matches moov:\s*YES/.test(text),
    minBucketFps: parseNum(text, /Min bucket fps:\s*([\d.]+)/),
    maxBuffers: parseNum(text, /max retained buffer count during run:\s*(\d+)/),
    finalBuffers: parseNum(text, /final buffer count:\s*(\d+)/),
    releaseCalls: parseNum(text, /releaseUsedSamples calls:\s*(\d+)/),
    peakMB: parseNum(text, /Peak:\s*([\d.]+)\s*MB/),
    finalMB: parseNum(text, /Final:\s*([\d.]+)\s*MB/),
    playable: /Output playability:\s*OK/.test(text),
    failed: /RUN FAILED|DECODER ERROR|ENCODER ERROR/.test(text),
  };
}

async function main() {
  if (!fs.existsSync(FIXTURE)) {
    out(`FIXTURE MISSING: ${FIXTURE}`);
    out('Generate it with the ffmpeg command in README "Full-file streaming".');
    process.exit(2);
  }
  const { server, port } = await startServer();
  const baseUrl = `http://127.0.0.1:${port}`;
  out(`Serving ${REPO_ROOT} at ${baseUrl} (COOP/COEP on)`);
  out(`Fixture: ${FIXTURE} (${(fs.statSync(FIXTURE).size / 1e6).toFixed(1)} MB), expected frames: ${EXPECTED_FRAMES}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('console', (msg) => log.push(`  [console.${msg.type()}] ${msg.text()}`));
  page.on('pageerror', (err) => log.push(`  [pageerror] ${err.message}`));

  const results = [];
  try {
    // Decode-only first: this is the mechanism proof and needs no encoder.
    results.push(await runCase(page, baseUrl, { mode: 'single-shot', chunkMB: 0, decodeOnly: true }));
    results.push(await runCase(page, baseUrl, { mode: 'streaming', chunkMB: 8, decodeOnly: true }));
    results.push(await runCase(page, baseUrl, { mode: 'streaming', chunkMB: 32, decodeOnly: true }));
    // Decode+encode: best effort (headless encoder support varies).
    results.push(await runCase(page, baseUrl, { mode: 'streaming', chunkMB: 8, decodeOnly: false }));
    results.push(await runCase(page, baseUrl, { mode: 'single-shot', chunkMB: 0, decodeOnly: false }));
  } finally {
    await browser.close();
    server.close();
  }

  // ---- Assertions (mechanism-level, container-safe) ----
  out('\n\n================ VERDICT ================');
  const byLabel = Object.fromEntries(results.map((r) => [r.label, r]));
  const checks = [];
  const oracle = byLabel['single-shot / decode-only'];
  const s8 = byLabel['streaming 8MB / decode-only'];
  const s32 = byLabel['streaming 32MB / decode-only'];

  checks.push(['single-shot decoded expected frame count',
    oracle && oracle.framesDecoded === EXPECTED_FRAMES]);
  checks.push(['streaming 8MB frame count == single-shot',
    s8 && oracle && s8.framesDecoded === oracle.framesDecoded]);
  checks.push(['streaming 32MB frame count == single-shot',
    s32 && oracle && s32.framesDecoded === oracle.framesDecoded]);
  checks.push(['streaming 8MB matches moov sample count',
    s8 && s8.matchesMoov]);
  checks.push(['streaming 8MB called releaseUsedSamples (>0)',
    s8 && s8.releaseCalls > 0]);
  checks.push(['streaming 8MB mp4box buffers bounded (max < 32)',
    s8 && s8.maxBuffers != null && s8.maxBuffers < 32]);
  checks.push(['streaming 32MB called releaseUsedSamples (>0)',
    s32 && s32.releaseCalls > 0]);
  checks.push(['streaming 8MB min bucket fps > 0',
    s8 && s8.minBucketFps > 0]);
  checks.push(['no run reported a hard failure',
    results.every((r) => !r.failed)]);

  let allPass = true;
  for (const [name, ok] of checks) {
    out(`  [${ok ? 'PASS' : 'FAIL'}] ${name}`);
    if (!ok) allPass = false;
  }

  out('\n---- decode+encode (best effort, headless encoder support varies) ----');
  for (const r of results.filter((x) => !x.decodeOnly)) {
    out(`  ${r.label}: frames=${r.framesDecoded} playable=${r.playable} failed=${r.failed}`);
  }

  out('\n---- memory (container heap, NOT a real endurance measurement) ----');
  for (const r of results) {
    out(`  ${r.label}: peak=${r.peakMB}MB final=${r.finalMB}MB maxBuffers=${r.maxBuffers ?? 'n/a'} releaseCalls=${r.releaseCalls ?? 'n/a'} minBucketFps=${r.minBucketFps}`);
  }

  out(`\nMECHANISM SMOKE: ${allPass ? 'PASS' : 'FAIL'}`);

  const logPath = path.join(REPO_ROOT, 'scripts/shrink-spike/qa/t8832-streaming-smoke.log');
  fs.writeFileSync(logPath, log.join('\n') + '\n');
  out(`\nEvidence written to ${logPath}`);
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  out(`DRIVER ERROR: ${err.stack ?? err.message}`);
  const logPath = path.join(REPO_ROOT, 'scripts/shrink-spike/qa/t8832-streaming-smoke.log');
  try { fs.writeFileSync(logPath, log.join('\n') + '\n'); } catch { /* ignore */ }
  process.exit(3);
});
