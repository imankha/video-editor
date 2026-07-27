import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T5960 — the `.sync_conflict` marker is sticky on the backend: it outlives the
 * session whose write was refused and attaches to whatever session loads next,
 * including a READ-ONLY one. The bug was that the frontend painted the alarm
 * "Could not save to the cloud" on any `X-Sync-Status: conflict` header, so a
 * passive reader who never edited anything was told their work couldn't save.
 *
 * The fix gates the conflict ALARM on write-attempt: the state is still held,
 * but the banner stays silent until THIS session issues a mutating request.
 *
 * How the marker is simulated (report this): a REAL cross-machine CAS conflict
 * needs two boxes and cannot be manufactured on a single-box /dotask container
 * (see commit 9468a960 "cross-machine CAS verification blocked: single box").
 * So this spec INTERCEPTS the response header in Playwright (`page.route`) and
 * stamps `X-Sync-Status: conflict` onto our own API responses — deterministically
 * reproducing exactly the passive-reader scenario the bug is about. Assertions
 * are on what the USER SEES (the rendered banner / its absence), never on the API
 * response — the whole bug is that the API was right and the UI lied.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T5960-conflict-alarm-gated-on-write.spec.js
 */

const H = { 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' };
const BANNER = /could not save to the cloud/i;
// T6040 note: narrowed to "...exists" (the ALARM's own sub-line) so this no
// longer collides with the legitimate quiet reader notice T6040 introduces for
// a no-write conflict ("A newer version of your work is available" + Reload) --
// that notice is a deliberate, non-alarm addition, not a regression.
const CONFLICT_SUB = /newer version of your work exists/i;

/**
 * Install a network shim that (a) stamps `X-Sync-Status: conflict` onto our own
 * API responses while `state.injectConflict` is true, and (b) answers
 * `/api/retry-sync` with a plain success and disarms the injection — modelling a
 * conflict that the honest-Retry path resolves. Returns the mutable `state`.
 */
async function installConflictShim(page, injectConflict = true) {
  const state = { injectConflict };
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    // The Retry gesture hits /api/retry-sync; model a successful resolution.
    if (url.includes('/api/retry-sync')) {
      state.injectConflict = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    const resp = await route.fetch();
    const headers = { ...resp.headers() };
    if (state.injectConflict) headers['x-sync-status'] = 'conflict';
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
    window.__t5960_noReload = true; // cleared by any full page reload
  });
}

// Drive a GET from the page so the real window.fetch interceptor
// (syncStore.checkSyncStatus) re-evaluates the injected header.
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
        body: JSON.stringify({ framing: { t5960probe: 'x' } }),
      });
    } catch { /* ignore */ }
  });
}

test.describe('T5960 — conflict alarm gated on write-attempt', () => {
  test.beforeEach(() => {
    skipOnDeployedTarget(test, 'injects X-Sync-Status via page.route + PUT /api/settings write');
  });

  test('criterion 1: passive load with a conflict marker -> NO alarm banner', async ({ context, page }) => {
    test.setTimeout(90000);
    await installConflictShim(page);
    await authAndLoad(context, page);

    // Read-only: only nudge with GETs. The header says conflict, but no write.
    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }

    await expect(page.getByText(BANNER)).toBeHidden();
    await expect(page.getByText(CONFLICT_SUB)).toBeHidden();
    await expect(page.getByRole('button', { name: /retry/i })).toBeHidden();
    await saveEvidence(page, 'criterion-1-passive-load-silent');
  });

  test('criterion 2: with the marker present, ONE edit -> alarm + Retry appear', async ({ context, page }) => {
    test.setTimeout(90000);
    await installConflictShim(page);
    await authAndLoad(context, page);

    // confirm silent first (no writes yet)
    await pagePing(page);
    await page.waitForTimeout(3500);
    await expect(page.getByText(BANNER)).toBeHidden();

    // the session's first write arms the gate; the conflict header now surfaces
    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await expect(page.getByText(CONFLICT_SUB)).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await saveEvidence(page, 'criterion-2-edit-then-alarm');

    // Responsive check: the banner is fixed bottom-right — must not overflow at 375px.
    await responsiveSweep(page);
  });

  test('criterion 4: a genuine conflict raised DURING an editing session alarms immediately', async ({ context, page }) => {
    test.setTimeout(90000);
    const state = await installConflictShim(page, false); // start clean, no conflict
    await authAndLoad(context, page);

    // The user edits first (no conflict yet) — arms the gate.
    await pageWrite(page);
    await pagePing(page);
    await page.waitForTimeout(1000);
    await expect(page.getByText(BANNER)).toBeHidden();

    // Now a conflict is raised mid-session. It must alarm (gate already armed).
    state.injectConflict = true;
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await saveEvidence(page, 'criterion-4-conflict-during-edit');
  });

  test('criterion 3: Retry clears the banner WITHOUT a page refresh', async ({ context, page }) => {
    test.setTimeout(90000);
    await installConflictShim(page);
    await authAndLoad(context, page);

    // get to the alarm state (write arms the gate)
    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });

    // Retry -> shim resolves it + disarms injection -> banner clears in-place
    await page.getByRole('button', { name: /^retry$/i }).click();
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeHidden({ timeout: 4000 });
    }).toPass({ timeout: 30000 });

    const noReload = await page.evaluate(() => window.__t5960_noReload === true);
    expect(noReload, 'banner cleared WITHOUT a page reload').toBe(true);
    await saveEvidence(page, 'criterion-3-retry-clears-no-refresh');
  });

  test('criterion 5: reload keeps it silent, but a NEW edit re-surfaces the unresolved conflict', async ({ context, page }) => {
    test.setTimeout(90000);
    await installConflictShim(page);
    await authAndLoad(context, page);

    // reload -> a fresh (read-only) session; the sticky marker is still present
    await page.reload();
    await page.evaluate(async () => {
      const { useAuthStore } = await import('/src/stores/authStore.js');
      useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
    });
    await pagePing(page);
    await page.waitForTimeout(3500);
    await expect(page.getByText(BANNER)).toBeHidden(); // silent again on the reloaded read-only session

    // edit again -> the still-unresolved conflict alarms
    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await saveEvidence(page, 'criterion-5-reload-then-edit');
  });
});
