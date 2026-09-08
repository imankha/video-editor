// T8980 live QA drive (standalone, not part of the CI suite). Drives a fresh
// empty test-login account so all four home tabs render the shared
// EmptyTabGuide, captures evidence at 320/390/507/768/1024, and measures the
// tab-button height under BOTH fine-pointer and coarse-pointer emulation
// (CDP Emulation.setEmulatedMedia -- the capability query, not a viewport
// resize) so the coarse >=44px / fine ~36px split is verified directly.
import { chromium } from '@playwright/test';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const OUT = '/workspace/qa/T8980';
fs.mkdirSync(OUT, { recursive: true });

const TABS = [
  { id: 'games', short: 'Games', name: /^Games/, headline: 'Every highlight starts with a game' },
  { id: 'clips', short: 'Clips', name: /^(In Progress )?Clips/, headline: 'Clips are the plays you cut from a game' },
  { id: 'reels', short: 'Reels', name: /^(In Progress )?Reels/, headline: 'Reels stitch several clips into one highlight video' },
  { id: 'published', short: 'Published', name: /^Published/, headline: 'Published reels are ready to share' },
];

const results = { screenshots: [], checks: [], heights: [] };
const record = (ok, label, detail) => {
  results.checks.push({ ok, label, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

async function authenticate(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.reload({ waitUntil: 'networkidle' });
}

async function gotoTab(page, tab) {
  const btn = page.getByRole('button', { name: tab.name }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await page.waitForTimeout(400);
  return btn;
}

async function run() {
  const browser = await chromium.launch();

  // ---- Pass 1: fine-pointer (default desktop context, no touch) ----
  const fine = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const page = await fine.newPage();
  await authenticate(page);

  for (const w of [320, 390, 507, 768, 1024]) {
    await page.setViewportSize({ width: w, height: 820 });
    for (const tab of TABS) {
      const btn = await gotoTab(page, tab);
      // EmptyTabGuide renders: approved headline present.
      const headlineVisible = await page.getByText(tab.headline).first().isVisible().catch(() => false);
      record(headlineVisible, `[fine ${w}] ${tab.id}: EmptyTabGuide headline`, tab.headline);

      // Flow strip: sub-sm shows "Step N of 4", sm+ shows the 4 numbered steps.
      if (w < 640) {
        const stepNamed = await page.getByText(/Step \d of 4:/).first().isVisible().catch(() => false);
        record(stepNamed, `[fine ${w}] ${tab.id}: flow strip collapses to named dot`);
      }

      const shot = `${OUT}/fine-${w}-${tab.id}.png`;
      await page.screenshot({ path: shot, fullPage: false });
      results.screenshots.push(shot);

      // Tab-button height at this width (fine pointer).
      const box = await btn.boundingBox();
      results.heights.push({ pointer: 'fine', width: w, tab: tab.id, height: Math.round(box.height) });
    }
  }

  // CTA-in-viewport (no scroll) on Games at 320/375/390/428 -- primary Add Game.
  for (const w of [320, 375, 390, 428]) {
    await page.setViewportSize({ width: w, height: 700 });
    await gotoTab(page, TABS[0]);
    const cta = page.getByRole('button', { name: 'Add Game' }).first();
    const box = await cta.boundingBox();
    const inView = box && box.y >= 0 && box.y + box.height <= 700;
    record(!!inView, `[fine ${w}] Games primary CTA in viewport without scrolling`,
      box ? `y=${Math.round(box.y)} bottom=${Math.round(box.y + box.height)} vh=700` : 'no box');
  }
  await fine.close();

  // ---- Pass 2: coarse-pointer emulation at sm+ (768, 1024) ----
  // hasTouch context + CDP setEmulatedMedia(pointer:coarse, hover:none) so the
  // `coarse-pointer:` Tailwind variant matches -- independent of viewport width.
  for (const w of [768, 1024]) {
    const coarse = await browser.newContext({ viewport: { width: w, height: 900 }, hasTouch: true });
    const cpage = await coarse.newPage();
    const cdp = await coarse.newCDPSession(cpage);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'pointer', value: 'coarse' }, { name: 'hover', value: 'none' }],
    });
    await authenticate(cpage);
    const btn = await gotoTab(cpage, TABS[0]);
    const box = await btn.boundingBox();
    const h = Math.round(box.height);
    results.heights.push({ pointer: 'coarse', width: w, tab: 'games', height: h });
    record(h >= 44, `[coarse ${w}] tab button height >= 44px`, `${h}px`);
    await cpage.screenshot({ path: `${OUT}/coarse-${w}-tabbar.png` });
    results.screenshots.push(`${OUT}/coarse-${w}-tabbar.png`);
    await coarse.close();
  }

  await browser.close();

  // Fine-pointer at sm+ must stay the compact desktop form (< 44px, ~36px).
  for (const w of [768, 1024]) {
    const fh = results.heights.find((r) => r.pointer === 'fine' && r.width === w && r.tab === 'games');
    record(fh && fh.height < 44, `[fine ${w}] tab button stays compact (< 44px)`, fh ? `${fh.height}px` : 'missing');
  }

  fs.writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 2));
  const failed = results.checks.filter((c) => !c.ok);
  console.log(`\n=== ${results.checks.length - failed.length}/${results.checks.length} checks passed ===`);
  if (failed.length) { console.log('FAILURES:'); failed.forEach((f) => console.log('  ' + f.label + '  ' + f.detail)); }
  process.exit(failed.length ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(2); });
