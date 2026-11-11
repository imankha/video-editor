/**
 * T15740 - per-criterion acceptance checks (group checks protocol).
 *
 * Bug, found by the 2026-11-09 staging QA pass: the "Your highlight is ready" completion
 * toast (ToastContainer, rendered inside the fixed bottom-right `CornerStack`) sat over the
 * editor's action band and under the floating "Report a problem" corner button (the "chat
 * bubble") at desktop sizes with a tall action band (Focus's short-desktop "above" row for
 * Trim/SlowMo). Root cause: CornerStack's bottom offset was a static guess (`bottom-4
 * lg:bottom-20`) instead of tracking the band's real published height (`--cta-bar-h`, set by
 * ActionBand's useCtaBarHeight) -- a tall band could exceed the guessed clearance.
 *
 * C1 drives the real CornerStack/ToastContainer/Report-button DOM on the Home screen (no
 * editor video needed -- this sandbox's R2-signed-URL fetches are unreliable, see T15400/
 * T15470/T15650 notes) and reproduces the exact tall-band measurement this bug needs: it sets
 * `--cta-bar-h` to 233px, the real height measured live on Focus at 1366x660 with the
 * Trim/SlowMo row showing (ActionBand.jsx's own useCtaBarHeight is what publishes this var in
 * production; this check exercises CornerStack's consumption of it, which is the regressed
 * contract). It fires the exact production `toast.success` call GlobalExportIndicator makes on
 * completion, then asserts neither the toast nor the Report button sit inside the band's
 * reserved footprint.
 *
 * C2 reproduces "re-shown on every reload" by injecting a completed export, dismissing the
 * toast via its real Dismiss button (persists the export id via T15740's
 * dismissedExportToasts util), reloading the page, and re-injecting the SAME completed export
 * -- the toast must not reappear.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15740.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

// The real height measured on Focus at 1366x660 with the Trim/SlowMo "above" row showing
// (band top y=426.75, viewport height 660).
const TALL_BAND_HEIGHT_PX = 233;

async function fireCompletionToast(page, { exportId = 'check-export-1', projectName = 'Probe Reel' } = {}) {
  return page.evaluate(async ({ exportId: id, projectName: name }) => {
    const { toast } = await import('/src/components/shared/Toast.jsx');
    const { rememberDismissedExportToast } = await import('/src/utils/dismissedExportToasts.js');
    toast.success('Highlight ready', {
      message: name,
      duration: 8000,
      onDismiss: () => rememberDismissedExportToast(id),
    });
  }, { exportId, projectName });
}

// Drives the REAL production path: writing a completed export into exportStore, which
// GlobalExportIndicator's own completion effect (mounted on every screen, see App.jsx) picks
// up and toasts -- this is what actually reproduces "re-shown on every reload", since the
// bug is in that effect's dismissed-id check, not in the raw toast() call.
async function completeExportInStore(page, { exportId, projectName = 'Probe Reel' }) {
  return page.evaluate(async ({ id, name }) => {
    const { useExportStore } = await import('/src/stores/exportStore.js');
    const now = new Date().toISOString();
    useExportStore.setState({
      activeExports: {
        [id]: {
          exportId: id, projectId: -1, projectName: name, type: 'overlay',
          status: 'complete', progress: { percent: 100 }, startedAt: now, completedAt: now,
          error: null, outputVideoId: null, outputFilename: null,
        },
      },
    });
  }, { id: exportId, name: projectName });
}

test('T15740:C1 - the toast never overlaps the action bar or the chat bubble', async ({ context, page }) => {
  test.skip(!!process.env.E2E_BASE_URL, '[T15740] drives the app through dev-server module imports (/src/...); a deployed build serves no such paths');
  await page.setViewportSize({ width: 1366, height: 660 });
  await loginForCheck(context);
  await page.goto('/');
  await page.getByTestId('corner-stack').waitFor({ timeout: 30000 });

  // Simulate a tall action band the way ActionBand's useCtaBarHeight publishes it in
  // production (document.documentElement's --cta-bar-h), reproducing the exact height this
  // bug needs without depending on a video loading in this sandbox.
  await page.evaluate((h) => {
    document.documentElement.style.setProperty('--cta-bar-h', `${h}px`);
  }, TALL_BAND_HEIGHT_PX);

  await fireCompletionToast(page);
  const toastEl = page.locator('[role="alert"]').first();
  await expect(toastEl).toBeVisible();

  const viewportHeight = 660;
  const bandTop = viewportHeight - TALL_BAND_HEIGHT_PX;

  const toastBox = await toastEl.boundingBox();
  expect(
    toastBox.y + toastBox.height <= bandTop + 0.5,
    `toast (bottom ${toastBox.y + toastBox.height}) overlaps the simulated action band (top ${bandTop})`,
  ).toBe(true);

  const reportButton = page.getByRole('button', { name: 'Report a problem' });
  await expect(reportButton).toBeVisible();
  const reportBox = await reportButton.boundingBox();
  expect(
    reportBox.y + reportBox.height <= bandTop + 0.5,
    `Report button / "chat bubble" (bottom ${reportBox.y + reportBox.height}) overlaps the simulated action band (top ${bandTop})`,
  ).toBe(true);
});

// C2 drives the real GlobalExportIndicator effect (mounted inside <App/>), unlike C1's
// direct Toast.jsx call -- `corner-stack` alone is NOT enough to wait for: it (and
// ToastContainer/Report button) is mounted in main.jsx OUTSIDE <App/>, so it renders
// before App's own `isCheckingSession` session-init gate resolves. On a freshly created
// dev-preset account that gate can take well over the health-check's usual few seconds in
// this sandbox (slow /api/auth/me, /api/geo), during which App renders null and
// GlobalExportIndicator simply isn't mounted yet -- injecting into the store before then is
// a silent no-op. Wait for a Home-screen-only marker instead.
async function waitForHomeScreenReady(page) {
  await page.getByTestId('corner-stack').waitFor({ timeout: 30000 });
  await page.getByText('ReelBallers').first().waitFor({ timeout: 60000 });
  // The index.html #preloader overlay only detaches after its own fade-out transition
  // (src/utils/preloader.js) once App.jsx dismisses it -- until then it still intercepts
  // clicks even though the content underneath is already visible.
  await page.waitForSelector('#preloader', { state: 'detached', timeout: 60000 });
}

test('T15740:C2 - a dismissed toast stays dismissed after reload', async ({ context, page }) => {
  test.skip(!!process.env.E2E_BASE_URL, '[T15740] drives the app through dev-server module imports (/src/...); a deployed build serves no such paths');
  await loginForCheck(context);
  await page.goto('/');
  await waitForHomeScreenReady(page);

  const exportId = `check-export-${Date.now()}`;
  const toastEl = page.locator('[role="alert"]').first();
  // useExportRecovery's startup fetch (App.jsx) replaces the WHOLE activeExports map once
  // it lands, which can race our direct-store injection and wipe it before the toast
  // effect runs -- re-inject until recovery has settled and the toast actually shows.
  await expect.poll(async () => {
    await completeExportInStore(page, { exportId });
    return toastEl.isVisible();
  }, { timeout: 30000, intervals: [500] }).toBe(true);

  // The real user gesture: click the toast's own Dismiss button.
  await toastEl.getByLabel('Dismiss').click();
  await expect(toastEl).toBeHidden();

  await page.reload();
  await waitForHomeScreenReady(page);

  // Same export completing again (e.g. useExportRecovery re-processing the still-
  // unacknowledged job on the fresh mount) must not re-show the toast the user dismissed.
  // Re-inject repeatedly across the recovery-settle window above (the same race could
  // otherwise race the injection away for the wrong reason instead of proving the fix).
  for (let i = 0; i < 10; i++) {
    await completeExportInStore(page, { exportId });
    await page.waitForTimeout(300);
    await expect(page.locator('[role="alert"]')).toHaveCount(0);
  }
});
