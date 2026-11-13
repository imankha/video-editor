/**
 * T11510 - per-criterion acceptance checks (group checks protocol).
 *
 * The phone share surfaces this task changed are the draft result's link-ready grid
 * (PublishLinkFlow inside DraftReelPreview) and the post-export toast. The draft result is
 * driven through the existing dev-only t8530diag.html harness, which mounts the REAL
 * <DraftReelPreview> + <ToastContainer> and only mocks the network boundary (publish, share
 * token mint, file download) -- a real never-published draft cannot be manufactured per run
 * (see e2e/T10180-publish-visibility-review-link.qa.spec.js, which uses the same harness).
 *
 * navigator.share / navigator.canShare are the external Web Share API: stubbed per test to
 * pick the device capability (FULL = file sharing works, LINK_ONLY = url-only) and to record
 * the exact payload each button sends. Playwright's touch emulation (hasTouch + isMobile)
 * makes `pointer: coarse` match, which is what useIsCoarsePointer reads.
 *
 * C11's player Share (CollectionPlayer) is not reachable here: the dev preset's Gallery holds
 * no single published highlight tile to open. Its coarse-pointer floor is asserted in
 * src/components/collections/CollectionPlayer.test.jsx ('T11510:C11 ...').
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T11510.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';

test.setTimeout(480000);

const PHONE = { width: 360, height: 780 };
const TOKEN = 'chk-t11510-token';

/** Stub the Web Share API before any app code runs; record every share payload. */
async function stubWebShare(page, { linkOnly }) {
  await page.addInitScript((isLinkOnly) => {
    window.__shares = [];
    navigator.share = async (data) => {
      window.__shares.push({
        title: data.title,
        text: data.text,
        url: data.url,
        files: data.files ? data.files.map((f) => ({ name: f.name, type: f.type })) : undefined,
      });
    };
    navigator.canShare = (data) => !(data && data.files) || !isLinkOnly;
  }, linkOnly);
}

/** Mock the network boundary the draft result touches; returns the share-mint call log. */
async function mockDraftNetwork(page) {
  const calls = { publish: 0, shareMint: 0 };
  await page.route('**/api/downloads/publish/**', (route) => {
    calls.publish += 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, final_video_id: 999001, archived: true }) });
  });
  await page.route('**/api/downloads/count**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }) }));
  await page.route('**/api/projects**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/quests/achievements/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await page.route('**/api/gallery/999001/share', (route) => {
    calls.shareMint += 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ shares: [{ share_token: TOKEN }] }) });
  });
  await page.route('**/api/downloads/999001/stream**', (route) => route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from([]) }));
  await page.route('**/api/downloads/999001/file**', (route) => route.fulfill({
    status: 200, contentType: 'video/mp4',
    headers: { 'Content-Disposition': 'attachment; filename="chk.mp4"' },
    body: Buffer.from([0]),
  }));
  await page.route('**/api/downloads/999001/file-url', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ url: null, filename: 'chk.mp4', proxied: true }),
  }));
  return calls;
}

async function openDraft(page, { linkOnly = false, hash = '' } = {}) {
  await stubWebShare(page, { linkOnly });
  const calls = await mockDraftNetwork(page);
  // The app rewrites the URL during module import, so the harness reads its params from here.
  await page.addInitScript((h) => { window.__T8530DIAG = h; }, hash);
  await page.goto('/t8530diag.html');
  await page.waitForLoadState('domcontentloaded');
  return calls;
}

/** idle -> review -> Create link -> link-ready (the unpublished path). */
async function publishToReady(page) {
  await page.getByRole('button', { name: 'Get link' }).click();
  await page.getByRole('button', { name: 'Create link' }).click();
  await expect(page.getByText('Link ready')).toBeVisible({ timeout: 10000 });
}

const shareLinkBtn = (page) => page.getByRole('button', { name: 'Share link', exact: true });
const shareVideoBtn = (page) => page.getByRole('button', { name: 'Share video', exact: true });
const shares = (page) => page.evaluate(() => window.__shares);

