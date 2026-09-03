import { test, expect, devices } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8540 — Share is the player's PRIMARY action.
 *
 * Problem: the reel player toolbar offered Re-edit / Re-rank / Download / Close
 * but no Share — Share/Copy Link lived only inside ReelTile's kebab "More
 * actions" overflow. Prod cliff 4: zero real users ever completed a share of a
 * self-made reel. Fix: Share becomes the toolbar's primary (visually dominant)
 * button, ahead of Download; Re-edit/Re-rank demote to icon-only/tertiary.
 *
 * Driven through the SAME dev-only harness T5860 uses (/collectionplayerdiag.html)
 * — the REAL CollectionPlayer, real Button component, real layout — so ordering/
 * primacy assertions reflect actual DOM/paint order (jsdom unit tests assert
 * gating and click-wiring, not visual position). No login/real account needed.
 *
 * Run: cd src/frontend && npx playwright test e2e/T8540-share-primary-player-action.qa.spec.js
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE = path.resolve(__dirname, '..', 'public', 'collectionplayerdiag-sample.mp4');
const HARNESS = '/collectionplayerdiag.html';
const STATUS = '[data-testid="status"]';

test.beforeAll(() => {
  if (!existsSync(SAMPLE)) {
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=360x640:rate=30 -pix_fmt yuv420p -movflags +faststart "${SAMPLE}"`,
      { stdio: 'ignore' },
    );
  }
});

test.afterAll(() => {
  if (existsSync(SAMPLE)) unlinkSync(SAMPLE);
});

async function openPlayer(page) {
  await page.goto(HARNESS);
  await page.waitForSelector(STATUS);
  await page.waitForSelector('video');
}

/** The toolbar action row: everything alongside the Close button (the row's
 * one guaranteed-present member across every prop combination). */
function toolbarButtons(page) {
  const closeBtn = page.getByRole('button', { name: 'Close' });
  return closeBtn.locator('xpath=..').getByRole('button');
}

test('Share is the FIRST, visually primary toolbar button — Download demoted to secondary', async ({ page }) => {
  skipOnDeployedTarget(test, 'drives the dev-only /collectionplayerdiag.html harness page, which does not exist in a production BUILD');
  await openPlayer(page);

  const buttons = await toolbarButtons(page).all();
  const names = await Promise.all(buttons.map((b) => b.innerText()));
  expect(names[0].trim()).toBe('Share');
  expect(names).toContain('Download');
  expect(names.indexOf('Share')).toBeLessThan(names.indexOf('Download'));

  // Primary = purple (bg-purple-600), secondary = gray (bg-gray-700) — the
  // Button component's own variant classes, not a new color introduced here.
  const shareBtn = page.getByRole('button', { name: 'Share' });
  const downloadBtn = page.getByRole('button', { name: 'Download' });
  await expect(shareBtn).toHaveClass(/bg-purple-600/);
  await expect(downloadBtn).toHaveClass(/bg-gray-700/);
  await expect(downloadBtn).not.toHaveClass(/bg-purple-600/);

  await saveEvidence(page, 'T8540-share-primary-toolbar-order');
});

test('tapping Share fires the caller-supplied handler with no overflow menu involved', async ({ page }) => {
  skipOnDeployedTarget(test, 'drives the dev-only /collectionplayerdiag.html harness page, which does not exist in a production BUILD');
  await openPlayer(page);

  await page.getByRole('button', { name: 'Share' }).click();
  await expect(page.locator(STATUS)).toHaveAttribute('data-last-click', 'share');
});

test('mobile viewport (390x844): Share is the first toolbar button and fully in-viewport', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  skipOnDeployedTarget(test, 'drives the dev-only /collectionplayerdiag.html harness page, which does not exist in a production BUILD');
  await openPlayer(page);

  const shareBtn = page.getByRole('button', { name: 'Share' });
  await expect(shareBtn).toBeVisible();

  const buttons = await toolbarButtons(page).all();
  const names = await Promise.all(buttons.map((b) => b.innerText()));
  expect(names[0].trim()).toBe('Share');

  const box = await shareBtn.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.y + box.height).toBeLessThanOrEqual(844);

  await saveEvidence(page, 'T8540-mobile-390x844-share-first-in-viewport');
  await context.close();
});
