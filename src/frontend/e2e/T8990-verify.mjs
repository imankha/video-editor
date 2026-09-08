/* eslint-env node, browser */
// T8990 real-browser verification (standalone, not CI). Drives the harness page
// (real layout engine) to prove the carousel filler mounts ONLY while it fits
// beside the tiles, at three viewport widths, and that the lone-game cell + the
// locked partial copy render. Writes evidence PNGs + a PASS/FAIL log to
// /workspace/qa/T8990. Config is driven through the reactive hash (a nested
// index.html drops the query and a hash change alone never reloads the module).
import { chromium } from '@playwright/test';
import fs from 'fs';

const HARNESS = 'http://localhost:5173/e2e/T8990-harness/index.html';
const OUT = '/workspace/qa/T8990';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const record = (ok, label, detail = '') => {
  checks.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

const PARTIAL = {
  games: 'Now cut your first play',
  clips: 'Give each clip a Focus pass',
  reels: 'Finish your reel and export once',
  published: 'Ready for coaches and family',
};

async function setConfig(page, tab, tiles) {
  await page.evaluate(({ tab, tiles }) => { location.hash = `tab=${tab}&tiles=${tiles}`; }, { tab, tiles });
  await page.waitForTimeout(250); // let the post-render measurement pass settle
}
const fillerPresent = (page) => page.locator('[data-carousel-filler]').count().then((n) => n > 0);

async function run() {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${HARNESS}#tab=clips&tiles=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[role="group"][aria-label="harness row"]');

  // 1) Width-driven mount/unmount for a landscape clips row.
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const seen = [];
    for (const tiles of [1, 2, 3, 4, 5]) {
      await setConfig(page, 'clips', tiles);
      seen.push((await fillerPresent(page)) ? 1 : 0);
    }
    const s = seen.join(',');
    if (width === 390) record(seen.every((v) => v === 0), '[390] filler never mounts (never below sm)', s);
    if (width === 768) record(seen[0] === 1 && seen.slice(1).every((v) => v === 0), '[768] mounts at 1 tile, gone once the row fills', s);
    if (width === 1280) {
      record(seen[0] === 1, '[1280] mounts beside a short row', s);
      record(seen[3] === 0, '[1280] retires once tiles fill the row (4-up)', s);
    }
    let mono = true;
    for (let i = 1; i < seen.length; i++) if (seen[i] > seen[i - 1]) mono = false;
    record(mono, `[${width}] verdict monotonic in tile count (filler cannot flip its own decision)`, s);
  }

  // 2) When mounted, the filler shows the LOCKED partial copy for each carousel tab.
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const tab of ['clips', 'reels', 'published']) {
    await setConfig(page, tab, 1);
    const mounted = await fillerPresent(page);
    const copyVisible = await page.getByText(PARTIAL[tab]).first().isVisible().catch(() => false);
    record(mounted && copyVisible, `[1280] ${tab} filler shows the locked headline`, PARTIAL[tab]);
    if (tab === 'clips') {
      const addVideo = await page.locator('[data-tutorial-target="clips-add-video"]').count();
      record(addVideo === 0, '[1280] clips partial filler renders no clips-add-video target', `count=${addVideo}`);
    }
    await page.screenshot({ path: `${OUT}/filler-${tab}-1280.png` });
  }

  // 3) Lone-game cell renders the guide + Open game CTA at all three widths.
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await setConfig(page, 'clips', 1);
    const headline = await page.getByText(PARTIAL.games).first().isVisible().catch(() => false);
    const cta = await page.getByRole('button', { name: 'Open game' }).first().isVisible().catch(() => false);
    record(headline && cta, `[${width}] lone-game cell shows guide + Open game CTA`);
    await page.screenshot({ path: `${OUT}/page-${width}.png`, fullPage: true });
  }

  await browser.close();
  const failed = checks.filter((c) => !c.ok);
  fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ checks, failed: failed.length }, null, 2));
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(2); });
