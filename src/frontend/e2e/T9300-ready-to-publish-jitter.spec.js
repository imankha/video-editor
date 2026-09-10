import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence } from './helpers/qa.js';

/**
 * T9300 — the "Ready to Publish" clip card visually twitched/jittered on mobile.
 *
 * Root cause (supervisor live-repro, 390x844, real account): CardCarousel measured
 * tile width with getBoundingClientRect().width, which REFLECTS CSS transforms. A
 * mobile tap/press puts the tile into a sticky :hover, easing DraftTile's
 * `hover:scale-[1.03] transition-all`; the transformed width then drifts sub-pixel
 * every frame, flipping pickPeekGap/fillerFits across a threshold, and the no-deps
 * post-render effect re-fires setGap/setFillerVisible each flip -> React "Maximum
 * update depth exceeded", logged continuously (250+ in <4s). Fix: measure the
 * untransformed layout box (offsetWidth).
 *
 * This spec reproduces the trigger (hover + pointer-hold on a Ready-to-Publish tile)
 * and asserts ZERO "Maximum update depth" console errors — the live half of the fix
 * (a unit test alone can't see the transform-driven loop).
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T9300-ready-to-publish-jitter.spec.js
 */
const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';

test('T9300 holding a Ready-to-Publish tile does not trigger a render loop', async ({ context, page }) => {
  test.setTimeout(180000);

  // Capture React's "Maximum update depth exceeded" — the loop's fingerprint.
  const updateDepthErrors = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/Maximum update depth exceeded/i.test(text)) updateDepthErrors.push(text);
  });

  await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

  // Real mobile viewport (matches the report + supervisor repro).
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const clipsTab = page.locator('button:has-text("Clips")');
  await expect(clipsTab, 'Clips tab renders').toBeVisible({ timeout: 30000 });
  await clipsTab.click();
  await page.waitForTimeout(800); // let carousels + posters settle

  // The Ready-to-Publish carousel: CardCarousel aria-label carries the stage label.
  const readyRow = page.locator('[role="group"][aria-label*="Ready to Publish"]').first();
  await expect(readyRow, 'a "Ready to Publish" carousel row is present').toBeVisible({ timeout: 30000 });

  const tiles = readyRow.locator('[data-testid="project-card"]');
  const tileCount = await tiles.count();
  expect(tileCount, 'Ready-to-Publish row has at least one tile').toBeGreaterThan(0);

  // The report was the SECOND card; hold whichever slot exists (prefer slot 1).
  const target = tileCount > 1 ? tiles.nth(1) : tiles.first();
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, 'target tile has a layout box').toBeTruthy();

  // Reproduce the trigger: move the pointer over the tile (sticky :hover -> the
  // scale transition begins easing) and HOLD the press for well over the loop's
  // observed 4s window, so any render loop would log dozens of errors.
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(5000);
  await page.mouse.up();
  await page.waitForTimeout(300);

  await saveEvidence(page, 'T9300-ready-to-publish-hold');

  expect(
    updateDepthErrors.length,
    `no "Maximum update depth" console errors while holding the tile (saw ${updateDepthErrors.length})`,
  ).toBe(0);
});
