import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T17500: every place that plays a video this browser can only play the sound of says why.
 *
 * Fixtures (2 s, 160x90, with AAC sound): T17500-hevc-sound-only.mp4 is HEVC Main10 (an iPhone
 * "High Efficiency" recording); T17500-h264.mp4 is H.264. The checks' Chromium has no HEVC
 * decoder, so it loads the HEVC file as sound with a 0x0 picture and no media error, which is
 * exactly what Windows Chrome without an HEVC decoder does (T17280, bug 62p).
 *
 * C2 opens Frame on an existing play and serves the HEVC bytes for its video (page.route on the
 * media request): the play's saved clip is then, byte for byte, an HEVC clip.
 */
test.setTimeout(240000);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEVC = path.join(__dirname, 'fixtures', 'T17500-hevc-sound-only.mp4');
const H264 = path.join(__dirname, 'fixtures', 'T17500-h264.mp4');
const MESSAGE = /can't show this video's picture, only its sound/;

async function listedProjects(page) {
  const res = await page.request.get(checkApi('/projects'));
  expect(res.ok(), `/projects -> ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return Array.isArray(body) ? body : body.projects || [];
}

async function openClipPicker(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await disableGuidanceForCheck(page);
  await page.getByRole('button', { name: /^Plays\b/ }).first().click();
  await page.getByTestId('home-upload-clip').first().click();
  await page.getByRole('button', { name: 'Continue' }).click();
}

// Serve `file` for every video element request (the player's media fetch, not the app's
// metadata fetch), with the CORS headers a cross-origin storage URL needs.
async function serveVideoBytes(page, file) {
  const bytes = fs.readFileSync(file);
  await page.route('**/*', (route) => {
    const req = route.request();
    if (req.resourceType() !== 'media') return route.fallback();
    const origin = req.headers().origin;
    return route.fulfill({
      status: 200,
      body: bytes,
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'none',
        ...(origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true' } : {}),
      },
    });
  });
}

async function openFrame(page) {
  const list = await listedProjects(page);
  const project = list.find((p) => p.clip_count > 0);
  expect(project, 'a play with a clip to open in Frame').toBeTruthy();
  const p = `/focus/p/${project.id}`;
  await page.goto(p);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 60000 }).toBe(p);
  // The player element loaded its metadata (duration known).
  await expect.poll(
    () => page.locator('video').first().evaluate((v) => v.readyState).catch(() => -1),
    { timeout: 60000 },
  ).toBeGreaterThanOrEqual(1);
}

test.describe('T17500 sound-only videos are explained everywhere', () => {
  test('T17500:C1 a sound-only file uploaded as a play shows the game-upload message and is not uploaded', async ({ context, page }) => {
    await loginForCheck(context);
    const uploadCalls = [];
    page.on('request', (r) => {
      if (/\/api\/(games\/prepare-upload|clips\/upload)/.test(r.url())) uploadCalls.push(r.url());
    });
    await openClipPicker(page);
    await page.getByTestId('clip-upload-input').setInputFiles(HEVC);

    await expect(page.getByText(MESSAGE).first()).toBeVisible({ timeout: 60000 });
    const rail = page.getByTestId('clip-uploading-rail');
    await expect(rail).toContainText('T17500-hevc-sound-only.mp4');
    await expect(rail).toContainText(MESSAGE);
    await expect(rail.getByRole('button', { name: 'Retry' })).toHaveCount(0);
    await page.waitForTimeout(2000); // give a wrongly started upload time to show up
    expect(uploadCalls, 'nothing was uploaded').toEqual([]);
  });

  test('T17500:C2 Frame on a play whose saved clip is HEVC shows the message, not a silent black box', async ({ context, page }) => {
    await loginForCheck(context);
    await serveVideoBytes(page, HEVC);
    await openFrame(page);
    await expect(page.getByRole('alert').filter({ hasText: MESSAGE }).first()).toBeVisible({ timeout: 60000 });
  });

  test('T17500:C4 an H.264 video shows no message in Frame or on a play upload', async ({ context, page }) => {
    await loginForCheck(context);
    await serveVideoBytes(page, H264);
    await openFrame(page);
    await expect.poll(
      () => page.locator('video').first().evaluate((v) => v.videoWidth),
      { timeout: 60000 },
    ).toBe(160);
    await page.waitForTimeout(2000);
    await expect(page.getByText(MESSAGE)).toHaveCount(0);

    // A play upload of an H.264 file starts uploading with no message. The upload itself is
    // stopped at the network so the check leaves no clip behind.
    await page.unroute('**/*');
    await page.route(/\/api\/games\/prepare-upload/, (route) => route.abort('internetdisconnected'));
    await openClipPicker(page);
    await page.getByTestId('clip-upload-input').setInputFiles(H264);
    await expect(page.getByText('Uploading T17500-h264.mp4...').first()).toBeVisible({ timeout: 60000 });
    await expect(page.getByText(MESSAGE)).toHaveCount(0);
  });
});