async function assertAtLeast44(locator, label) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has a bounding box`).not.toBeNull();
  expect(box.width, `${label} width (${box.width}) >= 44`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height (${box.height}) >= 44`).toBeGreaterThanOrEqual(44);
}

/** Fire a toast through the harness's own toast module (the one its ToastContainer subscribes to). */
const completionToast = (page) => page.getByRole('alert').filter({ hasText: 'Highlight ready' });
async function fireToastWithAction(page) {
  await page.evaluate(() => {
    window.__t8530Toast.success('Highlight ready', { message: 'Goal vs Sharks', duration: 0, action: { label: 'Copy link', onClick: () => {} } });
  });
}

test.describe('T11510 phone (360px, coarse pointer)', () => {
  test.skip(!!process.env.E2E_BASE_URL, '[T11510] drives the dev-only t8530diag.html harness and /src module imports; a deployed build serves neither');
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE });

  test('T11510:C2 - a LINK_ONLY device shows one full-width Share link and no Share video on the draft link-ready grid', async ({ page }) => {
    await openDraft(page, { linkOnly: true });
    await publishToReady(page);
    await expect(shareLinkBtn(page)).toHaveCount(1);
    await expect(shareVideoBtn(page)).toHaveCount(0);
    // Full width: the button spans the action bar's content box (its parent column).
    const widths = await shareLinkBtn(page).evaluate((el) => {
      const parent = el.parentElement;
      const cs = getComputedStyle(parent);
      const inner = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return { btn: el.getBoundingClientRect().width, inner };
    });
    expect(Math.abs(widths.btn - widths.inner), `Share link ${widths.btn}px vs column ${widths.inner}px`).toBeLessThanOrEqual(1);
  });

  test('T11510:C3 - an unpublished draft offers no Share video and mints no link before the review; a published one mints on Share link with no review', async ({ page }) => {
    const calls = await openDraft(page);
    // Unpublished, idle: only the review entry; no Share video, no link actions.
    await expect(page.getByRole('button', { name: 'Get link' })).toBeVisible({ timeout: 10000 });
    await expect(shareVideoBtn(page)).toHaveCount(0);
    await expect(shareLinkBtn(page)).toHaveCount(0);
    // Opening the review mints nothing; Cancel mints nothing.
    await page.getByRole('button', { name: 'Get link' }).click();
    await expect(page.getByText(/Anyone with the link can watch/)).toBeVisible();
    await expect(shareVideoBtn(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
    expect(calls.shareMint, 'no link minted without the review being confirmed').toBe(0);
    expect(calls.publish).toBe(0);
    // Only confirming the review publishes and mints.
    await publishToReady(page);
    expect(calls.publish).toBe(1);
    expect(calls.shareMint).toBe(1);

    // Published, no link yet (R5 ready-capable): Share link mints directly, no review card.
    const page2 = await page.context().newPage();
    const calls2 = await openDraft(page2, { hash: 'alreadyPublished=1' });
    await expect(shareLinkBtn(page2)).toBeVisible({ timeout: 10000 });
    await shareLinkBtn(page2).click();
    await expect(page2.getByText('Link ready')).toBeVisible({ timeout: 10000 });
    await expect(page2.getByText(/Anyone with the link can watch/)).toHaveCount(0);
    expect(calls2.shareMint, 'published highlight mints on Share link').toBe(1);
    expect(calls2.publish, 'no publish/review for an already-published highlight').toBe(0);
  });

  test('T11510:C4 - each phone label sends the payload it names; the coarse toast has no share action', async ({ page }) => {
    await openDraft(page);
    await publishToReady(page);
    await shareLinkBtn(page).click();
    await expect.poll(async () => (await shares(page)).length).toBe(1);
    const [link] = await shares(page);
    expect(link.url, 'Share link sends the link').toMatch(new RegExp(`/shared/${TOKEN}$`));
    expect(link.files, 'Share link sends no file').toBeUndefined();

    await shareVideoBtn(page).click();
    await expect.poll(async () => (await shares(page)).length).toBe(2);
    const video = (await shares(page))[1];
    expect(video.url, 'Share video sends no link').toBeUndefined();
    expect(video.files, 'Share video sends exactly one video file').toHaveLength(1);
    expect(video.files[0].type).toBe('video/mp4');

    // LinkReadyCard's Copy (labelled Copy link) copies the link, it does not share.
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.getByRole('button', { name: 'Copy link' }).click();
    await expect(page.getByText('Link copied')).toBeVisible({ timeout: 5000 });
    expect((await shares(page)).length, 'Copy link opened no share sheet').toBe(2);
  });

  test('T11510:C10 - the mobile link-ready phase shows the link card, a cyan Share link and Share video side by side, no overflow at 360px', async ({ page }) => {
    await openDraft(page);
    await publishToReady(page);
    await expect(page.locator('input[readonly]')).toHaveValue(new RegExp(`/shared/${TOKEN}$`));
    const link = await shareLinkBtn(page).boundingBox();
    const video = await shareVideoBtn(page).boundingBox();
    expect(Math.abs(link.y - video.y), 'same row').toBeLessThanOrEqual(1);
    expect(link.x + link.width, 'Share link sits left of Share video').toBeLessThanOrEqual(video.x);
    expect(video.x + video.width, 'Share video fits the 360px viewport').toBeLessThanOrEqual(PHONE.width);
    await expect(shareLinkBtn(page)).toHaveClass(/bg-cyan-/);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'no horizontal overflow at 360px').toBeLessThanOrEqual(0);
  });

  test('T11510:C11 - the PublishLinkFlow buttons, LinkReadyCard Copy and the toast action are >=44px on a coarse pointer', async ({ page }) => {
    await openDraft(page);
    await assertAtLeast44(page.getByRole('button', { name: 'Get link' }), 'Get link (idle)');
    await page.getByRole('button', { name: 'Get link' }).click();
    await assertAtLeast44(page.getByRole('button', { name: 'Cancel' }), 'review Cancel');
    await assertAtLeast44(page.getByRole('button', { name: 'Create link' }), 'review Create link');
    await page.getByRole('button', { name: 'Create link' }).click();
    await expect(page.getByText('Link ready')).toBeVisible({ timeout: 10000 });
    await assertAtLeast44(page.getByRole('button', { name: 'Copy link' }), 'LinkReadyCard Copy');
    await assertAtLeast44(shareLinkBtn(page), 'Share link');
    await assertAtLeast44(shareVideoBtn(page), 'Share video');
    await fireToastWithAction(page);
    const action = completionToast(page).getByRole('button', { name: 'Copy link' });
    const box = await action.boundingBox();
    expect(box.height, `toast action height (${box.height}) >= 44`).toBeGreaterThanOrEqual(44);
  });

  test('T11510:C12 - the toast container stays inside a 360px viewport', async ({ page }) => {
    await openDraft(page);
    await expect(page.getByRole('button', { name: 'Get link' })).toBeVisible({ timeout: 10000 });
    await fireToastWithAction(page);
    await expect(completionToast(page)).toBeVisible();
    const box = await completionToast(page).boundingBox();
    expect(box.x, `toast left edge (${box.x}) >= 0`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `toast right edge (${box.x + box.width}) <= 360`).toBeLessThanOrEqual(PHONE.width);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('T11510:C14 - no string this task added or touched calls a single highlight a "reel"', async ({ page }) => {
    // name= (empty) drives the no-name fallbacks of the share title/text.
    await openDraft(page, { hash: 'name=' });
    await publishToReady(page);
    const bar = page.getByText('Link ready').locator('..');
    const barText = await bar.innerText();
    expect(barText, 'link-ready grid copy').not.toMatch(/\breels?\b/i);
    await shareLinkBtn(page).click();
    await shareVideoBtn(page).click();
    await expect.poll(async () => (await shares(page)).length).toBe(2);
    for (const s of await shares(page)) {
      expect(`${s.title} | ${s.text}`, 'share title/text fallbacks').not.toMatch(/\breels?\b/i);
      for (const f of s.files || []) expect(f.name).not.toMatch(/\breels?\b/i);
    }
  });
});
