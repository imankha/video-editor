import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17660: the Add video window quotes one total for every selected video, and the
 * account loses exactly that total once they are added (QA saw "Cost: 2 credits"
 * and a 4-credit deduction for two small videos).
 *
 * Each run adds two REAL small videos to a ready game through the Add video window:
 * the 2 s H.264 fixture from T17500 with a unique trailing MP4 `free` box, so every
 * file has a new hash (a re-added hash is deduped and charged nothing, which would
 * hide the bug). The balance is read through the API before and after.
 */
test.setTimeout(300000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const H264 = fs.readFileSync(path.join(__dirname, 'fixtures', 'T17500-h264.mp4'));

function uniqueVideo(name) {
  const pad = crypto.randomBytes(16);
  const box = Buffer.alloc(8);
  box.writeUInt32BE(8 + pad.length, 0);
  box.write('free', 4, 'ascii');
  return { name, mimeType: 'video/mp4', buffer: Buffer.concat([H264, box, pad]) };
}

// The app has its own session in the page by now, so call the API from inside it (T16100).
async function pageApi(page, p) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { status: res.status, body: await res.json().catch(() => null) };
  }, checkApi(p));
}

async function balance(page) {
  const res = await pageApi(page, '/credits');
  expect(res.status, `/credits -> ${res.status}`).toBe(200);
  return res.body.balance;
}

// Open a ready game whose source is still stored, so Add video is enabled.
async function openAddVideo(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await disableGuidanceForCheck(page);
  // A cold stack can still be starting the session ("Connecting to server"): wait for the list.
  let games = [];
  await expect.poll(async () => {
    const res = await pageApi(page, '/games');
    games = res.status === 200 ? (res.body.games || []).filter((g) => g.storage_status === 'active') : [];
    return games.length;
  }, { timeout: 150000 }).toBeGreaterThan(0);
  const btn = page.getByTestId('add-footage-button');
  for (const g of games.slice(0, 6)) {
    await page.evaluate((id) => sessionStorage.setItem('pendingGameId', String(id)), g.id);
    await page.goto('/annotate');
    await disableGuidanceForCheck(page);
    // Add video shows only with the playhead outside every play, and the app selects a
    // play while the game loads (more than once on a slow stack): whenever Edit play is
    // showing, click an empty stretch of the plays track, as a parent does, until Add
    // video is there and enabled (it stays disabled until the game's /load answers).
    const track = page.locator('[data-testid="clip-track"]:visible, [data-testid="clip-track-mobile"]:visible').first();
    const editPlay = page.getByTestId('annotate-primary-cta');
    let tries = 0;
    const ready = await expect.poll(async () => {
      if (await editPlay.count()) {
        const box = await track.boundingBox().catch(() => null);
        const at = [0.5, 0.4, 0.6, 0.7, 0.3][tries++ % 5];
        if (box) await page.mouse.click(box.x + box.width * at, box.y + box.height / 2);
        return false;
      }
      return (await btn.isVisible()) && (await btn.isEnabled());
    }, { timeout: 120000, intervals: [2000] }).toBe(true).then(() => true, () => false);
    if (ready && !(await editPlay.count())) {
      await btn.click();
      return;
    }
    console.log(`[T17660] game ${g.id}: Add video stayed disabled (source not loadable); trying the next`);
  }
  throw new Error('no ready game with a stored source to add videos to');
}

// The quoted total, read from the cost line once it is on screen (not clipped).
async function readQuotedCost(page) {
  const costLine = page.getByText(/^Cost: \d+ credits?$/).first();
  await expect(costLine).toBeVisible();
  await costLine.scrollIntoViewIfNeeded();
  await expect(costLine).toBeInViewport();
  return Number((await costLine.textContent()).match(/\d+/)[0]);
}

// Select two new videos in the open Add video window; returns the balance before.
async function selectTwoVideos(page) {
  const before = await balance(page);
  await page.getByTestId('footage-file-input').setInputFiles([
    uniqueVideo('T17660-first.mp4'),
    uniqueVideo('T17660-second.mp4'),
  ]);
  await expect(page.getByTestId('add-footage-submit')).toBeEnabled({ timeout: 60000 });
  return before;
}

// Confirm, wait for both videos to be added, and require the balance to drop by `quoted`.
async function confirmAndCompare(page, before, quoted) {
  const submit = page.getByTestId('add-footage-submit');
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  await expect(submit).toHaveCount(0, { timeout: 180000 }); // the window closes once both are added
  await expect.poll(() => balance(page), { timeout: 60000 }).toBe(before - quoted);
}

const VIEWPORTS = [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
  ['desktop', { width: 1440, height: 900 }],
];

test.describe('T17660 the Add video total equals the credits taken', () => {
  test('T17660:C1 two selected videos: the shown total is what the balance loses', async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginForCheck(context);
    await openAddVideo(page);
    const before = await selectTwoVideos(page);
    await confirmAndCompare(page, before, await readQuotedCost(page));
  });

  test('T17660:C3 phone, tablet and desktop show the same total before confirming, and it is what is taken', async ({ context, page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginForCheck(context);
    await openAddVideo(page);
    const before = await selectTwoVideos(page);
    const quotes = {};
    for (const [label, viewport] of VIEWPORTS) {
      await page.setViewportSize(viewport);
      quotes[label] = await readQuotedCost(page);
    }
    expect(new Set(Object.values(quotes)).size, `quoted totals ${JSON.stringify(quotes)}`).toBe(1);
    await page.setViewportSize({ width: 390, height: 844 }); // confirm on the phone layout
    await confirmAndCompare(page, before, quotes.phone);
  });
});
