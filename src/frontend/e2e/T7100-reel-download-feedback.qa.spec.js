/**
 * T7100 live-drive QA -- My Reel download feedback.
 *
 * Bug (user report): "when I download a myReel, I don't get sufficient user
 * feedback that I am downloading" -- the spinner lived inside the kebab menu,
 * which the click handler unmounted (setMenuOpen(false)) in the same
 * synchronous tick as firing the download, so it flashed for at most a frame.
 * Failures were ALSO 100% silent (downloadFile swallowed every error into an
 * `error` state nothing read).
 *
 * Approved treatment (docs/plans/tasks/T7100-reel-download-feedback.md,
 * user-approved 2026-08-16): the tile's bottom scrim takes over the metaLine
 * slot with "Preparing..."/"Downloading... N MB" and the kebab icon itself
 * swaps to a spinning Loader (forced full opacity) -- both survive the menu
 * closing because they're driven by DownloadsPanel's downloadingId/
 * downloadProgress state, not the menu's own mount. downloadFile now
 * re-throws on failure -> toast.error surfaces it for the first time.
 *
 * GET /api/downloads/{id}/file composes the whole file server-side (R2 fetch +
 * ffmpeg concat + metadata stamp) before the first byte and sends no
 * Content-Length, so this spec throttles the real response via page.route
 * (an artificial delay before route.continue()) purely to make the transient
 * "Preparing..." state observable/screenshottable -- the request itself is
 * genuine, not mocked, for the happy-path tests. The failure-path test DOES
 * fulfill a synthetic 500, since forcing a real backend failure isn't
 * practical from here.
 *
 * Run: bash scripts/dev-verify.sh e2e/T7100-reel-download-feedback.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openMyReelsAndExpand(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /Highlight Reels/i }).first().click();
  await expect(page.getByRole('heading', { name: /Highlight Reels|Library/i }).first())
    .toBeVisible({ timeout: 15000 });
  const panel = page.locator('.animate-slide-in-right');
  const alreadyShown = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (!alreadyShown) {
    const headers = panel.getByTestId('collapsible-group-header');
    await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
      await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
      const appeared = await panel.getByTestId('reel-card').first()
        .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
      if (appeared) break;
    }
  }
  return panel;
}

/** Clicks a reel tile's kebab -> Download menu item (desktop popover). */
async function clickDownload(tile) {
  await tile.hover();
  await tile.getByRole('button', { name: 'More actions' }).click();
  await tile.page().getByText('Download', { exact: true }).click();
}

