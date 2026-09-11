// T9490 latency measurement runner (real Chromium via Playwright).
const { chromium } = require('/workspace/src/frontend/node_modules/playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8791';
const SRC = BASE + '/t9490.mp4';

function stats(a){
  if (!a.length) return { n:0 };
  const s = [...a].sort((x,y)=>x-y);
  const q = p => s[Math.min(s.length-1, Math.floor(p*(s.length-1)))];
  const mean = a.reduce((x,y)=>x+y,0)/a.length;
  return { n:a.length, mean:+mean.toFixed(1), p50:+q(.5).toFixed(1),
           p95:+q(.95).toFixed(1), max:+Math.max(...a).toFixed(1) };
}

async function drag(page){
  // Reset metric arrays for this drag (keep video buffered state).
  await page.evaluate(() => {
    const M = window.__M;
    M.handleLatencies.length = 0; M.previewLatencies.length = 0;
    M.seekedLatencies.length = 0;
    M.seeksIssued = 0; M.framesPresented = 0; M.seekedEvents = 0;
    M.maxBacklog = 0; M.movesSeen = 0;
  });
  const box = await page.locator('[data-testid="end-handle"]').boundingBox();
  const track = await page.locator('[data-testid="scrub-track"]').boundingBox();
  const y = box.y + box.height/2;
  await page.mouse.move(box.x + box.width/2, y);
  await page.mouse.down();
  // Sweep the end handle leftward across ~55% of the track in ~70 move events
  // over ~1.6s -- a realistic human trim-drag cadence (~23ms between moves).
  const xStart = box.x + box.width/2;
  const xEnd = track.x + track.width*0.40;
  const STEPS = 70;
  for (let i=1;i<=STEPS;i++){
    const x = xStart + (xEnd - xStart)*(i/STEPS);
    await page.mouse.move(x, y);
    await page.waitForTimeout(23);
  }
  await page.mouse.up();
  // let the last in-flight seek(s) present
  await page.waitForTimeout(600);
  return page.evaluate(() => ({ ...window.__M,
    handle: window.__M.handleLatencies, preview: window.__M.previewLatencies,
    seeked: window.__M.seekedLatencies }));
}

(async () => {
  const out = {};
  for (const mode of ['current','coalesced']){
    const browser = await chromium.launch();
    // fresh context = cold-ish (no prior buffering). Disable cache.
    const ctx = await browser.newContext({ bypassCSP:true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('console', m => { if (m.type()==='error') errs.push(m.text()); });
    // COLD: throttle to a streaming-like link (8 Mbps down, 40ms RTT) so a
    // trim-drag right after loadeddata hits not-yet-buffered regions -- the
    // in-app / cold-cache scenario Andrew described.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline:false, latency:40, downloadThroughput: 8*1024*1024/8, uploadThroughput: 1*1024*1024/8 });
    await page.goto(`${BASE}/t9490-harness.html?mode=${mode}&src=${encodeURIComponent(SRC)}`);
    await page.waitForFunction(() => window.__READY === true || window.__ERR, null, { timeout: 30000 });
    const err = await page.evaluate(()=>window.__ERR||null);
    if (err){ console.log(`MODE ${mode}: VIDEO ERROR ${err}`); await browser.close(); continue; }

    const cold = await drag(page);          // COLD: throttled, first drag after load
    // WARM: remove throttle, let the whole file buffer, then drag again.
    await cdp.send('Network.emulateNetworkConditions', {
      offline:false, latency:0, downloadThroughput:-1, uploadThroughput:-1 });
    await page.evaluate(() => new Promise(res => {
      const v = document.querySelector('video');
      const done = () => (v.buffered.length && v.buffered.end(v.buffered.length-1) >= v.duration - 0.5);
      if (done()) return res();
      const iv = setInterval(() => { if (done()){ clearInterval(iv); res(); } }, 100);
      setTimeout(() => { clearInterval(iv); res(); }, 20000);
    }));
    const warm = await drag(page);          // WARM: fully buffered

    out[mode] = {
      cold: { handle: stats(cold.handle), preview_rvfc: stats(cold.preview),
              preview_seeked: stats(cold.seeked),
              seeksIssued: cold.seeksIssued, seekedEvents: cold.seekedEvents,
              maxBacklog: cold.maxBacklog, moves: cold.movesSeen },
      warm: { handle: stats(warm.handle), preview_rvfc: stats(warm.preview),
              preview_seeked: stats(warm.seeked),
              seeksIssued: warm.seeksIssued, seekedEvents: warm.seekedEvents,
              maxBacklog: warm.maxBacklog, moves: warm.movesSeen },
      rvfc: await page.evaluate(()=>typeof document.querySelector('video').requestVideoFrameCallback==='function'),
      consoleErrors: errs.slice(0,5),
    };
    await browser.close();
  }
  console.log('RESULTS_JSON_START');
  console.log(JSON.stringify(out, null, 2));
  console.log('RESULTS_JSON_END');
})().catch(e => { console.error('RUNNER_FAIL', e); process.exit(1); });
