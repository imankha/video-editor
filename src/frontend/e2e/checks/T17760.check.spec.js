import fs from 'fs';
import { test, expect } from '@playwright/test';
import { loginForCheck, disableGuidanceForCheck, checkApi } from '../helpers/checkAuth';
import { H264 } from '../helpers/frameVideoCheck';

/**
 * T17760: a play upload is charged, so its price shows before anything uploads or is charged.
 * The check picks files, reads the price, then Cancels: no upload request is ever sent and the
 * balance does not move, so it leaves nothing behind on the account.
 */
test.setTimeout(240000);

const GB = 1024 ** 3;
const UPLOAD_REQ = /\/api\/(games\/prepare-upload|clips\/upload)/;

async function balance(page) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return (await res.json()).balance;
  }, checkApi('/credits'));
}

async function openNotice(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await disableGuidanceForCheck(page);
  await page.getByRole('button', { name: /^Plays\b/ }).first().click();
  await page.getByTestId('home-upload-clip').first().click();
  return page.getByRole('alertdialog');
}

function plays(n) {
  const buffer = fs.readFileSync(H264);
  return Array.from({ length: n }, (_, i) => ({ name: `T17760-play-${i + 1}.mp4`, mimeType: 'video/mp4', buffer }));
}

test('T17760:C1 the upload cost shows before the charged upload starts', async ({ context, page }) => {
  await loginForCheck(context);
  const uploadCalls = [];
  page.on('request', (r) => { if (UPLOAD_REQ.test(r.url())) uploadCalls.push(r.url()); });

  const notice = await openNotice(page);
  await expect(notice).toContainText('1 credit per GB', { timeout: 60000 });
  const before = await balance(page);
  await page.getByRole('button', { name: 'Continue' }).click();

  const files = plays(2);
  await page.getByTestId('clip-upload-input').setInputFiles(files);
  const dialog = page.getByTestId('clip-upload-cost');
  await expect(dialog).toBeVisible({ timeout: 60000 });
  const totalBytes = files.reduce((s, f) => s + f.buffer.length, 0);
  const expected = Math.max(1, Math.ceil(totalBytes / GB));
  await expect(dialog).toContainText('Upload 2 plays?');
  await expect(dialog).toContainText(`Cost: ${expected} credit${expected === 1 ? '' : 's'}`);
  await expect(dialog).toContainText(`Balance: ${before} credit`);

  // Nothing uploads or is charged while the price is on screen; Cancel drops the pick.
  await page.waitForTimeout(2000);
  expect(uploadCalls).toEqual([]);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await page.waitForTimeout(2000);
  expect(uploadCalls).toEqual([]);
  expect(await balance(page)).toBe(before);
});

for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['tablet', { width: 820, height: 1180 }], ['desktop', { width: 1440, height: 900 }]]) {
  test(`T17760:C3 the price is readable on ${label}`, async ({ context, page }) => {
    await page.setViewportSize(viewport);
    await loginForCheck(context);
    const notice = await openNotice(page);
    await expect(notice).toBeVisible({ timeout: 60000 });
    const price = notice.getByText('1 credit per GB');
    await expect(price).toBeInViewport({ ratio: 1 });
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByTestId('clip-upload-input').setInputFiles(plays(1));
    const dialog = page.getByTestId('clip-upload-cost');
    await expect(dialog).toBeVisible({ timeout: 60000 });
    const cost = dialog.getByText(/^Cost: \d+ credits?$/);
    await expect(cost).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByText(/^Balance: /)).toBeInViewport({ ratio: 1 });
    // Readable: not clipped by its row and not tiny.
    const metrics = await cost.evaluate((el) => ({
      overflow: el.scrollWidth - el.clientWidth,
      fontPx: parseFloat(getComputedStyle(el).fontSize),
    }));
    expect(metrics.overflow).toBeLessThanOrEqual(0);
    expect(metrics.fontPx).toBeGreaterThanOrEqual(12);
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });
}
