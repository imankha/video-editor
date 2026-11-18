import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck } from '../helpers/checkAuth';
import { H264, MESSAGE, serveVideoBytes, openFrame } from '../helpers/frameVideoCheck';

// T17640: T17500:C4 timed out on staging waiting for Frame's <video>, for the same reason as
// T17630: it opened the first play in /projects, which on the shared account sits on a game
// still uploading, so Frame showed "Game video still uploading" and no player. openFrame now
// opens a play whose playback-url answers. This runs T17500:C4's flow.
test.setTimeout(240000);

async function openClipPicker(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await disableGuidanceForCheck(page);
  await page.getByRole('button', { name: /^Plays\b/ }).first().click();
  await page.getByTestId('home-upload-clip').first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('T17640:C1 T17500:C4 an H.264 video shows no message in Frame or on a play upload', async ({ context, page }) => {
  await loginForCheck(context);
  await serveVideoBytes(page, H264);
  await openFrame(page);
  await expect.poll(
    () => page.locator('video').first().evaluate((v) => v.videoWidth),
    { timeout: 60000 },
  ).toBe(160);
  await page.waitForTimeout(2000);
  await expect(page.getByText(MESSAGE)).toHaveCount(0);

  // A play upload of an H.264 file starts uploading with no message. The upload itself is
  // stopped at the network so the check leaves no clip behind.
  await page.unroute('**/*');
  await page.route(/\/api\/games\/prepare-upload/, (route) => route.abort('internetdisconnected'));
  await openClipPicker(page);
  await page.getByTestId('clip-upload-input').setInputFiles(H264);
  await expect(page.getByText('Uploading T17500-h264.mp4...').first()).toBeVisible({ timeout: 60000 });
  await expect(page.getByText(MESSAGE)).toHaveCount(0);
});
