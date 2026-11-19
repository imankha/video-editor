import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { renderSharePage, stabilizeVideoUrl } from '../../functions/shared/[token].js';

/**
 * T17740 - a signed-out viewer on a public highlight page presses Download. The file must
 * save and the shared page must stay where it is (C1 desktop 1440x900, C2 phone).
 *
 * The page is the edge Pages Function (functions/shared/[token].js), which serves from the
 * app host while every media URL points at the API host. On a deployed target the check
 * opens the real edge page. The local stack runs no Pages Functions (vite serves the SPA at
 * /shared/), so locally the check renders the SAME edge HTML from the API's real share JSON
 * with the module's own stabilizeVideoUrl + renderSharePage, against the API on its own
 * origin (localhost:8000 vs :5173), so the cross-origin download rules match staging.
 */
test.setTimeout(300000);

const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

async function createPublicShare(page) {
  const res = await page.request.get(checkApi('/downloads'));
  expect(res.ok(), `/downloads -> ${res.status()}`).toBeTruthy();
  const downloads = (await res.json()).downloads || [];
  expect(downloads.length, 'at least one finished highlight to share').toBeGreaterThan(0);
  const shareRes = await page.request.post(checkApi(`/gallery/${downloads[0].id}/share`), {
    data: { recipient_emails: [], is_public: true },
  });
  expect(shareRes.ok(), `create share -> ${shareRes.status()}`).toBeTruthy();
  const token = (await shareRes.json()).shares[0]?.share_token;
  expect(token, 'a share token').toBeTruthy();
  return token;
}

/** Open the public share page signed out; returns its URL. */
async function openEdgeSharePage(viewer, token, baseURL, apiBase) {
  const pageUrl = `${baseURL}/shared/${token}`;
  if (!process.env.E2E_BASE_URL) {
    const apiOrigin = new URL(apiBase).origin;
    const res = await viewer.request.get(`${apiOrigin}/api/shared/${token}`);
    expect(res.ok(), `share JSON -> ${res.status()}`).toBeTruthy();
    const html = renderSharePage(stabilizeVideoUrl(await res.json(), apiOrigin, token), `${baseURL}/`);
    await viewer.route(pageUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  }
  await viewer.goto(pageUrl);
  await expect(viewer.locator('a.dl')).toBeVisible({ timeout: 60000 });
  return pageUrl;
}

async function assertDownloadSaves(viewer, pageUrl) {
  const downloadPromise = viewer.waitForEvent('download', { timeout: 60000 });
  await viewer.locator('a.dl').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/);
  expect(await download.failure(), 'download completes').toBeNull();
  // The shared page is still the page on screen, not the video in the browser's player.
  expect(viewer.url()).toBe(pageUrl);
  await expect(viewer.locator('a.dl')).toBeVisible();
  await expect(viewer.locator('video#v')).toBeVisible();
}

test.describe('T17740 shared Download saves the file', () => {
  test('T17740:C1 desktop: Download saves the video and the shared page stays', async ({ browser, context, page, baseURL }, testInfo) => {
    await loginForCheck(context);
    const token = await createPublicShare(page);

    const viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const viewer = await viewerContext.newPage();
    const pageUrl = await openEdgeSharePage(viewer, token, baseURL, testInfo.project.use.apiBase);
    await assertDownloadSaves(viewer, pageUrl);
    await viewerContext.close();
  });

  test('T17740:C2 phone: Download saves the video and the shared page stays', async ({ browser, context, page, baseURL }, testInfo) => {
    await loginForCheck(context);
    const token = await createPublicShare(page);

    const viewerContext = await browser.newContext({ ...PHONE, acceptDownloads: true });
    const viewer = await viewerContext.newPage();
    const pageUrl = await openEdgeSharePage(viewer, token, baseURL, testInfo.project.use.apiBase);
    await assertDownloadSaves(viewer, pageUrl);
    await viewerContext.close();
  });
});
