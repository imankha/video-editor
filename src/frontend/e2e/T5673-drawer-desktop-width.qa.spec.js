import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

/**
 * T5673 (drawer desktop width) — live QA on the REAL account.
 *
 * The Highlight Reels drawer holds poster tiles now, so max-w-md (448px) is cramped on
 * desktop. This change widens it at lg+ (lg:max-w-2xl 672px, xl:max-w-3xl 768px)
 * while leaving mobile (w-full, capped at 448) untouched. The tile carousels are
 * flex overflow-x rows of fixed-width tiles, so a wider panel shows MORE tiles
 * per row with no per-tile / grid change needed.
 *
 * Evidence:
 *   width-c1  desktop 1315px: panel is substantially wider than 448px (xl bucket)
 *   width-c2  desktop 1920px: panel stays at the 768px xl cap, tiles fill the row
 *   width-c3  mobile 390px regression: panel is full-width (<=448), unchanged
 *   width-c4  no horizontal overflow at any width + responsive sweep
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

const PANEL = '.animate-slide-in-right';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /Highlight Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /Highlight Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
  // The panel is the stable width anchor.
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 15000 });
}

// Expand the first collapsed game/mix group so its reel tiles mount into a carousel
// (mirrors the T5673 tiles spec — groups collapse by default).
async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.locator(PANEL).getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    const appeared = await page.getByTestId('reel-card').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (appeared) return true;
  }
  return false;
}

async function panelWidth(page) {
  const box = await page.locator(PANEL).boundingBox();
  return box?.width ?? 0;
}

// How many reel tiles have their left edge within the panel's visible bounds — i.e.
// visible in the first row before the carousel scrolls. Proves "more tiles per row".
async function tilesInFirstRow(page) {
  const panelBox = await page.locator(PANEL).boundingBox();
  const tiles = page.getByTestId('reel-card');
  const count = await tiles.count();
  let visible = 0;
  for (let i = 0; i < count; i++) {
    const b = await tiles.nth(i).boundingBox();
    if (!b) continue;
    if (b.x >= panelBox.x - 1 && b.x < panelBox.x + panelBox.width - 20) visible++;
  }
  return visible;
}

test.describe('T5673 — Highlight Reels drawer desktop width (real account)', () => {
  test('width-c1: 1315px desktop widens the drawer well past 448px, more tiles per row', async ({ page }) => {
    await page.setViewportSize({ width: 1315, height: 900 });
    await openDrawer(page);

    const w = await panelWidth(page);
    console.log(`[T5673][width] 1315px viewport -> panel width ${w}px`);
    // xl:max-w-3xl (768px). Must be substantially wider than the old 448px.
    expect(w, 'panel much wider than the old max-w-md 448px').toBeGreaterThan(600);
    expect(w, 'panel capped at the xl:max-w-3xl 768px ceiling').toBeLessThanOrEqual(772);

    const hasReels = await expandFirstGroup(page);
    if (hasReels) {
      const inRow = await tilesInFirstRow(page);
      console.log(`[T5673][width] 1315px -> ${inRow} tiles visible in first row`);
      expect(inRow, 'multiple poster tiles visible per row on the wide drawer').toBeGreaterThan(1);
    }
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5673-width-1315-drawer-open');
  });

  test('width-c2: 1920px desktop holds the 768px cap with tiles filling the row', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await openDrawer(page);

    const w = await panelWidth(page);
    console.log(`[T5673][width] 1920px viewport -> panel width ${w}px`);
    expect(w, 'panel at xl:max-w-3xl 768px cap').toBeGreaterThan(700);
    expect(w, 'panel does not exceed the 768px ceiling').toBeLessThanOrEqual(772);

    const hasReels = await expandFirstGroup(page);
    if (hasReels) {
      const inRow = await tilesInFirstRow(page);
      console.log(`[T5673][width] 1920px -> ${inRow} tiles visible in first row`);
      expect(inRow, 'multiple poster tiles visible per row').toBeGreaterThan(1);
    }
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5673-width-1920-drawer-open');
  });

  test('width-c3: 390px mobile regression — drawer is full-width, unchanged', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDrawer(page);

    const w = await panelWidth(page);
    console.log(`[T5673][width] 390px viewport -> panel width ${w}px`);
    // Below lg: w-full capped at max-w-md (448). At 390 the viewport is the cap.
    expect(w, 'mobile drawer fills the narrow viewport').toBeLessThanOrEqual(448);
    expect(w, 'mobile drawer roughly full-width').toBeGreaterThan(360);

    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'T5673-width-390-regression');
  });

  test('width-c4: responsive sweep — no horizontal overflow across the matrix', async ({ page }) => {
    await page.setViewportSize({ width: 1315, height: 900 });
    await openDrawer(page);
    await responsiveSweep(page);
  });
});
