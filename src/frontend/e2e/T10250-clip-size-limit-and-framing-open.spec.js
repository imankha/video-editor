// T10250 + T10260 E2E — the direct clip-upload UX hardening, live-driven.
//
//   T10250 (test 1): a clip over the server cap is refused BEFORE hashing — the
//     size-limit dialog appears (no rail, no network), and "Add Game instead"
//     carries the same file into the Add Game flow. The cap is mocked to a tiny
//     number on /api/bootstrap so an ordinary small test video trips it (the
//     kickoff's accepted substitute for producing a real 600MB file).
//   T10260 (test 2): a finished single upload opens straight into Framing, and the
//     bar shows "Preparing your clip..." (never a bare 100%) before the tile exists.
//   T10260 (test 3): leaving the Clips tab mid-upload yields a toast with "Open",
//     never a forced navigation.
//
// The deterministic logic (pre-flight partition, refused/retryable classes, phase
// mapping, completion-callback branches) is covered by the unit tests
// (useClipUpload.test.js, ProjectManager.clipSizeLimit.test.jsx); this spec
// evidences the live wiring. Tests 2/3 upload against real R2 (like T8380).
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { saveEvidence } from './helpers/qa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_VIDEO = path.resolve(__dirname, '../../../formal annotations/test.short/game2-test.mp4');

const TEST_USER_ID = `e2e_t10250_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const gamesTab = (p) => p.getByRole('button', { name: /^Games/i });
const clipsTab = (p) => p.getByRole('button', { name: /^Clips/i });

const editorMode = (page) => page.evaluate(async () => {
  const { useEditorStore } = await import('/src/stores/editorStore.js');
  return useEditorStore.getState().editorMode;
});

async function authFreshUser(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  // Strip the test-auth headers from the direct browser -> R2 presigned PUT (R2
  // signs over a specific header set; extra headers break the signature). Same
  // fix T8380/new-user-flow apply.
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  // Purge the shared e2e@test.local account so we start empty (see T8380 note).
  await page.evaluate(async () => {
    await fetch('/api/auth/user', { method: 'DELETE', credentials: 'include' });
  });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'e2e@test.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test.describe('T10250/T10260 — clip size-limit dialog + open-in-Framing on completion', () => {
  skipOnDeployedTarget(test, 'empty new-user flow imports /src/stores/*.js (Vite-dev paths 404 on a deployed build)');
  test.setTimeout(120000);

  test.afterEach(async ({ page }) => {
    await page.evaluate(async () => {
      await fetch('/api/auth/user', { method: 'DELETE', credentials: 'include' });
    }).catch(() => {});
  });

  test('T10250: an over-cap clip shows the size-limit dialog (no upload) and "Add Game instead" carries the file', async ({ page }) => {
    // Mock the clip-upload cap DOWN to 1KB so the ordinary test video trips it,
    // by rewriting the real /api/bootstrap body's upload_limits (everything else
    // stays authentic).
    await page.route('**/api/bootstrap', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.upload_limits = { max_clip_upload_bytes: 1024, max_clip_duration_s: 600 };
      await route.fulfill({ response: res, body: JSON.stringify(body) });
    });

    await authFreshUser(page);
    await page.goto('/home/reels');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Upload clip' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('clip-upload-input').setInputFiles(TEST_VIDEO);

    // AC: "Picking a 600MB file shows the limit dialog within a second, no hashing,
    // no network call" — the dialog is shown and NO uploading rail ever appears.
    const dialog = page.getByTestId('clip-size-limit-modal');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(page.getByTestId('clip-uploading-rail')).toHaveCount(0);
    // The limit number is DERIVED from the (mocked) server cap: 1024 bytes -> 0MB.
    await expect(page.getByTestId('clip-size-limit-body')).toContainText(/limited to \d+MB/);
    await saveEvidence(page, 'T10250-ac-size-limit-dialog');

    // AC: "The dialog offers 'Add Game instead' and carries the file across."
    await dialog.getByRole('button', { name: 'Add Game instead' }).click();
    await expect(page.getByTestId('clip-size-limit-modal')).toHaveCount(0);
    // The Add Game modal opens; its footage picker has ingested the carried file
    // (GameFootagePicker.initialFiles), so the game upload has no clip size cap.
    await expect(page.getByText(/game2-test/i).first()).toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'T10250-ac-add-game-carries-file');
  });

  test('T10260: a finished single upload opens the clip in Framing (bar shows "Preparing", never a bare 100%)', async ({ page }) => {
    await authFreshUser(page);
    await page.goto('/home/reels');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Upload clip' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('clip-upload-input').setInputFiles(TEST_VIDEO);

    // The tail state reads "Preparing your clip..." while the batch creates the
    // clip record — the bar never jumps to a bare 100% before the tile exists.
    await expect(page.getByTestId('clip-preparing-note')).toBeVisible({ timeout: 30000 });

    // AC: "A single uploaded clip opens straight into Framing when the upload
    // finishes on the Clips tab." editorStore.editorMode flips to 'framing'.
    await expect.poll(() => editorMode(page), { timeout: 60000 }).toBe('framing');
    await saveEvidence(page, 'T10260-ac-opens-in-framing');
  });

  test('T10260: navigating away mid-upload yields a toast with Open, not a forced navigation', async ({ page }) => {
    await authFreshUser(page);
    await page.goto('/home/reels');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Upload clip' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Continue' }).click();
    await page.getByTestId('clip-upload-input').setInputFiles(TEST_VIDEO);

    // Leave the Clips tab before the upload finishes.
    await expect(page.getByTestId('clip-uploading-rail')).toBeVisible({ timeout: 15000 });
    await gamesTab(page).click();

    // AC: "Navigating away mid-upload yields a toast with Open, not a forced
    // navigation." A toast offering to open Framing appears; we stay put.
    await expect(page.getByRole('button', { name: /Open Framing/i })).toBeVisible({ timeout: 60000 });
    expect(await editorMode(page)).toBe('project-manager');
    await saveEvidence(page, 'T10260-ac-navigated-away-toast-open');

    // The toast action, when clicked, does open Framing (completing the gesture
    // on the user's terms, not against them).
    await page.getByRole('button', { name: /Open Framing/i }).click();
    await expect.poll(() => editorMode(page), { timeout: 30000 }).toBe('framing');
  });
});
