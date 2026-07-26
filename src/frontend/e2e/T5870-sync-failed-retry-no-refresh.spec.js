import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget, assertSeamAvailable } from './helpers/targetEnv.js';

/**
 * T5870 — real-browser proof of the two defects' fixes, driving the REAL backend
 * sync path (no mocked headers — jsdom cannot prove this class of bug):
 *
 *   (B) A genuine R2 failure surfaces the alarm banner "Could not save to the
 *       cloud" WITH a Retry button, and clicking Retry (once R2 recovers) CLEARS
 *       the banner WITHOUT a page refresh — the exact "only a refresh helps" bug.
 *   (also) While R2 is still down, Retry states the failure honestly and does NOT
 *       loop or falsely succeed.
 *
 * Seeds a real failure via the FORCE_R2_SYNC_FAILURE seam (dev/local-only, now
 * covering the primitive-direct re-drain/retry paths too, T5870), then a real
 * write (PUT /api/settings -> user.sqlite sync) whose background re-drain
 * exhausts against the forced fault and marks .sync_failed.
 *
 * Run (from a /dotask container): bash scripts/dev-verify.sh \
 *   e2e/T5870-sync-failed-retry-no-refresh.spec.js
 */

const USER = 'manual-test-user';
const H = { 'X-User-ID': USER, 'X-Test-Mode': 'true' };

async function pageFetch(page, path) {
  // Drive a fetch FROM the page so the real window.fetch interceptor
  // (syncStore.checkSyncStatus) sees the X-Sync-Status header.
  await page.evaluate(async (p) => { try { await fetch(p, { credentials: 'include' }); } catch { /* ignore */ } }, path);
}

test('T5870: failed banner + Retry clears WITHOUT a page refresh (real backend)', async ({ context, page }) => {
  skipOnDeployedTarget(test, 'uses /api/test/sync-fault fault-injection seam (dev/local-only)');
  test.setTimeout(120000);
  const req = context.request;

  // --- auth: empty e2e user via the test-login bypass -----------------------
  await context.setExtraHTTPHeaders(H);
  const login = await req.post('/api/auth/test-login', { headers: { 'Content-Type': 'application/json', ...H } });
  expect(login.ok(), 'POST /api/auth/test-login').toBeTruthy();

  // clean slate — clear any leftover fault (also asserts the seam is mounted)
  const clear = await req.post('/api/test/sync-fault', { data: { enabled: false } });
  assertSeamAvailable(clear, 'sync-fault');
  expect(clear.status()).toBe(200);

  // --- load the app; bypass the auth gate; mark the page to detect reloads ---
  await page.goto('/');
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
    window.__t5870_noReload = true; // cleared by any full page reload
  });

  // --- 1) force R2 down, then a REAL write -> re-drain exhausts -> .sync_failed
  await req.post('/api/test/sync-fault', { data: { enabled: true } });
  // framing is a persisted section (projectFilters is ignored); a sub-key here
  // writes user.sqlite -> triggers the background sync that the fault fails.
  const write = await req.put('/api/settings', { data: { framing: { t5870probe: 'x' } } });
  expect(write.ok(), 'PUT /api/settings (real user.sqlite write)').toBeTruthy();

  // --- 2) the alarm banner appears (poll the page so its interceptor sees the
  //        X-Sync-Status: failed header; 3s show-delay + backoff re-drain) -----
  await expect(async () => {
    await pageFetch(page, '/api/status');
    await expect(page.getByText(/could not save to the cloud/i)).toBeVisible({ timeout: 4000 });
  }).toPass({ timeout: 40000 });
  await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();

  // --- 3) Retry while STILL faulted -> honest failure, banner stays ----------
  await page.getByRole('button', { name: /^retry$/i }).click();
  await page.waitForTimeout(1500);
  await pageFetch(page, '/api/status');
  await expect(page.getByText(/could not save to the cloud/i)).toBeVisible();

  // --- 4) clear the fault, Retry again -> banner clears with NO reload -------
  await req.post('/api/test/sync-fault', { data: { enabled: false } });
  await page.getByRole('button', { name: /^retry$/i }).click();
  await expect(async () => {
    await pageFetch(page, '/api/status');
    await expect(page.getByText(/could not save to the cloud/i)).toBeHidden({ timeout: 4000 });
  }).toPass({ timeout: 30000 });

  // proof the recovery happened in-place, not via a page refresh
  const noReload = await page.evaluate(() => window.__t5870_noReload === true);
  expect(noReload, 'banner cleared WITHOUT a page reload').toBe(true);
});
