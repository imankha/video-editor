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
 * contract). The toast comes from GlobalExportIndicator's own completion effect, fed by a
 * just-completed export in the app's export-recovery response (T16000: no /src module imports,
 * so C1 also runs against a deployed build), then it asserts neither the toast nor the Report
 * button sit inside the band's reserved footprint.
 *
 * C2 reproduces "re-shown on every reload": the same recovery response raises the toast, it
 * is dismissed via its real Dismiss button (persists the export id via T15740's
 * dismissedExportToasts util), the page reloads and recovery delivers the SAME just-completed
 * export again -- the toast must not reappear (T16010: no /src imports, so C2 runs on staging).
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T15740.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';

// The real height measured on Focus at 1366x660 with the Trim/SlowMo "above" row showing
// (band top y=426.75, viewport height 660).
const TALL_BAND_HEIGHT_PX = 233;

// T16000: the toast is raised through the real production path on any target (dev stack or a
// deployed build, which serves no /src module paths): the app's own export-recovery response
// carries one export that has just completed, so useExportRecovery loads it into exportStore
// and GlobalExportIndicator's completion effect shows the toast. Recovery reads the exports
// from /api/bootstrap, or from /api/exports/active when bootstrap takes longer than its 2 s
// wait (the slow dev stack), so both responses carry it. Only the responses are rewritten
// (the requests still go to the real backend); nothing is written server-side.
// `exports` is read on every response, so a test can change what the next load delivers.
async function routeRecoveryWithCompletedExports(page, exports) {
  const completedExports = () => {
    const now = new Date().toISOString();
    return exports.map(({ exportId, projectName }) => ({
      job_id: exportId, project_id: -1, project_name: projectName, type: 'overlay',
      status: 'complete', progress: 100, started_at: now, completed_at: now,
    }));
  };
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const recovered = body.exports || { active: [], unacknowledged: [] };
    body.exports = { ...recovered, active: [...(recovered.active || []), ...completedExports()] };
    await route.fulfill({ response, json: body });
  });
  await page.route('**/api/exports/active', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.exports = [...(body.exports || []), ...completedExports()];
    await route.fulfill({ response, json: body });
  });
}

test('T15740:C1 - the toast never overlaps the action bar or the chat bubble', async ({ context, page }) => {
  await page.setViewportSize({ width: 1366, height: 660 });
  await loginForCheck(context);
  await routeRecoveryWithCompletedExports(page, [{ exportId: `check-export-${Date.now()}`, projectName: 'Probe Reel' }]);
  await page.goto('/');
  await page.getByTestId('corner-stack').waitFor({ timeout: 30000 });

  // Simulate a tall action band the way ActionBand's useCtaBarHeight publishes it in
  // production (document.documentElement's --cta-bar-h), reproducing the exact height this
  // bug needs without depending on a video loading in this sandbox.
  await page.evaluate((h) => {
    document.documentElement.style.setProperty('--cta-bar-h', `${h}px`);
  }, TALL_BAND_HEIGHT_PX);

  const toastEl = page.locator('[role="alert"]').first();
  await expect(toastEl).toBeVisible({ timeout: 60000 });

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

// C2 waits for <App/> itself (GlobalExportIndicator is mounted inside it) -- `corner-stack` alone is NOT enough to wait for: it (and
// ToastContainer/Report button) is mounted in main.jsx OUTSIDE <App/>, so it renders
// before App's own `isCheckingSession` session-init gate resolves. On a freshly created
// dev-preset account that gate can take well over the health-check's usual few seconds in
// this sandbox (slow /api/auth/me, /api/geo), during which App renders null and
// GlobalExportIndicator simply isn't mounted yet, and the toast's Dismiss button sits under
// the #preloader overlay. Wait for a Home-screen-only marker instead.
async function waitForHomeScreenReady(page) {
  await page.getByTestId('corner-stack').waitFor({ timeout: 30000 });
  await page.getByText('ReelBallers').first().waitFor({ timeout: 60000 });
  // The index.html #preloader overlay only detaches after its own fade-out transition
  // (src/utils/preloader.js) once App.jsx dismisses it -- until then it still intercepts
  // clicks even though the content underneath is already visible.
  await page.waitForSelector('#preloader', { state: 'detached', timeout: 60000 });
}

test('T15740:C2 - a dismissed toast stays dismissed after reload', async ({ context, page }) => {
  test.setTimeout(240000);
  await loginForCheck(context);
  const stamp = Date.now();
  const dismissed = { exportId: `check-export-${stamp}`, projectName: 'Dismissed Probe Reel' };
  const exports = [dismissed];
  // The route stays installed across page.reload() and stamps completed_at fresh on every
  // response -- so after the reload the same export arrives again inside the toast's 10 s
  // recency window, exactly the "re-shown on every reload" scenario.
  await routeRecoveryWithCompletedExports(page, exports);
  await page.goto('/');
  await waitForHomeScreenReady(page);

  const dismissedToast = page.locator('[role="alert"]').filter({ hasText: dismissed.projectName });
  await expect(dismissedToast).toBeVisible({ timeout: 60000 });

  // The real user gesture: click the toast's own Dismiss button.
  await dismissedToast.getByLabel('Dismiss').click();
  await expect(dismissedToast).toBeHidden();

  // Positive control: the reloaded app also recovers a second just-completed export the user
  // never dismissed. Its toast showing proves recovery re-delivered both exports in time to
  // toast; the dismissed one must still stay away.
  const control = { exportId: `check-export-${stamp}-control`, projectName: 'Control Probe Reel' };
  exports.push(control);
  await page.reload();
  // The reload may restore an editor screen rather than Home, so the control toast itself is
  // the readiness signal (no Home-only marker).
  await expect(page.locator('[role="alert"]').filter({ hasText: control.projectName }))
    .toBeVisible({ timeout: 120000 });
  await expect(dismissedToast).toHaveCount(0);
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    await expect(dismissedToast).toHaveCount(0);
  }
});
