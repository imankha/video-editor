import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T16030 - a shared reel link is the top-of-funnel page for people who may never have used
 * the app. It must show the video and nothing else: no coach tip, no shade, no pulsing
 * control, signed in or out (C1). Error/sign-in states still say what happened in plain
 * screen copy, never a coach tip (C2). C3 (Home's own guide un-nulls after Close) is a
 * `code` check against the vitest unit test that pins the null-gate wiring -- see
 * T16030.checks.json.
 */
test.setTimeout(180000);

const DEAD_LINK_TOKEN = '00000000-0000-0000-0000-000000000000';

async function firstDownloadId(page) {
  const res = await page.request.get(checkApi('/downloads'));
  expect(res.ok(), `/downloads -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const downloads = body.downloads || [];
  expect(downloads.length, 'at least one finished highlight to share').toBeGreaterThan(0);
  return downloads[0].id;
}

async function createShare(page, downloadId, { isPublic, recipientEmails = [] }) {
  const res = await page.request.post(checkApi(`/gallery/${downloadId}/share`), {
    data: { recipient_emails: recipientEmails, is_public: isPublic },
  });
  expect(res.ok(), `create share -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  const share = body.shares[0];
  expect(share?.share_token, 'a share token').toBeTruthy();
  return share.share_token;
}

async function assertNoGuidance(page) {
  await expect(page.locator('[data-testid="modal-guide"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="floating-coach-host"]')).toHaveCount(0);
  await expect(page.locator('.coach-target-pulse')).toHaveCount(0);
}

// The settings store only ever answers Guidance ON for a SIGNED-IN viewer whose account has
// it on (a signed-out viewer never fetches settings and stays hardcoded Off -- see
// settingsStore PRELOAD_SETTINGS). Force it on here so a signed-in check actually exercises
// the bug this task fixes, instead of trivially passing because Guidance happened to be off.
async function enableGuidanceForCheck(page) {
  const res = await page.request.put(checkApi('/settings'), { data: { guidance: { coachEnabled: true } } });
  expect(res.ok(), `enable guidance -> ${res.status()}`).toBeTruthy();
}

test.describe('T16030 shared reel link shows no guidance', () => {
  test('T16030:C1 signed in: the reel plays with no guide card, shade or pulse', async ({ context, page }) => {
    await loginForCheck(context);
    await enableGuidanceForCheck(page);
    const downloadId = await firstDownloadId(page);
    const token = await createShare(page, downloadId, { isPublic: true });

    await page.goto(`/shared/${token}`);
    await expect(page.locator('video').first()).toBeVisible({ timeout: 60000 });
    await assertNoGuidance(page);
  });

  test('T16030:C1 signed out: the reel plays with no guide card, shade or pulse', async ({ browser, context, page }) => {
    // Need a logged-in page only to mint the share token; the actual check runs unauthenticated.
    await loginForCheck(context);
    const downloadId = await firstDownloadId(page);
    const token = await createShare(page, downloadId, { isPublic: true });

    const signedOut = await browser.newContext();
    const signedOutPage = await signedOut.newPage();
    await signedOutPage.goto(`/shared/${token}`);
    await expect(signedOutPage.locator('video').first()).toBeVisible({ timeout: 60000 });
    await assertNoGuidance(signedOutPage);
    await signedOut.close();
  });

  test('T16030:C2 a dead link says so in plain copy, not a coach tip', async ({ context, page }) => {
    await loginForCheck(context);
    await enableGuidanceForCheck(page);
    await page.goto(`/shared/${DEAD_LINK_TOKEN}`);
    await expect(page.getByText('This link no longer works.')).toBeVisible({ timeout: 30000 });
    await assertNoGuidance(page);
  });

  test('T16030:C2 a restricted link tells a signed-out viewer to sign in, in plain copy', async ({ browser, context, page }) => {
    await loginForCheck(context);
    const downloadId = await firstDownloadId(page);
    const token = await createShare(page, downloadId, {
      isPublic: false,
      recipientEmails: ['t16030-someone-else@example.invalid'],
    });

    const signedOut = await browser.newContext();
    const signedOutPage = await signedOut.newPage();
    await signedOutPage.goto(`/shared/${token}`);
    await expect(signedOutPage.getByText(/Only people it was shared with can watch/)).toBeVisible({ timeout: 30000 });
    await expect(signedOutPage.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await assertNoGuidance(signedOutPage);
    await signedOut.close();
  });
});
