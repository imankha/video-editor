import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

// T6310 QA — the startup Games skeleton must mirror the loaded poster grid so
// data arriving does not snap the layout. We capture the SAME viewport in both
// states (skeleton forced via gamesDataStore.isLoading, then loaded) and assert
// the skeleton's container + tile geometry matches the real grid.

const forceLoading = (page, value) =>
  page.evaluate(async (v) => {
    const { useGamesDataStore } = await import('/src/stores/gamesDataStore.js');
    useGamesDataStore.setState({ isLoading: v });
  }, value);

async function gotoGames(page) {
  await page.goto('/home/games');
  await page.waitForLoadState('domcontentloaded');
  // Ensure the real grid has rendered at least once.
  await page.waitForSelector('[data-game-id]', { timeout: 30000 });
  // Boot preloader (#preloader) overlays the DOM while it fades; wait it out so
  // the forced-skeleton screenshots aren't captured under it.
  await page.locator('#preloader').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
}

test.describe('T6310 games skeleton mirrors the poster grid', () => {
  test('skeleton container + shells align with the loaded grid (desktop)', async ({ context, page }) => {
    await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoGames(page);

    // --- loaded grid geometry ---
    const loadedContainer = await page.locator('[data-game-id]').first()
      .evaluate((el) => {
        const grid = el.closest('.grid');
        const container = grid.parentElement.closest('.max-w-6xl, [class*="max-w-6xl"]') || grid.parentElement;
        const g = grid.getBoundingClientRect();
        const t = el.getBoundingClientRect();
        return { gridLeft: g.left, gridWidth: g.width, tileW: t.width, tileH: t.height };
      });
    await saveEvidence(page, 'T6310-criterion1-loaded-grid-desktop');

    // --- force skeleton at the SAME viewport ---
    await forceLoading(page, true);
    const skel = page.getByTestId('games-skeleton');
    await expect(skel).toBeVisible();
    const skelGeom = await skel.evaluate((root) => {
      const grid = root.querySelector('.grid');
      const shell = grid.querySelector('.aspect-video');
      const g = grid.getBoundingClientRect();
      const s = shell.getBoundingClientRect();
      return {
        gridLeft: g.left, gridWidth: g.width,
        shellW: s.width, shellH: s.height,
        shellCount: grid.querySelectorAll('.aspect-video').length,
      };
    });
    await saveEvidence(page, 'T6310-criterion1-skeleton-desktop');
    await forceLoading(page, false);

    // Container/grid geometry matches -> no horizontal snap when data arrives.
    expect(Math.abs(skelGeom.gridLeft - loadedContainer.gridLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(skelGeom.gridWidth - loadedContainer.gridWidth)).toBeLessThanOrEqual(1);
    // Shells are landscape 16:9, matching a GameTile's aspect-video tile.
    expect(skelGeom.shellH).toBeGreaterThan(0);
    expect(Math.abs(skelGeom.shellW / skelGeom.shellH - 16 / 9)).toBeLessThan(0.06);
    // Desktop is 6-up: default count fills exactly one row.
    expect(skelGeom.shellCount).toBe(6);
    // A skeleton shell is the same width as a real tile (same grid, same columns).
    expect(Math.abs(skelGeom.shellW - loadedContainer.tileW)).toBeLessThanOrEqual(2);
  });

  test('skeleton is 2-up with no ragged row at 375px', async ({ context, page }) => {
    await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoGames(page);
    await forceLoading(page, true);
    const skel = page.getByTestId('games-skeleton');
    await expect(skel).toBeVisible();
    const cols = await skel.evaluate((root) => {
      const shells = [...root.querySelectorAll('.aspect-video')];
      const topRowY = shells[0].getBoundingClientRect().top;
      // count shells sharing the first row's Y (2-up mobile)
      return shells.filter((s) => Math.abs(s.getBoundingClientRect().top - topRowY) < 2).length;
    });
    expect(cols).toBe(2); // 6 shells / 2 columns = 3 full rows, no ragged partial row
    await saveEvidence(page, 'T6310-criterion2-skeleton-375');
    await forceLoading(page, false);
  });

  test('responsive sweep: no horizontal overflow in the skeleton state', async ({ context, page }) => {
    await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
    await gotoGames(page);
    await forceLoading(page, true);
    await expect(page.getByTestId('games-skeleton')).toBeVisible();
    await responsiveSweep(page);
    await forceLoading(page, false);
  });
});
