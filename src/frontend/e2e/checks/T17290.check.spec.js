/**
 * T17290 -- T17010:C1 failed on staging with a timeout: the staging checks of several merged
 * groups ran at once, all signed in as the one seeded account, and every dev-login ended that
 * account's other sessions. This check's page came up on the sign-in screen ("Your session
 * ended") and waited for Annotate until the test timed out.
 *
 * C1 reproduces that: after this check signs in, a second browser signs the same account in
 * (what a concurrent check does), then T17010:C1's flow must still give its expected result.
 */
import { test } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { loginAsRealUser } from '../helpers/realAuth';
import { tagsNotesCloseFlow } from '../helpers/tagsNotesCloseFlow';

test.setTimeout(480000);

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

test('T17290:C1 T17010:C1 passes while another check signs the same account in', async ({ browser, context, page }) => {
  const me = await loginForCheck(context);
  const other = await browser.newContext();
  try {
    await loginAsRealUser(other, me.email);
  } finally {
    await other.close();
  }
  await tagsNotesCloseFlow(page);
});
