import { test, expect } from '@playwright/test';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

/**
 * T9110 QA evidence — Overlay's post-export completion preview + publish-exit
 * action bar (the Overlay sibling of T8390's Focus flow). A plain overlay export
 * mounts the SAME preview-player shell (CollectionPlayer) with an
 * OverlayPublishActionBar footer. T9590 (2026-09-10) re-hierarchized it: a
 * dominant PRIMARY (Publish) + two graded cards (Reapply spotlight, Reapply AI
 * Focus) + a quiet Save-draft link OUTSIDE the card grid (was "Publish Later").
 *
 * WHY A DIAG HARNESS (t9110diag.html), NOT the real flow: identical reasoning to
 * T8520-T8530's spec — a real end-to-end run needs an uploaded game, annotated
 * clips, and a real Focus + Overlay render, infeasible in this container (Modal
 * disabled; the dev-login account has zero seeded projects). The harness mounts
 * the REAL CollectionPlayer + REAL OverlayPublishActionBar; only the "an export
 * just finished" premise + the video source are synthetic.
 *
 * The load-bearing assertions here are the LIVE DOM MEASUREMENTS the two T8390
 * landmines demand (carried through the T9590 restructure):
 *   1. No title ever wraps / the row never overflows at sm: and up — proven by
 *      the grid's own scrollWidth <= clientWidth at 768/1024/1280, i.e. the
 *      min-content column floor holds and no nowrap title is forcing a scrollbar.
 *   2. The single-row (now 3-across) stage is gated at lg: (1024px), NOT sm: —
 *      proven by counting the resolved grid-template-columns tracks: 1 below lg,
 *      3 at 1024 and up.
 *
 * Run:
 *   bash scripts/dev-verify.sh e2e/T9110-overlay-publish-exit.spec.js --reporter=line
 */

skipOnDeployedTarget(
  test,
  'drives t9110diag.html dev-only harness (not in rollupOptions.input; 404 on a deployed CF Pages build)'
);

// The three IN-GRID choices (Save draft is a quiet link outside the card grid).
const LABELS = ['Publish', 'Reapply spotlight', 'Reapply AI Focus'];

// Count resolved grid-template-columns tracks (each track resolves to a px
// value, so the token count == the column count). The measurement the task
// names explicitly for the breakpoint landmine.
async function gridColumnCount(bar) {
  return bar.evaluate((el) => {
    const grid = el.querySelector(':scope > div');
    const cols = getComputedStyle(grid).gridTemplateColumns.trim();
    return cols.split(/\s+/).filter(Boolean).length;
  });
}

// The grid must never overflow its own box horizontally (scrollWidth <=
// clientWidth). This is what actually catches a too-narrow column forcing a
// nowrap title to overflow — the failure mode both landmines share.
async function gridOverflowPx(bar) {
  return bar.evaluate((el) => {
    const grid = el.querySelector(':scope > div');
    return grid.scrollWidth - grid.clientWidth;
  });
}

test.describe('T9110: Overlay post-export completion preview + publish-exit action bar', () => {
  test('preview mounts with the hierarchy (dominant Publish + graded cards + quiet Save draft); each fires + closes', async ({ page }) => {
    await page.goto('/t9110diag.html');
    await page.waitForLoadState('domcontentloaded');

    const player = page.getByTestId('collection-player-video');
    await expect(player).toBeVisible();
    const bar = page.getByTestId('overlay-publish-action-bar');
    await expect(bar).toBeVisible();

    for (const name of LABELS) {
      await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // The quiet Save-draft link is present but OUTSIDE the card grid.
    await expect(page.getByTestId('overlay-save-draft')).toBeVisible();
    // Publish is the dominant PRIMARY (its card is the tinted/ringed cyan one).
    await expect(page.getByTestId('overlay-choice-primary').getByRole('button', { name: 'Publish', exact: true })).toBeVisible();
    // Reapply AI Focus carries the honest paid-re-export cost warning caption.
    await expect(bar.getByText(/uses credits/i)).toBeVisible();
    await saveEvidence(page, 'T9110-criterion-preview-actionbar-desktop');

    // Publish -> confirming toast + closes.
    await bar.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-last-action', 'publish-now');
    await expect(page.getByText('Published', { exact: false })).toBeVisible();

    // Reapply AI Focus -> its own confirming toast + closes.
    await page.getByTestId('diag-reopen').click();
    await page.getByTestId('overlay-publish-action-bar').getByRole('button', { name: 'Reapply AI Focus', exact: true }).click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-last-action', 'reapply-focus');
    await expect(page.getByText('Spotlight saved')).toBeVisible();

    // Save draft -> explainer toast (multi-clip copy — harness default) + closes.
    await page.getByTestId('diag-reopen').click();
    await page.getByTestId('overlay-save-draft').click();
    await expect(page.getByTestId('status')).toHaveAttribute('data-last-action', 'publish-later');
    await expect(page.getByText('Saved to Highlight Reels, under Highlights')).toBeVisible();
  });

  test('LIVE DOM measurement: no title wraps / no row overflow at sm:+; single row gated at lg: (1024), not sm:', async ({ page }) => {
    await page.goto('/t9110diag.html');
    await page.waitForLoadState('domcontentloaded');
    const bar = page.getByTestId('overlay-publish-action-bar');
    await expect(bar).toBeVisible();

    // Landmine #2 — the exact breakpoint the task calls out: verify the resolved
    // column count at each width, NOT just one large viewport. 3-across only at lg+.
    const expectedColumns = [
      { width: 375, height: 812, cols: 1, name: '375' },
      { width: 768, height: 1024, cols: 1, name: '768-ipad-portrait' },
      { width: 1024, height: 768, cols: 3, name: '1024' },
      { width: 1280, height: 800, cols: 3, name: '1280' },
    ];

    for (const vp of expectedColumns) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(150);

      // Resolved grid-template-columns track count == column count.
      const cols = await gridColumnCount(bar);
      expect(cols, `grid has ${vp.cols} columns at ${vp.name}px`).toBe(vp.cols);

      // Landmine #1 — the grid never overflows its own box (a too-narrow column
      // forcing a nowrap title to overflow would show up here as > 0). Verified
      // live at 768/1024/1280 (and 375), per the task's mandate.
      const overflow = await gridOverflowPx(bar);
      expect(overflow, `grid does not overflow horizontally at ${vp.name}px`).toBeLessThanOrEqual(1);

      // Document-level: no horizontal scrollbar anywhere.
      await assertNoHorizontalOverflow(page);

      // Every title is a single, fully-visible line (not clipped by its column):
      // the nowrap span's scrollWidth must fit its own rendered width.
      for (const name of LABELS) {
        const span = bar.getByText(name, { exact: true });
        await expect(span).toBeVisible();
        const clipped = await span.evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(clipped, `title "${name}" is not clipped at ${vp.name}px`).toBeLessThanOrEqual(1);
      }

      await saveEvidence(page, `T9110-criterion-actionbar-${vp.name}`);
    }
  });

  test('X / Escape maps to Reapply Spotlight (nevermind, no toast side effect)', async ({ page }) => {
    await page.goto('/t9110diag.html');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('overlay-publish-action-bar')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('status')).toHaveAttribute('data-last-action', 'reapply-overlay');
  });

  test('Save draft toast: single-clip copy when is_auto_created', async ({ page }) => {
    await page.goto('/t9110diag.html#isAutoCreated=1');
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('overlay-save-draft').click();
    await expect(page.getByText('Saved to Clips')).toBeVisible();
    await saveEvidence(page, 'T9110-criterion-single-clip-toast');
  });
});
