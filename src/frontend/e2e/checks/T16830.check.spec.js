/**
 * T16830 - per-criterion acceptance check (group checks protocol).
 *
 * C1: when the server has no record of a sharpen Frame is waiting on (the job was lost to a
 * server restart), Frame stops waiting within a minute and tells the parent to sharpen again.
 *
 * A restart cannot be ordered from a browser, so the check makes the same state the restart
 * leaves: the render request is answered 202 ("accepted, progress comes over the socket") by the
 * test without reaching the server, so no export job exists for that id. The socket connects to
 * the real server, which never sends anything for a job it does not know, and
 * GET /api/exports/{id} answers 404, exactly as after a deploy. No credits are charged.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16830.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';
import { sharpenableDraft } from '../helpers/returnAfterSharpen';

const INTERRUPTED = 'Sharpening was interrupted. To try again, tap Sharpen!';

test('T16830:C1 - a sharpen the server lost stops waiting within a minute and says to sharpen again', async ({ browser }) => {
  test.setTimeout(300000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await loginForCheck(context);
    const page = await context.newPage();
    await page.goto('/home');
    await disableGuidanceForCheck(page);
    const draft = await sharpenableDraft(page);
    test.skip(!draft, '[T16830] no unsharpened single-clip draft on a ready game, and no play on a ready game to make one from');

    await page.goto(`/focus/p/${draft.id}`);
    await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });

    // The server restarts after accepting the sharpen: it answers 202, then has no job for it.
    let renderedId = null;
    await page.route('**/api/export/render', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      renderedId = route.request().postDataJSON()?.export_id;
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ status: 'accepted', export_id: renderedId }) });
    });

    const sharpen = page.getByRole('button', { name: 'Sharpen!' }).first();
    await expect(sharpen).toBeEnabled({ timeout: 60000 });
    await sharpen.click();
    const confirm = page.getByTestId('focus-box-confirm');
    if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await confirm.getByRole('button', { name: 'Sharpen!' }).click();
    }
    await expect.poll(() => renderedId, { timeout: 30000 }).toBeTruthy();
    const waitingSince = Date.now();

    // Within a minute Frame stops waiting and tells the parent to sharpen again...
    await expect(page.getByText(INTERRUPTED).first()).toBeVisible({ timeout: 60000 });
    expect(Date.now() - waitingSince).toBeLessThan(60000);
    // ...and Sharpen is there to press again.
    await expect(page.getByRole('button', { name: 'Sharpen!' }).first()).toBeEnabled({ timeout: 10000 });
  } finally {
    await context.close();
  }
});
