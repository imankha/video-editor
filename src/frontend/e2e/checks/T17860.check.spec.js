/**
 * T17860 - per-criterion acceptance checks (group checks protocol).
 *
 * In Frame, "Trim and slow motion" opens the trim and speed track. Owner ruling 2026-11-19
 * (UX expert design): while open the button reads "Done trimming" with a check icon (T17910 renamed it "Close
 * trimming" and kept the scissors; the checks assert the current label), carries
 * aria-expanded and a pressed look; Preview gets the same pressed look while previewing, and
 * neither button carries aria-pressed next to its changing label.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17860.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck } from '../helpers/checkAuth';
import { framePlayPath } from '../helpers/frameVideoCheck';
import { closeKeepsEdits, expectClosed, expectOpen, openFrame, trimButton } from '../helpers/trimToggleCheck';

test.setTimeout(300000);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const previewButton = (page) => page.getByTestId('framing-preview-toggle');
// The band's main CTA: "Sharpen!", or "Watch highlight" in the same slot when the
// play the account loads was already sharpened.
const sharpenButton = (page) => page.getByTestId('action-band')
  .getByRole('button', { name: /^(Sharpen!|Watch highlight)/ }).first();

/**
 * Border colour at rest: the pointer is moved off first so a hover style is never measured,
 * and the card's transition-colors (150ms) is allowed to finish.
 */
async function borderColor(page, locator) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
  return locator.evaluate((el) => getComputedStyle(el).borderTopColor);
}

for (const [label, viewport] of [['1440', DESKTOP], ['390', PHONE]]) {
  test.describe(`at ${label} wide`, () => {
    test.use({ viewport, ...(viewport === PHONE ? { hasTouch: true, isMobile: true } : {}) });

    test(`T17860:C1 - at ${label} wide the open Trim button reads its open label (T17910: "Close trimming"), aria-expanded="true", a different border colour, and the track shows`, async ({ context, page }) => {
      await loginForCheck(context);
      await openFrame(page, await framePlayPath(page));
      await expectClosed(page);
      const closedBorder = await borderColor(page, trimButton(page));
      await trimButton(page).click();
      await expectOpen(page);
      await expect.poll(() => borderColor(page, trimButton(page)), { timeout: 10000 }).not.toBe(closedBorder);
    });
  });
}

test.describe('at 1440 wide', () => {
  test.use({ viewport: DESKTOP });

  test('T17860:C2 - tapping the open Trim button (T17910: "Close trimming") hides the track and restores the closed button; trim and speed edits made while open still apply', async ({ context, page }) => {
    await loginForCheck(context);
    const framePath = await framePlayPath(page, { preferExpired: false });
    await closeKeepsEdits(page, framePath);
  });

  test('T17860:C4 - while previewing, Preview shows the pressed look and neither button carries aria-pressed', async ({ context, page }) => {
    await loginForCheck(context);
    await openFrame(page, await framePlayPath(page));
    const preview = previewButton(page);
    await expect(preview).not.toHaveAttribute('aria-pressed', /.*/);
    const idle = await borderColor(page, preview);

    await trimButton(page).click();
    await expectOpen(page);
    const trimPressed = await borderColor(page, trimButton(page));
    await trimButton(page).click();
    await expectClosed(page);

    await preview.click();
    await expect(preview).toContainText('Close preview', { timeout: 30000 });
    await expect(preview).not.toHaveAttribute('aria-pressed', /.*/);
    await expect(trimButton(page)).not.toHaveAttribute('aria-pressed', /.*/);
    await expect.poll(() => borderColor(page, preview), { timeout: 10000 }).not.toBe(idle);
    expect(await borderColor(page, preview), 'Preview pressed matches Trim pressed').toBe(trimPressed);
  });
});

test.describe('at 390 wide', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('T17860:C3 - at 390 wide the Trim button is at least 44px high in both states and Sharpen! does not move or resize', async ({ context, page }) => {
    await loginForCheck(context);
    await openFrame(page, await framePlayPath(page));
    await page.waitForTimeout(1000);
    const closedTrim = await trimButton(page).boundingBox();
    const closedSharpen = await sharpenButton(page).boundingBox();
    expect(closedTrim.height, 'closed Trim height').toBeGreaterThanOrEqual(44);

    await trimButton(page).click();
    await expectOpen(page);
    await page.waitForTimeout(1500);
    const openTrim = await trimButton(page).boundingBox();
    const openSharpen = await sharpenButton(page).boundingBox();
    expect(openTrim.height, 'open Trim height').toBeGreaterThanOrEqual(44);
    for (const k of ['x', 'y', 'width', 'height']) {
      expect(Math.abs(openSharpen[k] - closedSharpen[k]), `Sharpen ${k} unchanged`).toBeLessThanOrEqual(0.5);
    }
  });
});
