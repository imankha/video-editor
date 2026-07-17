import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T5100 QA — compilation timeline: hover a reel segment for its name, click to
 * jump + seek. Data-independent: drives the PUBLIC share viewer route
 * (/shared/collection/{token}, no auth) which feeds the SAME shared
 * CollectionPlayer used by the author gallery (DownloadsPanel). The resolve API
 * is network-mocked and the presigned URLs are routed to a REAL sample mp4, so
 * the <video> reports a real live duration and the seek assertion is meaningful.
 *
 * The mocked members intentionally OMIT `duration`, so reel.duration is null on
 * every reel — proving the seek uses the element's live duration, not the frozen
 * one (acceptance criterion: null frozen duration still seeks).
 *
 * Run: cd src/frontend && npx playwright test e2e/T5100-timeline-seek.qa.spec.js
 * or:  bash scripts/dev-verify.sh e2e/T5100-timeline-seek.qa.spec.js
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_MP4 = path.resolve(__dirname, '..', '..', 'landing', 'public', 'before_after_demo.mp4');

const TOKEN = 'abcdef01-2345-6789-abcd-ef0123456789';
const URL = `/shared/collection/${TOKEN}`;

// 3 reels, landscape, NO frozen duration (tests the null-duration seek path).
const MEMBERS = [
  { id: 1, name: 'Reel One', presigned_url: 'https://r2.example/reel1.mp4' },
  { id: 2, name: 'Reel Two', presigned_url: 'https://r2.example/reel2.mp4' },
  { id: 3, name: 'Reel Three', presigned_url: 'https://r2.example/reel3.mp4' },
];

async function mockCollection(page) {
  // Resolve API -> 3-reel landscape collection.
  await page.route(`**/api/shared/collection/${TOKEN}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        title: 'My Reels',
        context_line: 'This link always shows the current reels for this game.',
        aspect_ratio: '16:9',
        members: MEMBERS,
      }),
    }));
  // Every presigned reel URL -> the real sample mp4, served with HTTP Range
  // support (206) exactly like a real R2 presigned URL, so the browser reads the
  // moov atom and reports the TRUE duration at loadedmetadata (a plain 200 gives
  // a progressive duration estimate that makes the seek land early).
  const bytes = fs.readFileSync(SAMPLE_MP4);
  await page.route('https://r2.example/**', (route) => {
    const range = route.request().headers()['range'];
    const match = range && /bytes=(\d+)-(\d*)/.exec(range);
    if (match) {
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : bytes.length - 1;
      const chunk = bytes.subarray(start, end + 1);
      return route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': String(chunk.length),
        },
        body: chunk,
      });
    }
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': String(bytes.length) },
      body: bytes,
    });
  });
}

// Poll the single <video> element for a known live duration.
async function waitForDuration(page) {
  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && v.duration > 0 && isFinite(v.duration);
  }, { timeout: 15000 });
  return page.evaluate(() => document.querySelector('video').duration);
}

test.describe('T5100 compilation timeline seek + hover', () => {
  test('hover a segment shows the reel name (criterion 1)', async ({ page }) => {
    await mockCollection(page);
    await page.goto(URL);
    await waitForDuration(page);

    const seg3 = page.getByRole('button', { name: 'Reel Three' });
    await expect(seg3).toBeVisible();
    // Tooltip text is not present until hover.
    await expect(page.getByText('Reel Three', { exact: true })).toHaveCount(0);
    await seg3.hover();
    await expect(page.getByText('Reel Three', { exact: true })).toBeVisible();
    await saveEvidence(page, 'T5100-criterion1-hover-tooltip');
  });

  test('click a segment loads that reel and seeks to the clicked fraction (criteria 2 + 5)', async ({ page }) => {
    await mockCollection(page);
    await page.goto(URL);
    const duration = await waitForDuration(page);
    const clickFrac = async (label, frac) => {
      const box = await page.getByRole('button', { name: label }).boundingBox();
      await page.mouse.click(box.x + box.width * frac, box.y + box.height / 2);
    };
    const ct = () => page.evaluate(() => document.querySelector('video').currentTime);

    // (1) LOAD PATH: clicking a non-active segment switches reels AND seeks once
    // the freshly-loaded element reports a duration. The mocked reels omit a
    // frozen duration, so this can only work off the element's LIVE duration.
    await clickFrac('Reel Three', 0.6);
    await expect(page.getByText('Reel Three', { exact: true }).first()).toBeVisible(); // reel 3 active
    // Generous band: a progressively-loaded asset can report a not-yet-final
    // duration at the instant the pending seek applies; still excludes "no seek".
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.currentTime > v.duration * 0.4;
    }, undefined, { timeout: 8000 });
    console.log(`[T5100] load-path: duration=${duration.toFixed(2)}s currentTime=${(await ct()).toFixed(2)}s`);
    await saveEvidence(page, 'T5100-criterion2-click-seek');

    // (2) IMMEDIATE PATH: reel 3 is now the active, fully-probed element (stable
    // duration). Clicking its segment again seeks immediately with no reload, so
    // the fraction->position math is exact — a tight check that clicking 25%
    // lands at ~25% (and not 60%), proving the click fraction truly drives it.
    await page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && Math.abs(v.duration - 11.47) < 0.05; // settled final duration
    }, undefined, { timeout: 8000 });
    const stableDur = await page.evaluate(() => document.querySelector('video').duration);
    await clickFrac('Reel Three', 0.25);
    await page.waitForFunction((d) => {
      const v = document.querySelector('video');
      return v && v.currentTime > d * 0.24 && v.currentTime < d * 0.34;
    }, stableDur, { timeout: 8000 });
    const precise = await ct();
    console.log(`[T5100] immediate-path: duration=${stableDur.toFixed(2)}s currentTime=${precise.toFixed(2)}s (target ~${(stableDur * 0.25).toFixed(2)}s)`);
    expect(precise).toBeGreaterThan(stableDur * 0.24);
    expect(precise).toBeLessThan(stableDur * 0.34); // +tolerance for playback advancing after the seek
  });

  test('thin bars have an enlarged hit target (criterion 3)', async ({ page }) => {
    await mockCollection(page);
    await page.goto(URL);
    await waitForDuration(page);

    const seg1 = page.getByRole('button', { name: 'Reel One' });
    const box = await seg1.boundingBox();
    // Visible bar is 4px; the clickable target is padded to ~16px+.
    expect(box.height).toBeGreaterThanOrEqual(16);
    // cursor-pointer signals interactivity.
    const cursor = await seg1.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('pointer');
    await saveEvidence(page, 'T5100-criterion3-hit-area');
  });

  test('responsive at 375px + desktop (no overflow)', async ({ page }) => {
    await mockCollection(page);
    await page.goto(URL);
    await waitForDuration(page);
    await responsiveSweep(page);
  });
});
