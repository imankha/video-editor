import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T6040 — a reader on a `conflict` machine (R2 AHEAD of local, so the reader is
 * looking at STALE data) previously saw nothing at all -- T5960/T6010 correctly
 * suppressed the ALARM for a no-write session, but suppressed the only signal a
 * reader had that their data was stale, and the only affordance to fix it.
 *
 * This spec pins the full matrix from the task's acceptance criteria:
 *   - conflict + zero writes -> quiet non-alarm notice + Reload (NEW)
 *   - conflict + a write -> today's red alarm + Retry, unchanged (regression pin)
 *   - failed + zero writes -> still silent (T6010 regression pin; asymmetric --
 *     `failed` means LOCAL is ahead, so a reader there has the newest data)
 *   - pending -> still quiet + ungated (regression pin)
 *   - the reader's Reload reaches the restore path and does NOT show the
 *     writer-only "your local changes were replaced" notice
 *
 * Same simulation technique as T5960/T6010 (report this): a real cross-machine
 * CAS conflict needs two boxes and cannot be manufactured on a single-box
 * /dotask container, so this spec injects `X-Sync-Status` via Playwright
 * `page.route`. Assertions are on what the USER SEES, never the API response.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T6040-reader-sees-stale-data-silently.spec.js
 */

const H = { 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' };
const ALARM_BANNER = /could not save to the cloud/i;
const READER_NOTICE = /newer version of your work is available/i;
const REPLACED_NOTICE = /your local changes were replaced/i;

async function installStatusShim(page, status, injecting = true, retryBody = { success: true }) {
  const state = { injecting, status, retryBody };
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/retry-sync')) {
      state.injecting = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(state.retryBody),
      });
      return;
    }
    const resp = await route.fetch();
    const headers = { ...resp.headers() };
    if (state.injecting) headers['x-sync-status'] = state.status;
    else delete headers['x-sync-status'];
    await route.fulfill({ response: resp, headers });
  });
  return state;
}

async function authAndLoad(context, page) {
  await context.setExtraHTTPHeaders(H);
  const login = await context.request.post('/api/auth/test-login', {
    headers: { 'Content-Type': 'application/json', ...H },
  });
  expect(login.ok(), 'POST /api/auth/test-login').toBeTruthy();

  await page.goto('/');
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
    window.__t6040_noReload = true; // cleared by any full page reload
  });
}

async function pagePing(page) {
  await page.evaluate(async () => {
    try { await fetch('/api/status', { credentials: 'include' }); } catch { /* ignore */ }
  });
}

// A REAL mutating request FROM the page, so the interceptor arms hasAttemptedWrite.
async function pageWrite(page) {
  await page.evaluate(async () => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framing: { t6040probe: 'x' } }),
      });
    } catch { /* ignore */ }
  });
}

test.describe('T6040 — reader on a conflicted machine gets a quiet notice, not silence', () => {
  test.beforeEach(() => {
    skipOnDeployedTarget(test, 'injects X-Sync-Status via page.route + PUT /api/settings write');
  });

  test('criterion 1: conflict + zero writes -> quiet non-alarm notice with Reload (NOT the red alarm)', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'conflict');
    await authAndLoad(context, page);

    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }

    await expect(page.getByText(ALARM_BANNER)).toBeHidden();
    await expect(page.getByRole('button', { name: /^retry$/i })).toBeHidden();
    await expect(page.getByText(READER_NOTICE)).toBeVisible();
    await expect(page.getByRole('button', { name: /^reload$/i })).toBeVisible();
    await saveEvidence(page, 'criterion-1-reader-conflict-notice');
  });

  test('criterion 2: conflict + a write this session -> red alarm + Retry, byte-for-byte unchanged (regression pin)', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'conflict');
    await authAndLoad(context, page);

    await pagePing(page);
    await page.waitForTimeout(3500);
    await expect(page.getByText(ALARM_BANNER)).toBeHidden();

    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(ALARM_BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await expect(page.getByText(/newer version of your work exists/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /^retry$/i })).toBeVisible();
    // Never the quiet reader notice/Reload once this session has written.
    await expect(page.getByRole('button', { name: /^reload$/i })).toBeHidden();
    await saveEvidence(page, 'criterion-2-writer-conflict-alarm-unchanged');
  });

  test('criterion 3: failed + zero writes -> still renders nothing (T6010 regression pin -- local is AHEAD here)', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'failed');
    await authAndLoad(context, page);

    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }

    await expect(page.getByText(ALARM_BANNER)).toBeHidden();
    await expect(page.getByText(READER_NOTICE)).toBeHidden();
    await expect(page.getByRole('button', { name: /retry|reload/i })).toBeHidden();
    await saveEvidence(page, 'criterion-3-failed-reader-still-silent');
  });

  test('criterion 4: pending -> still renders its quiet banner regardless of write-attempt', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'pending');
    await authAndLoad(context, page);

    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }

    await expect(page.getByText(/backup pending/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /retry|reload/i })).toBeHidden();
    await saveEvidence(page, 'criterion-4-pending-unchanged');
  });

  test('criterion 5: the reader\'s Reload reaches the restore path, reloads, and does NOT show the writer-only "replaced" notice', async ({ context, page }) => {
    test.setTimeout(90000);
    // The backend's restore branch reports {success, restored: true} for BOTH
    // a writer and a reader (T6040 does not touch the backend) -- the frontend
    // is what must not show the writer's loss-of-work copy to a reader.
    await installStatusShim(page, 'conflict', true, { success: true, restored: true });
    await authAndLoad(context, page);

    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }
    await expect(page.getByText(READER_NOTICE)).toBeVisible();
    await saveEvidence(page, 'criterion-5-before-reload');

    await page.getByRole('button', { name: /^reload$/i }).click();

    // The reload actually fired (the noReload marker set at load is gone).
    await expect(async () => {
      const stillSet = await page.evaluate(() => window.__t6040_noReload === true).catch(() => false);
      expect(stillSet, 'page must have reloaded').toBe(false);
    }).toPass({ timeout: 15000 });

    // After the reload, re-establish the (still-injecting=false) session and
    // confirm the writer-only "replaced" notice is absent.
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(REPLACED_NOTICE)).toBeHidden();
    await saveEvidence(page, 'criterion-5-after-reload-no-replaced-notice');
  });

  test('responsive: reader notice does not overflow at 375px', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'conflict');
    await authAndLoad(context, page);
    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }
    await expect(page.getByText(READER_NOTICE)).toBeVisible();

    await responsiveSweep(page);
  });
});
