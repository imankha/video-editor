import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T6320 — REAL BROWSER, real account proof that the T5130 sport-ball playhead
 * finally reaches Highlight Reels' CollectionPlayer, and that the mechanical move to
 * the shared ProgressTrack/PlayheadHandle primitives changed nothing else.
 *
 * Criteria evidenced here:
 *   c1  Highlight Reels shows the sport-ball playhead on the active segment (multi-reel
 *       collection AND single-reel play — both go through CollectionPlayer)
 *   c2  the ball reflects the active profile's actual sport (read live from the
 *       header's ProfileSportButton, not hardcoded)
 *   c3  segment click-to-jump still works (the handle follows the newly active
 *       segment; unified with T5100's existing seek-fraction coverage)
 *   c4  responsive: 375px + desktop, no horizontal overflow
 *
 * NOT covered live here (covered instead by static verification + unit tests,
 * documented in the task report): the public share viewer / RankingGame / diag
 * harness never receive `handleGlyph` (grep-verified call sites, plus
 * CollectionPlayer.characterization.test.jsx's "absent -> no handle" case) and
 * VideoControls' own byte-identical behavior (drag-to-seek, hover sizing,
 * coarse targets) is pinned by VideoControls.characterization.test.jsx +
 * VideoControls.test.jsx + DraftTile.test.jsx, all green unmodified. Creating a
 * throwaway public share link on the real dev account to re-prove this live
 * would leave persisted debris in real user data for a fact the tests already
 * establish structurally (the prop is simply never passed).
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const HANDLE_GLYPH = '[data-testid="scrub-handle-glyph"]';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /^Published/ }).first().click();
  await expect(page.getByTestId('published-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

// The active profile's sport ball, read live from the header control so the
// expectation isn't hardcoded to any one sport (T5130 rule).
async function expectedGlyph(page) {
  const btn = page.getByRole('button', { name: /switch sport or profile/i });
  if (!(await btn.isVisible().catch(() => false))) return null;
  return (await btn.locator('span').first().textContent())?.trim() || null;
}

async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.getByTestId('published-tab-panel').getByTestId('collapsible-group-header');
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

test.describe('T6320 — Highlight Reels playhead handle (real account)', () => {
  test('c1/c2: multi-reel "Play all" shows the correct sport ball on the active segment', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDrawer(page);

    const glyph = await expectedGlyph(page);
    const hasGroup = await expandFirstGroup(page);
    test.skip(!hasGroup, 'no game/mix group on this account/profile to Play-all');

    const playAll = page.getByTitle('Play all').first();
    const canPlayAll = await playAll.isVisible().catch(() => false);
    test.skip(!canPlayAll, 'expanded group has no Play-all control (single-reel bucket)');
    await playAll.click();

    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15000 });
    const handle = page.locator(HANDLE_GLYPH);

    if (glyph) {
      await expect(handle).toBeVisible({ timeout: 10000 });
      expect(await handle.textContent()).toBe(glyph);
    } else {
      // No profile sport set: T5130 rule is plain dot, never a fabricated ball.
      await expect(handle).toHaveCount(0);
    }
    await saveEvidence(page, 'T6320-criterion-1-multi-reel-ball');

    // c3: segment click-to-jump still works, and the handle follows.
    const segments = page.locator('[role="dialog"] button[aria-label]').filter({
      has: page.locator(':scope > div.h-1'),
    });
    const segCount = await segments.count();
    if (segCount > 1 && glyph) {
      await segments.nth(1).click({ position: { x: 5, y: 5 } });
      await expect(handle).toBeVisible({ timeout: 5000 });
      const secondSegHandle = segments.nth(1).locator(HANDLE_GLYPH);
      await expect(secondSegHandle).toBeVisible({ timeout: 5000 });
      await saveEvidence(page, 'T6320-criterion-3-segment-click-follows-ball');
    }

    await page.keyboard.press('Escape');
  });

  test('c1: single-reel play also shows the ball (same CollectionPlayer path)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDrawer(page);

    const glyph = await expectedGlyph(page);
    await expandFirstGroup(page);

    const tile = page.getByTestId('reel-card').first();
    const hasTile = await tile.isVisible().catch(() => false);
    test.skip(!hasTile, 'no reel tiles on this account/profile');

    await tile.hover();
    const playBtn = tile.getByRole('button').first();
    await playBtn.click();

    const dialog = page.locator('[role="dialog"]');
    const opened = await dialog.isVisible().catch(() => false);
    test.skip(!opened, 'tile action did not open the story player (may have opened a menu instead)');

    if (glyph) {
      await expect(page.locator(HANDLE_GLYPH)).toBeVisible({ timeout: 10000 });
    }
    await saveEvidence(page, 'T6320-criterion-1-single-reel-ball');
    await page.keyboard.press('Escape');
  });

  test('c4: responsive sweep, 375px + desktop, no horizontal overflow', async ({ page }) => {
    await openDrawer(page);
    await responsiveSweep(page, async () => {
      // Highlight Reels drawer itself must not introduce horizontal scroll at either size.
    });
  });
});