test.describe('T7100 My Reel download feedback (real account) @staging-gate @gate-c', () => {
  test('criteria 1+2: scrim shows Preparing -> byte readout, kebab spins + forced-visible, both SURVIVE menu close, both revert on success', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    // Throttle the real download response so the transient "Preparing..."
    // state is reliably observable -- genuine request/response, just delayed.
    await page.route('**/api/downloads/*/file', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });

    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();

    await clickDownload(tile);

    // Scrim takes over the metaLine slot with "Preparing..." + kebab spins,
    // forced full opacity (no hover needed to see it).
    await expect(tile.getByText('Preparing…')).toBeVisible({ timeout: 5000 });
    const kebab = tile.getByRole('button', { name: 'More actions' });
    await expect(kebab.locator('.animate-spin')).toBeVisible();
    const kebabOpacity = await kebab.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(kebabOpacity, 'kebab forced fully visible while downloading, unhovered').toBeCloseTo(1, 1);
    await saveEvidence(page, 'T7100-criterion1-preparing-state');

    // Close the menu is already implicit (clicking the item closes it) --
    // explicitly move the mouse away too, to prove indicators are NOT
    // menu-mount-dependent (the original bug: the menu unmounting killed the
    // spinner in the same tick).
    await page.mouse.move(5, 5);
    await page.waitForTimeout(200);
    await expect(tile.getByText('Preparing…').or(tile.getByText(/Downloading…/)))
      .toBeVisible();
    await expect(kebab.locator('.animate-spin')).toBeVisible();
    await saveEvidence(page, 'T7100-criterion2-survives-menu-close');

    // Eventually reverts to the normal metaLine + MoreVertical icon on success.
    await expect(tile.getByText(/Preparing…|Downloading…/)).toBeHidden({ timeout: 60_000 });
    await expect(kebab.locator('.animate-spin')).toBeHidden();
    await saveEvidence(page, 'T7100-criterion-success-reverted');
    await context.close();
  });

  test('criterion 3: reopening the menu mid-download still shows the existing per-menu-item spinner/disabled state', async ({ browser }) => {
    test.setTimeout(120_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    await page.route('**/api/downloads/*/file', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();

    await clickDownload(tile);
    await expect(tile.getByText('Preparing…')).toBeVisible({ timeout: 5000 });

    // Reopen the kebab menu while the download is still in flight.
    await tile.getByRole('button', { name: 'More actions' }).click();
    const menuItem = page.getByText('Download', { exact: true }).locator('..');
    await expect(menuItem).toBeVisible();
    await expect(menuItem.locator('.animate-spin')).toBeVisible();
    const disabled = await menuItem.evaluate((el) => el.disabled);
    expect(disabled, 'the menu-item Download button is disabled mid-download').toBe(true);
    await saveEvidence(page, 'T7100-criterion3-menu-item-spinner-disabled');
    await context.close();
  });

  test('criterion 4 (CRITICAL, previously silent): a failed download surfaces toast.error and the tile reverts', async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    // Force a synthetic failure -- a real backend failure isn't practical to
    // trigger from here, but this proves the re-throw -> catch -> toast wiring.
    await page.route('**/api/downloads/*/file', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"forced failure"}' }),
    );

    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();

    await clickDownload(tile);

    // Downloads failed 100% silently before this task -- this is the whole point.
    await expect(page.getByText('Could not download reel')).toBeVisible({ timeout: 15000 });
    await saveEvidence(page, 'T7100-criterion4-failure-toast');

    // The tile un-sticks -- no permanently-stuck spinner after a failure.
    await expect(tile.getByText(/Preparing…|Downloading…/)).toBeHidden({ timeout: 5000 });
    const kebab = tile.getByRole('button', { name: 'More actions' });
    await expect(kebab.locator('.animate-spin')).toBeHidden();
    await saveEvidence(page, 'T7100-criterion4-tile-reverted-after-failure');
    await context.close();
  });

  test('criterion 5: no regression to the story-player download path (no unhandled rejection on failure)', async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();

    const pageErrors = [];
    page.on('pageerror', (err) => pageErrors.push(String(err)));

    const panel = await openMyReelsAndExpand(page);
    const hasReels = await panel.getByTestId('reel-card').first().isVisible().catch(() => false);
    test.skip(!hasReels, 'no published reels on this account/profile');
    const tile = panel.getByTestId('reel-card').first();

    await tile.getByRole('button', { name: 'Play video' }).click();
    await expect(page.locator('video').first()).toBeVisible({ timeout: 15000 });

    // Force the story-player's own download call to fail -- confirms the
    // fire-and-forget call site now catches instead of raising an unhandled
    // promise rejection (the T7100 regression risk flagged in the task file).
    await page.route('**/api/downloads/*/file', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"forced failure"}' }),
    );
    // IntroStoryPlayer shows the reel's OWN intro card first (if attached,
    // default ~4s -- IntroPreRoll.jsx) before switching to the 'reels' region
    // that mounts CollectionPlayer (and its Download button); wait for that
    // region switch generously rather than racing a fixed short timeout.
    // NOTE: `collection-player-backdrop` is an EMPTY, aria-hidden sibling div
    // (the click-swallowing overlay, CollectionPlayer.jsx:249-256) -- the
    // actual toolbar lives in the sibling `role="dialog"` panel.
    const player = page.getByRole('dialog');
    await player.waitFor({ state: 'visible', timeout: 15000 });
    const downloadBtn = player.getByRole('button', { name: /^Download$/i });
    const hasDownloadBtn = await downloadBtn.waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true).catch(() => false);
    test.skip(!hasDownloadBtn, 'story player download control not present in this build');
    await downloadBtn.click();

    await expect(page.getByText('Could not download reel')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(500);
    expect(pageErrors, `no unhandled promise rejection / page error: ${pageErrors.join('; ')}`).toEqual([]);
    await saveEvidence(page, 'T7100-criterion5-story-player-no-unhandled-rejection');
    await context.close();
  });
});
