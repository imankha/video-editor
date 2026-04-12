/**
 * T1380: Moov Atom Faststart Probe
 *
 * Probes production videos to verify moov atom position before and after
 * the faststart optimization. Also measures analysis time overhead.
 *
 * Run: npx playwright test e2e/faststart-probe.spec.js
 */

import { test, expect } from '@playwright/test';

const PROD_API = 'https://reel-ballers-api.fly.dev';

const VIDEOS = {
  veo: {
    label: 'VEO (imankh)',
    userId: 'c57203a2-5c10-46ce-8973-ad025a2671bb',
    gameId: 1,
    expectedMoovAtStart: true,
  },
  trace: {
    label: 'Trace (sarkarati)',
    userId: 'c7ef8d3a-b823-4847-a900-3235d475bdd7',
    gameId: 1,
    expectedMoovAtStart: false,
  },
};

/**
 * Fetch a fresh presigned URL from the prod API.
 */
async function getPresignedUrl(userId, gameId) {
  const res = await fetch(`${PROD_API}/api/games/${gameId}`, {
    headers: { 'X-User-ID': userId },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.videos?.[0]?.video_url || data.video_url;
}

/**
 * Read bytes from a URL using Range request.
 */
async function readRange(url, start, end) {
  const res = await fetch(url, {
    headers: { Range: `bytes=${start}-${end}` },
  });
  return await res.arrayBuffer();
}

/**
 * Read box type at a given offset.
 */
function readBoxType(buffer, offset) {
  const view = new DataView(buffer);
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/**
 * Read 4-byte big-endian uint.
 */
function readUint32(buffer, offset) {
  return new DataView(buffer).getUint32(offset, false);
}

/**
 * Scan top-level boxes from a URL using Range requests.
 * Returns the first few boxes (enough to determine moov position).
 */
async function probeBoxes(url) {
  const boxes = [];
  let offset = 0;

  // Probe up to 10 boxes or 100 iterations (safety)
  for (let i = 0; i < 100 && boxes.length < 10; i++) {
    const headerBuf = await readRange(url, offset, offset + 15);
    const view = new DataView(headerBuf);

    let size = readUint32(headerBuf, 0);
    const type = readBoxType(headerBuf, 4);

    if (size === 1) {
      const hi = readUint32(headerBuf, 8);
      const lo = readUint32(headerBuf, 12);
      size = hi * 0x100000000 + lo;
    }

    if (size === 0 || size < 8) break;

    boxes.push({ type, offset, size });

    // Once we've found moov or mdat, we know enough
    if (boxes.some(b => b.type === 'moov') && boxes.some(b => b.type === 'mdat')) {
      break;
    }

    offset += size;
  }

  return boxes;
}

for (const [key, config] of Object.entries(VIDEOS)) {
  test(`Probe moov position: ${config.label}`, async () => {
    test.setTimeout(60000);

    const url = await getPresignedUrl(config.userId, config.gameId);
    console.log(`\n[FaststartProbe] ${config.label}: fetching box structure...`);

    const boxes = await probeBoxes(url);

    console.log(`[FaststartProbe] Boxes found:`);
    for (const box of boxes) {
      const sizeMB = (box.size / (1024 * 1024)).toFixed(1);
      console.log(`[FaststartProbe]   ${box.type} @ offset ${box.offset} (${sizeMB} MB)`);
    }

    const moov = boxes.find(b => b.type === 'moov');
    const mdat = boxes.find(b => b.type === 'mdat');

    expect(moov).toBeTruthy();
    expect(mdat).toBeTruthy();

    const moovAtStart = moov.offset < mdat.offset;

    console.log(`[FaststartProbe] moov @ ${moov.offset}, mdat @ ${mdat.offset}`);
    console.log(`[FaststartProbe] moov is at ${moovAtStart ? 'START' : 'END'} (expected: ${config.expectedMoovAtStart ? 'START' : 'END'})`);
    console.log(`[FaststartProbe] moov size: ${(moov.size / 1024).toFixed(0)} KB`);

    if (config.expectedMoovAtStart) {
      expect(moovAtStart).toBe(true);
      console.log(`[FaststartProbe] ✓ ${config.label}: moov already at start — faststart will skip (no-op)`);
    } else {
      expect(moovAtStart).toBe(false);
      console.log(`[FaststartProbe] ✓ ${config.label}: moov at end — faststart will relocate`);
    }
  });
}

test('Measure analysis overhead via presigned URL range reads', async () => {
  test.setTimeout(60000);

  // Measure how long it takes to read the box headers + moov from prod Trace video
  // This simulates what analyzeMp4Faststart does, but via network Range requests
  const url = await getPresignedUrl(VIDEOS.trace.userId, VIDEOS.trace.gameId);

  const start = performance.now();

  // Step 1: Scan boxes (same as analyzeMp4Faststart)
  const boxes = await probeBoxes(url);
  const scanTime = performance.now() - start;

  const moov = boxes.find(b => b.type === 'moov');
  expect(moov).toBeTruthy();

  // Step 2: Read the moov atom (what analyzeMp4Faststart does for patching)
  const moovStart = performance.now();
  const moovRes = await fetch(url, {
    headers: { Range: `bytes=${moov.offset}-${moov.offset + moov.size - 1}` },
  });
  const moovBuf = await moovRes.arrayBuffer();
  const moovReadTime = performance.now() - moovStart;

  const totalTime = performance.now() - start;

  console.log(`\n[FaststartProbe] Analysis overhead (Trace 3GB video):`);
  console.log(`[FaststartProbe]   Box scan: ${Math.round(scanTime)}ms (${boxes.length} boxes found)`);
  console.log(`[FaststartProbe]   Moov read: ${Math.round(moovReadTime)}ms (${(moovBuf.byteLength / 1024).toFixed(0)} KB)`);
  console.log(`[FaststartProbe]   Total: ${Math.round(totalTime)}ms`);
  console.log(`[FaststartProbe]   Note: on local File, this would be <10ms (no network)`);

  // On a local File, analysis is <100ms. This network test just confirms moov is readable.
  expect(moovBuf.byteLength).toBe(moov.size);
});
