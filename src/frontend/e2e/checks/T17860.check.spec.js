/**
 * T17860 - per-criterion acceptance checks (group checks protocol).
 *
 * In Frame, "Trim and slow motion" opens the trim and speed track. Owner ruling 2026-11-19
 * (UX expert design): while open the button reads "Done trimming" with a check icon, carries
 * aria-expanded and a pressed look; Preview gets the same pressed look while previewing, and
 * neither button carries aria-pressed next to its changing label.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17860.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { framePlayPath } from '../helpers/frameVideoCheck';
import { pressAndSave, resetClip, splitAt } from '../helpers/trimSplitScenario';

test.setTimeout(300000);

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

const trimButton = (page) => page.getByTestId('trim-slowmo-button');
const previewButton = (page) => page.getByTestId('framing-preview-toggle');
// The band's main CTA: "Sharpen my highlight", or "Watch highlight" in the same slot when the
// play the account loads was already sharpened.
const sharpenButton = (page) => page.getByTestId('action-band')
  .getByRole('button', { name: /^(Sharpen my highlight|Watch highlight)/ }).first();

/** Open Frame on a play that loads, wait for the video, guidance off, track closed. */
async function openFrame(page, framePath) {
  await page.goto(framePath);
  const stage = page.getByTestId('focus-video-stage');
  await stage.waitFor({ timeout: 90000 });
  await expect(page.locator('#preloader')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByText('Connecting...')).toHaveCount(0, { timeout: 90000 });
  await expect.poll(
    () => stage.locator('video').first().evaluate((v) => v.readyState).catch(() => 0),
    { timeout: 90000 },
  ).toBeGreaterThanOrEqual(2);
  await disableGuidanceForCheck(page);
  await expect(trimButton(page)).toBeVisible({ timeout: 30000 });
  await expect(page.getByTestId('speed-track')).toHaveCount(0);
}

/**
 * Border colour at rest: the pointer is moved off first so a hover style is never measured,
 * and the card's transition-colors (150ms) is allowed to finish.
 */
async function borderColor(page, locator) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(400);
  return locator.evaluate((el) => getComputedStyle(el).borderTopColor);
}
const iconClass = (locator) => locator.locator('svg').first().getAttribute('class');

async function expectClosed(page) {
  const btn = trimButton(page);
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(btn).toHaveAttribute('aria-label', 'Trim and slow motion');
  await expect(btn).toContainText('Trim and slow motion');
  expect(await iconClass(btn)).toMatch(/lucide-scissors/);
  await expect(btn).not.toHaveAttribute('aria-pressed', /.*/);
}

async function expectOpen(page) {
  const btn = trimButton(page);
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await expect(btn).toHaveAttribute('aria-label', 'Done trimming');
  await expect(btn).toContainText('Done trimming');
  expect(await iconClass(btn)).toMatch(/lucide-check/);
  await expect(btn).not.toHaveAttribute('aria-pressed', /.*/);
  await expect(page.getByTestId('speed-track')).toBeVisible({ timeout: 30000 });
}

for (const [label, viewport] of [['1440', DESKTOP], ['390', PHONE]]) {
  test.describe(`at ${label} wide`, () => {
    test.use({ viewport, ...(viewport === PHONE ? { hasTouch: true, isMobile: true } : {}) });

    test(`T17860:C1 - at ${label} wide the open Trim button reads "Done trimming" with a check, aria-expanded="true", a different border colour, and the track shows`, async ({ context, page }) => {
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

  test('T17860:C2 - tapping Done trimming hides the track and restores the closed button; trim and speed edits made while open still apply', async ({ context, page }) => {
    await loginForCheck(context);
    const framePath = await framePlayPath(page, { preferExpired: false });
    const projectId = framePath.split('/').pop();
    const clipSegments = async () => {
      const res = await page.request.get(checkApi(`/clips/projects/${projectId}/clips`));
      expect(res.ok()).toBeTruthy();
      const [clip] = await res.json();
      return JSON.stringify(clip.segments_data ?? null);
    };
    // The highlight's output length (post-trim, post-speed) as the Frame page shows it.
    const lengthChip = page.getByTestId('output-length-chip').locator('visible=true').first();
    const highlightLength = async () => (await lengthChip.textContent()).trim();
    const slowSpeed = page.getByTestId('speed-track').getByText('0.5x slow motion');
    await openFrame(page, framePath);
    await trimButton(page).click();
    await expectOpen(page);
    await resetClip(page);
    const normalSpeed = page.getByTestId('speed-track').locator('button[title^="Set speed to 1x"]');
    while (await normalSpeed.count()) await pressAndSave(page, normalSpeed.first(), ['set_segment_speed']);

    // Edits while open: split, then trim the last section (shortens the highlight).
    await splitAt(page, 0.5);
    const trimSection = page.getByTestId('speed-track').locator('button[title="Trim section"]');
    await expect(trimSection).toHaveCount(2, { timeout: 30000 });
    await pressAndSave(page, trimSection.last(), ['set_trim_range']);
    await expect(page.locator('button[title^="Undo end trim"]')).toHaveCount(1, { timeout: 30000 });
    // ...and slow the first section to 0.5x (lengthens the highlight).
    const trimmedLength = await highlightLength();
    await pressAndSave(page, page.getByTestId('speed-track').locator('button[title="Set speed to 0.5x"]').first(), ['set_segment_speed']);
    await expect(slowSpeed).toHaveCount(1, { timeout: 30000 });
    await expect.poll(highlightLength, { message: 'the 0.5x section lengthens the highlight', timeout: 10000 }).not.toBe(trimmedLength);
    await page.waitForTimeout(1500);
    const edited = await clipSegments();
    const editedLength = await highlightLength();
    expect(Object.values(JSON.parse(edited)?.segmentSpeeds ?? {}), 'the server holds the 0.5x speed').toContain(0.5);

    // Closing is not an edit: no save is sent and the track hides.
    const saves = [];
    page.on('request', (r) => { if (r.method() === 'POST' && /\/clips\/.*\/actions/.test(r.url())) saves.push(r.url()); });
    await trimButton(page).click();
    await expect(page.getByTestId('speed-track')).toHaveCount(0, { timeout: 30000 });
    await expectClosed(page);
    await page.waitForTimeout(2000);
    expect(saves, 'closing the track sends no save').toEqual([]);
    expect(await clipSegments(), 'the trim, split and speed are unchanged by closing').toBe(edited);
    expect(await highlightLength(), 'the highlight length is unchanged by closing').toBe(editedLength);

    // Reopening shows the same trim still applied.
    await trimButton(page).click();
    await expectOpen(page);
    await expect(page.locator('button[title^="Undo end trim"]')).toHaveCount(1, { timeout: 30000 });
    await expect(slowSpeed, 'the 0.5x speed is still applied after reopening').toHaveCount(1);
    expect(await highlightLength()).toBe(editedLength);
    await pressAndSave(page, normalSpeed.first(), ['set_segment_speed']);
    await resetClip(page);
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
    await expect(preview).toContainText('Back to full video', { timeout: 30000 });
    await expect(preview).not.toHaveAttribute('aria-pressed', /.*/);
    await expect(trimButton(page)).not.toHaveAttribute('aria-pressed', /.*/);
    await expect.poll(() => borderColor(page, preview), { timeout: 10000 }).not.toBe(idle);
    expect(await borderColor(page, preview), 'Preview pressed matches Trim pressed').toBe(trimPressed);
  });
});

test.describe('at 390 wide', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('T17860:C3 - at 390 wide the Trim button is at least 44px high in both states and Sharpen my highlight does not move or resize', async ({ context, page }) => {
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
