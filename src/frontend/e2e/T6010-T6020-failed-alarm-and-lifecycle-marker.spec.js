import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T6010 — the `failed` alarm had T5960's staleness bug too: gate it on
 * write-attempt, symmetric with the shipped `conflict` behaviour.
 *
 * T6020 — the write-attempt gate's classification moved from a URL denylist to
 * an explicit per-call-site `rbLifecycleWrite` marker. The one case a URL-only
 * matcher structurally could not express is `PATCH /api/projects/{id}/state`,
 * hit both by project-OPEN bookkeeping (marked lifecycle, must NOT arm) and a
 * real mode-switch GESTURE (unmarked, must arm) at the IDENTICAL pathname.
 *
 * Same simulation technique as e2e/T5960-conflict-alarm-gated-on-write.spec.js
 * (report this): a REAL cross-machine CAS conflict / backend failure needs two
 * boxes and cannot be manufactured on a single-box /dotask container, so this
 * spec injects `X-Sync-Status` via Playwright `page.route`. The project-open vs
 * mode-switch pair is driven the same way T5960 drives "a write": a real
 * `fetch()` call issued FROM the page with the exact request shape
 * (`useProjectLoader.js`'s marked load-time PATCH vs `App.jsx`'s unmarked
 * mode-switch PATCH) to the SAME pathname -- this exercises the real
 * `window.fetch` interceptor and `isMutatingApiRequest` in a real browser,
 * without requiring a seeded project fixture to drive full UI navigation.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T6010-T6020-failed-alarm-and-lifecycle-marker.spec.js
 */

const H = { 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' };
const BANNER = /could not save to the cloud/i;
const FAILED_SUB = /didn't reach the cloud/i;

async function installStatusShim(page, status, injecting = true) {
  const state = { injecting, status };
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/retry-sync')) {
      state.injecting = false;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
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
  });
}

async function pagePing(page) {
  await page.evaluate(async () => {
    try { await fetch('/api/status', { credentials: 'include' }); } catch { /* ignore */ }
  });
}

async function pageWrite(page) {
  await page.evaluate(async () => {
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framing: { t6010probe: 'x' } }),
      });
    } catch { /* ignore */ }
  });
}

test.describe('T6010 — failed alarm gated on write-attempt', () => {
  test.beforeEach(() => {
    skipOnDeployedTarget(test, 'injects X-Sync-Status via page.route + PUT /api/settings write');
  });

  test('passive load with a failed marker -> NO alarm banner', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'failed');
    await authAndLoad(context, page);

    for (let i = 0; i < 4; i++) { await pagePing(page); await page.waitForTimeout(1000); }

    await expect(page.getByText(BANNER)).toBeHidden();
    await expect(page.getByRole('button', { name: /retry/i })).toBeHidden();
    await saveEvidence(page, 't6010-criterion-1-failed-passive-load-silent');
  });

  test('with the failed marker present, ONE edit -> alarm + Retry appear', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'failed');
    await authAndLoad(context, page);

    await pagePing(page);
    await page.waitForTimeout(3500);
    await expect(page.getByText(BANNER)).toBeHidden();

    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await expect(page.getByText(FAILED_SUB)).toBeVisible();
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();
    await saveEvidence(page, 't6010-criterion-2-failed-edit-then-alarm');

    await responsiveSweep(page);
  });

  test('Retry clears the failed banner WITHOUT a page refresh', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'failed');
    await authAndLoad(context, page);
    await page.evaluate(() => { window.__t6010_noReload = true; });

    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });

    await page.getByRole('button', { name: /^retry$/i }).click();
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeHidden({ timeout: 4000 });
    }).toPass({ timeout: 30000 });

    const noReload = await page.evaluate(() => window.__t6010_noReload === true);
    expect(noReload, 'banner cleared WITHOUT a page reload').toBe(true);
    await saveEvidence(page, 't6010-criterion-retry-clears-no-refresh');
  });

  test('conflict gating still behaves exactly as T5960 shipped it (regression pin)', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'conflict');
    await authAndLoad(context, page);

    for (let i = 0; i < 3; i++) { await pagePing(page); await page.waitForTimeout(1000); }
    await expect(page.getByText(BANNER)).toBeHidden();

    await pageWrite(page);
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(/newer version of your work/i)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await saveEvidence(page, 't6010-conflict-regression-pin');
  });
});

test.describe('T6020 — lifecycle writes marked at the call site', () => {
  test.beforeEach(() => {
    skipOnDeployedTarget(test, 'injects X-Sync-Status via page.route + direct fetch() write shapes');
  });

  test('project-open PATCH shape does NOT arm; mode-switch PATCH shape to the SAME pathname DOES', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'conflict');
    await authAndLoad(context, page);

    // Simulate useProjectLoader.js's marked load-time PATCH -- must NOT arm.
    await page.evaluate(async () => {
      try {
        await fetch('/api/projects/1/state?update_last_opened=true&current_mode=framing', {
          method: 'PATCH',
          credentials: 'include',
          rbLifecycleWrite: true,
        });
      } catch { /* ignore -- project 1 need not exist, only the request shape matters */ }
    });
    await pagePing(page);
    await page.waitForTimeout(3500);
    await expect(page.getByText(BANNER)).toBeHidden();
    await expect(page.getByText(/newer version of your work/i)).toBeHidden();
    await saveEvidence(page, 't6020-project-open-does-not-arm');

    // Simulate App.jsx's unmarked mode-switch PATCH to the IDENTICAL pathname -- must arm.
    await page.evaluate(async () => {
      try {
        await fetch('/api/projects/1/state?current_mode=overlay', {
          method: 'PATCH',
          credentials: 'include',
        });
      } catch { /* ignore */ }
    });
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await saveEvidence(page, 't6020-mode-switch-arms');
  });

  test('a genuine export START still arms the gate', async ({ context, page }) => {
    test.setTimeout(90000);
    await installStatusShim(page, 'conflict');
    await authAndLoad(context, page);

    await pagePing(page);
    await page.waitForTimeout(1000);
    await expect(page.getByText(BANNER)).toBeHidden();

    // POST /api/exports/framing is a real gesture -- unmarked, must arm.
    await page.evaluate(async () => {
      try {
        await fetch('/api/exports/framing', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
      } catch { /* ignore -- shape of the request is what's under test */ }
    });
    await expect(async () => {
      await pagePing(page);
      await expect(page.getByText(BANNER)).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 30000 });
    await saveEvidence(page, 't6020-export-start-arms');
  });
});
