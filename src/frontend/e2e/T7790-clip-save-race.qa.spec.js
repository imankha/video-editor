import { test, expect } from '@playwright/test';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * T7790 — Imported clips reach the library even when the TSV import races the
 * game-record creation of a still-uploading game.
 *
 * The bug: `importAnnotationsWithRawClips` read `annotateGameId` ONCE at import
 * time. On a slow/cold upload the game record isn't created yet (`onGameCreated`
 * hasn't fired), so the id was null and every clip save was silently dropped with
 * only a console.warn — the id then arrived seconds later but nothing re-fired the
 * saves, so the clips never reached the library (intermittent "1 of 3 / 0 of 3"
 * loss). The fix waits for the in-flight upload to produce the id, then saves.
 *
 * This test forces the race DETERMINISTICALLY by delaying `POST /api/games` (the
 * request that creates the record and fires `onGameCreated`) and importing the TSV
 * immediately. On the pre-fix code all 3 clips are lost (final count 0); the fix
 * makes all 3 reach the library.
 *
 * Uses the empty test-session bypass (X-User-ID + test-login) — no real account or
 * R2 fixture needed, so it runs anywhere with chromium + the local stack.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_TSV = path.join(TEST_DATA_DIR, 'test.short.tsv');
const TEST_USER_ID = `e2e_t7790_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

test.use({ viewport: { width: 1280, height: 800 } });

test.afterAll(async ({ request }) => {
  // Delete the whole throwaway test-user folder (DB + video + clips) from R2.
  await request.delete('/api/auth/user', { headers: { 'X-User-ID': TEST_USER_ID } }).catch(() => {});
});

test('TSV import that races game creation still saves every clip (T7790)', async ({ page }) => {
  test.setTimeout(180000);

  await page.setExtraHTTPHeaders({ 'X-Test-Mode': 'true', 'X-User-ID': TEST_USER_ID });
  // R2 presigned URLs must not carry the test headers (CORS preflight).
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
  await page.route('**/api/auth/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user_id: TEST_USER_ID, email: 'e2e@test.local' }),
    });
  });
  // Delay ONLY the create-game POST (exact /api/games), not its sub-routes
  // (prepare-upload, activate). This holds `onGameCreated` back so the TSV import
  // below runs while the game id is still unknown — the exact race being fixed.
  await page.route('**/api/games', async (route) => {
    if (route.request().method() === 'POST') {
      await new Promise((r) => setTimeout(r, 8000));
    }
    await route.continue();
  });

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  // Ensure we run the freshest bundle, not a stale PWA-cached one.
  await page.evaluate(async () => {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    }
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');

  // Open the Add Game modal and fill it.
  await page.locator('button:has-text("Games")').click();
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Add Game")').click();
  await page.waitForTimeout(500);
  await openGameDetailsDisclosure(page);
  await page.getByPlaceholder('e.g., Carlsbad SC').fill('T7790 Race');
  await page.locator('input[type="date"]').fill(new Date().toISOString().split('T')[0]);
  await page.getByRole('button', { name: 'Home' }).click();
  await page.locator('form input[type="file"][accept*="video"]').setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(500);
  const createButton = page.locator('form button:has-text("Add Game")');
  await expect(createButton).toBeEnabled({ timeout: 5000 });
  await createButton.click();

  // Import the TSV as soon as the input is attached — this races the delayed
  // game creation, so the raw-clip game id is still unknown at import time.
  const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
  await expect(tsvInput).toBeAttached({ timeout: 15000 });
  await tsvInput.setInputFiles(TEST_TSV);
  await expect(page.locator('text=Good Pass').first()).toBeVisible({ timeout: 15000 });

  // Poll the library. The fix waits for the in-flight upload to create the game
  // record, then fires the saves — all 3 imported clips must land.
  await expect
    .poll(
      async () => {
        const clips = await page.evaluate(async () => {
          const res = await fetch('/api/clips/raw');
          return res.ok ? await res.json() : [];
        });
        return clips.length;
      },
      {
        message: 'all 3 clips imported during the upload race must reach the library',
        timeout: 45000,
        intervals: [1000, 1000, 2000],
      },
    )
    .toBe(3);
});
