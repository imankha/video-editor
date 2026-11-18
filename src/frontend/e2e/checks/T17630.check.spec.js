import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { HEVC, MESSAGE, serveVideoBytes, openFrame } from '../helpers/frameVideoCheck';

// T17630: T17500:C2 timed out on staging waiting for Frame's <video>: it opened the first play
// in /projects, and on the shared account both listed plays sit on a game still uploading, so
// Frame showed "Game video still uploading" and never mounted a player. openFrame now opens a
// play whose playback-url answers (an expired game's saved clip first). This runs T17500:C2's flow.
test.setTimeout(240000);

test('T17630:C1 T17500:C2 Frame on a play whose saved clip is HEVC shows the message', async ({ context, page }) => {
  await loginForCheck(context);
  await serveVideoBytes(page, HEVC);
  await openFrame(page);
  await expect(page.getByRole('alert').filter({ hasText: MESSAGE }).first()).toBeVisible({ timeout: 60000 });
});
