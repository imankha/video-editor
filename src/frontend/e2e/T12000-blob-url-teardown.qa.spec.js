/**
 * T12000 - Blob URL revoked while a video still reads it.
 *
 * The bug: ERR_FILE_NOT_FOUND on a blob: request right after a game upload.
 * `extractVideoMetadata` (utils/videoMetadata.js) used to revoke the temporary
 * object URL BEFORE detaching the <video> element from it (no
 * `removeAttribute('src')` / `load()` first) — a non-faststart MP4 can keep
 * issuing range reads against the element's src after the URL is already dead.
 * `captureVideoFrame.js` already did the correct teardown order; this fix
 * mirrors it.
 *
 * REAL-BROWSER ONLY against a real account with a video upload (ERR_FILE_NOT_FOUND
 * is a real network-stack behavior, not reproducible against a mock). Authored as
 * a QA artifact — needs Playwright browsers + a live backend, so it is NOT run in
 * Branch CI; run it against a stack serving CURRENT code via:
 *   bash scripts/dev-verify.sh e2e/T12000-blob-url-teardown.qa.spec.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/wcfc-carlsbad-trimmed.mp4');

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';

test.describe('T12000 blob: URL teardown on game upload', () => {
  test.setTimeout(120000);

  test('uploading a game produces zero blob: requestfailed events', async ({ page, context }) => {
    await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const blobFailures = [];
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('blob:')) {
        blobFailures.push({
          url: request.url(),
          failure: request.failure()?.errorText,
        });
      }
    });

    await page.getByRole('button', { name: 'Upload game' }).click();
    await page.getByTestId('footage-file-input').setInputFiles(TEST_VIDEO);

    // Metadata extraction (extractVideoMetadata) runs as soon as the file is
    // picked, off the footage-ready state — give it time to create + revoke
    // the object URL before asserting on requestfailed events.
    await expect(page.getByTestId('footage-picker-ready-single')).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2000);

    expect(blobFailures, JSON.stringify(blobFailures)).toHaveLength(0);
  });
});
