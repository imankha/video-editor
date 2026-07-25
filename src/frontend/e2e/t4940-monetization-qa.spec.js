/**
 * T4940 QA — live-drive the credit transparency + repricing surfaces.
 *
 * Verifies (per acceptance criteria) against the running dev app with a real account:
 *  - Buy-credits modal renders the repriced 80/160/340 packs single-sourced from backend.
 *  - "1 credit = 1 second of exported video" rule is visible; free actions listed.
 *  - Usage history surface renders from /credits/transactions.
 *  - Game upload preview shows credit cost + 30-day window before activation.
 * Captures screenshot evidence at desktop (1280) and mobile (375).
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import fs from 'fs';

const EVID = '/workspace/qa-evidence/T4940';
const EMAIL = 'imankh@gmail.com';

test.beforeAll(() => fs.mkdirSync(EVID, { recursive: true }));

async function openBuyCredits(page) {
  const pill = page.getByTitle(/click to buy more/);
  await pill.waitFor({ timeout: 25000 });
  await pill.click();
  await expect(page.getByText(/1 credit = 1 second/).first()).toBeVisible({ timeout: 10000 });
}

test('desktop: buy-credits rule + repriced packs + explainer', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openBuyCredits(page);

  await expect(page.getByText('80 credits').first()).toBeVisible();
  await expect(page.getByText('160 credits').first()).toBeVisible();
  await expect(page.getByText('340 credits').first()).toBeVisible();
  await expect(page.getByText('$3.99')).toBeVisible();
  await expect(page.getByText('$6.99')).toBeVisible();
  await expect(page.getByText('$12.99')).toBeVisible();
  await expect(page.getByText(/5m 40s of exported video/)).toBeVisible();
  await page.screenshot({ path: `${EVID}/buy-credits-desktop.png` });

  await page.getByText('How credits work').click();
  await expect(page.getByText(/Always free/)).toBeVisible();
  await expect(page.getByText(/Spotlight/)).toBeVisible();
  await page.screenshot({ path: `${EVID}/explainer-desktop.png` });
});

test('desktop: usage history renders from transactions', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openBuyCredits(page);
  await page.getByText('Usage history').click();
  // Wait for the loaded state — either the table header (rows) or the empty state,
  // not the transient spinner — before capturing evidence.
  await expect(
    page.getByRole('columnheader', { name: 'Activity' }).or(page.getByText(/No credit activity yet/))
  ).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: `${EVID}/usage-history-desktop.png` });
});

test('desktop: upload preview shows cost + 30 days before activation', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/home/games');
  await page.getByRole('button', { name: /Add Game/ }).click();
  await expect(page.getByText('Add New Game')).toBeVisible({ timeout: 15000 });

  await page.locator('input[type="file"][accept*="video"]').last().setInputFiles({
    name: 'game.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(2 * 1024 * 1024), // 2 MB dummy
  });

  await expect(page.getByText(/for 30 days of storage/)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${EVID}/upload-preview-desktop.png` });
});

test('mobile 375: buy-credits + upload preview render', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await openBuyCredits(page);
  await expect(page.getByText('340 credits')).toBeVisible();
  await expect(page.getByText('$12.99')).toBeVisible();
  await page.screenshot({ path: `${EVID}/buy-credits-mobile-375.png` });

  // Fresh navigation to the games tab for the upload preview.
  await page.goto('/home/games');
  await page.getByRole('button', { name: /Add Game/ }).click();
  await expect(page.getByText('Add New Game')).toBeVisible({ timeout: 15000 });
  await page.locator('input[type="file"][accept*="video"]').last().setInputFiles({
    name: 'game.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(2 * 1024 * 1024),
  });
  await expect(page.getByText(/for 30 days of storage/)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${EVID}/upload-preview-mobile-375.png` });
});
