/**
 * T4940 QA — live-drive the credit transparency + repricing surfaces.
 *
 * Verifies (per acceptance criteria) against the running dev app with a real account:
 *  - Buy-credits modal renders the credit packs single-sourced from backend.
 *  - "1 credit = 1 second of exported video" rule is visible; free actions listed.
 *  - Usage history surface renders from /credits/transactions.
 *  - Game upload preview shows credit cost + 30-day window before activation.
 * Captures screenshot evidence at desktop (1280) and mobile (375).
 *
 * T7810 (staging-gate phase 2): the identity is env-driven (E2E_REAL_EMAIL /
 * E2E_REAL_PROFILE — see scripts/staging-gate.sh) instead of a hardcoded email,
 * and the pack assertions are STRUCTURAL (3 packs, prices present + ascending,
 * explainer copy) rather than literal prices ($3.99/$6.99/$12.99), so a future
 * repricing that preserves the ladder does NOT fail this gate spec. The desktop
 * buy-credits test is tagged @staging-gate @gate-c (mocked/read lane).
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import { loginAsRealUser } from './helpers/realAuth';
import { QA_DIR } from './helpers/qa.js';
import fs from 'fs';

// Evidence goes to the repo-root qa/ dir (helpers/qa.js QA_DIR) like every other
// QA spec. This used to be a hardcoded '/workspace/qa-evidence/T4940' -- a
// /dotask CONTAINER path, so beforeAll's mkdirSync blew up on a host run and
// failed all 4 tests in ~180ms before touching the app. QA_DIR resolves from the
// checkout, so it works on the host AND in a container (bind-mounted).
const EVID = path.join(QA_DIR, 'T4940');
const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE; // omit -> account's default profile

test.beforeAll(() => fs.mkdirSync(EVID, { recursive: true }));

async function openBuyCredits(page) {
  const pill = page.getByTitle(/click to buy more/);
  await pill.waitFor({ timeout: 25000 });
  await pill.click();
  await expect(page.getByText(/1 credit = 1 second/).first()).toBeVisible({ timeout: 10000 });
}

/**
 * Read the rendered pack ladder STRUCTURALLY: each pack is a <button> that shows
 * "... of exported video" and a "$" price. Returns the price of each pack in cents
 * (regex-extracted from the button's own text, so it survives class refactors AND
 * a repricing). No literal price is baked into the assertions.
 */
async function readPackPricesCents(page) {
  const packs = page.locator('button:has-text("of exported video")');
  await expect(packs).toHaveCount(3);
  const cents = [];
  for (let i = 0; i < 3; i++) {
    const text = (await packs.nth(i).textContent()) || '';
    const m = text.match(/\$(\d+(?:\.\d{2})?)/);
    expect(m, `pack ${i} must show a $ price (button text: "${text.trim()}")`).toBeTruthy();
    cents.push(Math.round(parseFloat(m[1]) * 100));
  }
  return cents;
}

test('desktop: buy-credits rule + packs + explainer @staging-gate @gate-c', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL, PROFILE);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await openBuyCredits(page);

  // STRUCTURAL: exactly 3 packs, each with a $ price present, prices strictly
  // ascending (cheapest -> best value). This is the whole point of T7810 — the
  // spec must survive a price change without edits, so NO literal price appears.
  const cents = await readPackPricesCents(page);
  expect(cents.every((c) => Number.isFinite(c) && c > 0), `prices present: ${cents}`).toBeTruthy();
  for (let i = 1; i < cents.length; i++) {
    expect(cents[i], `prices ascending (cents): ${cents}`).toBeGreaterThan(cents[i - 1]);
  }
  await page.screenshot({ path: `${EVID}/buy-credits-desktop.png` });

  await page.getByText('How credits work').click();
  await expect(page.getByText(/Always free/)).toBeVisible();
  await expect(page.getByText(/Spotlight/)).toBeVisible();
  await page.screenshot({ path: `${EVID}/explainer-desktop.png` });
});

test('desktop: usage history renders from transactions', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL, PROFILE);
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
  await loginAsRealUser(context, EMAIL, PROFILE);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/home/games');
  await page.getByRole('button', { name: /Add Game/ }).click();
  await expect(page.getByText('Add New Game')).toBeVisible({ timeout: 15000 });

  await page.locator('input[type="file"][accept*="video"]').last().setInputFiles({
    name: 'game.mp4',
    mimeType: 'video/mp4',
    buffer: Buffer.alloc(2 * 1024 * 1024), // 2 MB dummy
  });

  await expect(page.getByText(/keeps your video for 30 days/)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${EVID}/upload-preview-desktop.png` });
});

test('mobile 375: buy-credits + upload preview render', async ({ context, page }) => {
  await loginAsRealUser(context, EMAIL, PROFILE);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await openBuyCredits(page);
  // STRUCTURAL: the pack ladder renders on a narrow viewport too (no literal price).
  await readPackPricesCents(page);
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
  await expect(page.getByText(/keeps your video for 30 days/)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${EVID}/upload-preview-mobile-375.png` });
});
