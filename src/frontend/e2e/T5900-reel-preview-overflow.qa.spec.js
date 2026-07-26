import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence } from './helpers/qa.js';

/**
 * T5900 - Reel draft PREVIEW: video must render INSIDE the modal panel, and no
 * artifact may remain on the originating tile after close.
 *
 * Defect A: the preview modal (backdrop + panel) is a DOM descendant of the
 * DraftTile, whose hover styles apply `transform`/`filter`. A transformed/filtered
 * ancestor becomes the containing block for `position: fixed` descendants, so the
 * fixed modal + its <video> resolve against the (small, off-centre) tile box
 * instead of the viewport -> video paints outside the panel.
 * Defect B: the same fixed-inside-transform subtree leaves a compositor paint
 * artifact (the purple scrub bar) on the tile after unmount.
 *
 * Fix: portal the modal to document.body so it escapes the tile subtree.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5900-reel-preview-overflow.qa.spec.js --reporter=line
 */

const REAL_EMAIL = 'imankh@gmail.com';
const PROFILE_ID = '9fa7378c';
const REPORTED = { width: 1012, height: 758 };

async function openReelDraftsWithPreview(page) {
  await page.goto('/home/reels');
  await page.waitForLoadState('domcontentloaded');
  // A completed draft tile owns a "Preview video" action (isComplete + final_video_id).
  const card = page
    .locator('[data-testid="project-card"]')
    .filter({ has: page.locator('button[title="Preview video"]') })
    .first();
  await expect(card, 'account must have >=1 completed draft to drive this spec').toBeVisible({ timeout: 20000 });
  return card;
}

test('T5900: preview video is contained in the panel + no tile artifact after close', async ({ context, page }) => {
  await page.setViewportSize(REPORTED);
  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

  const card = await openReelDraftsWithPreview(page);
  await card.scrollIntoViewIfNeeded();
  await card.hover();
  const previewBtn = card.locator('button[title="Preview video"]');
  await previewBtn.evaluate((el) => el.click());

  // The player mounts a <video> whose src is the stream endpoint.
  const video = page.locator('video[src*="/stream"]');
  await expect(video).toBeVisible({ timeout: 15000 });
  // Give the modal a beat to finish layout + first paint.
  await page.waitForTimeout(1200);

  await saveEvidence(page, 'T5900-A-preview-open-1012');

  const geo = await video.evaluate((v) => {
    const vr = v.getBoundingClientRect();
    // The modal panel is the nearest fixed ancestor with rounded corners.
    let el = v.parentElement;
    let panel = null;
    while (el) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed') { panel = el; break; }
      el = el.parentElement;
    }
    const pr = panel ? panel.getBoundingClientRect() : null;
    return {
      video: { left: vr.left, right: vr.right, top: vr.top, bottom: vr.bottom, width: vr.width },
      panel: pr ? { left: pr.left, right: pr.right, width: pr.width } : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
  console.log('[T5900] geometry @1012:', JSON.stringify(geo));

  // Defect A assertions: the video must sit inside the panel (and the viewport).
  expect(geo.panel, 'panel (fixed ancestor) must exist').not.toBeNull();
  expect(geo.video.right, 'video right edge must not overflow the viewport').toBeLessThanOrEqual(geo.vw + 1);
  expect(geo.video.left, 'video left edge must be within the panel').toBeGreaterThanOrEqual(geo.panel.left - 1);
  expect(geo.video.right, 'video right edge must be within the panel').toBeLessThanOrEqual(geo.panel.right + 1);

  // --- Defect B: close, then assert no artifact remains on the tile ---------
  await page.keyboard.press('Escape');
  await expect(video).toBeHidden({ timeout: 5000 });
  await page.waitForTimeout(400);
  // No stray player element (purple scrub bar) may survive outside a mounted player.
  const strayPlayers = await page.locator('video[src*="/stream"]').count();
  expect(strayPlayers, 'no player video may remain mounted after close').toBe(0);
  await card.scrollIntoViewIfNeeded();
  await saveEvidence(page, 'T5900-B-tile-after-close-1012');
});

test('T5900: sweep - preview contained at 390px and 1280px', async ({ context, page }) => {
  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
  for (const vp of [{ name: '390', width: 390, height: 780 }, { name: '1280', width: 1280, height: 800 }]) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    const card = await openReelDraftsWithPreview(page);
    await card.scrollIntoViewIfNeeded();
    await card.hover();
    await card.locator('button[title="Preview video"]').evaluate((el) => el.click());
    const video = page.locator('video[src*="/stream"]');
    await expect(video).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(1000);
    await saveEvidence(page, `T5900-sweep-${vp.name}`);
    const geo = await video.evaluate((v) => {
      const vr = v.getBoundingClientRect();
      return { right: vr.right, left: vr.left, vw: window.innerWidth };
    });
    console.log(`[T5900] geometry @${vp.name}:`, JSON.stringify(geo));
    expect(geo.right, `@${vp.name} video must not overflow viewport`).toBeLessThanOrEqual(geo.vw + 1);
    expect(geo.left, `@${vp.name} video left must be >= 0`).toBeGreaterThanOrEqual(-1);
    await page.keyboard.press('Escape');
    await expect(video).toBeHidden({ timeout: 5000 });
  }
});
