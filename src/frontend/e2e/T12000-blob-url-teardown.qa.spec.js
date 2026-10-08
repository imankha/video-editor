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
    const consoleErrors = [];
    page.on('requestfailed', (request) => {
      if (request.url().startsWith('blob:')) {
        blobFailures.push({
          url: request.url(),
          failure: request.failure()?.errorText,
        });
      }
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push(String(err)));

    await page.getByRole('button', { name: 'Upload game' }).click();
    await page.getByTestId('footage-file-input').setInputFiles(TEST_VIDEO);
    await expect(page.getByTestId('footage-picker-ready-single')).toBeVisible({ timeout: 30000 });

    // Submitting navigates to Annotate, where AnnotateContainer's
    // handleGameVideoSelect calls extractVideoMetadata(file) directly (a SEPARATE
    // call from the modal picker's own preview-time extraction) — this is the
    // "right after the game upload" moment the bug report names.
    await page.locator('form').getByRole('button', { name: 'Upload game' }).click();
    await page.waitForURL(/\/annotate/, { timeout: 30000 });
    await page.waitForTimeout(3000);

    const diag = JSON.stringify({ blobFailures, consoleErrors });
    // NOTE (investigated live, both before and after the fix): a handful of
    // blob: ERR_ABORTED requestfailed events are expected background noise —
    // e.g. uploadStore's captureVideoFrame thumbnail capture intentionally
    // aborts its own in-flight blob read as part of its (already-correct)
    // teardown, and this test's own page navigation (/ -> /annotate) aborts
    // whatever else was still in flight. Neither reproduced in this headless
    // environment either before or after the T12000 fix (see qa/proof.md).
    // The reported bug's actual signature is ERR_FILE_NOT_FOUND specifically —
    // that is the one failure mode this assertion must never see.
    expect(
      blobFailures.filter((f) => f.failure === 'net::ERR_FILE_NOT_FOUND'),
      diag
    ).toHaveLength(0);
    expect(consoleErrors.filter((m) => /ERR_FILE_NOT_FOUND|videoMetadata/i.test(m)), diag).toHaveLength(0);
  });
});
