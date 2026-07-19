import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';
import { waitForAppReady } from './helpers/appReady.js';

/**
 * T5330b — share recipient STILL saw no new-user flow (frontend `shared_annotation_flow` gate).
 *
 * T5330 fixed the BACKEND quest counts (a share recipient's quest_1 reads incomplete).
 * But the recipient STILL saw no onboarding because of a SEPARATE frontend gate:
 *
 *   - SharedAnnotationView (the /shared/teammate/{token} landing the emailed recipient
 *     opens) sets sessionStorage 'shared_annotation_flow'='true' on mount, to suppress
 *     the onboarding QuestPanel while on the shared view. It is kept in sessionStorage
 *     (not component state) so it survives the share->login page reload.
 *   - NOTHING ever cleared it. After the recipient signs up and enters their OWN app in
 *     the same tab, the flag persisted, and QuestPanel.jsx reads it to `return null`
 *     (isSharedAnnotationFlow) — so the recipient never saw the NUF for the whole session.
 *
 * The fix (App.jsx): once the user is in their OWN authenticated app and no longer on the
 * shared-annotation route (`isAuthenticated && !teammateShareToken`), clear the flag. This
 * keys on "left the shared view", not merely "authenticated", so an existing user actively
 * viewing a shared annotation keeps the intended suppression.
 *
 * This is a REAL-browser proof (chromium via Playwright) — per the T5380 lesson, jsdom is
 * NOT sufficient for a bug whose repro depends on sessionStorage lifecycle + real mount
 * ordering (App effect clear vs QuestPanel render).
 *
 * Uses the new-user / empty-session bypass (test-login, e2e@test.local) — a genuine new
 * user whose quest_1 "Get Started" is active/incomplete, exactly the recipient's state.
 *
 * Run:
 *   cd src/frontend && npx playwright test e2e/T5330b-share-recipient-nuf-frontend-gate.spec.js
 */

const API_PORT = 8000;
const API_BASE = process.env.E2E_API_BASE || `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e5330b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.replace(/[^a-z0-9_]/gi, '');
const FLAG = 'shared_annotation_flow';
// Valid /shared/teammate/{token} shape ([a-f0-9-]+) so App detects the shared route.
const FAKE_TEAMMATE_TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

async function setTestHeaders(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
}

/** Establish an empty-session authenticated user (e2e@test.local), the new-user
 * flow bypass from src/frontend/CLAUDE.md. Leaves the page authenticated. */
async function authenticateNewUser(page) {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
    if (!res.ok) return { error: `test-login failed: ${res.status}` };
    return res.json();
  });
  return result;
}

/** Flip the frontend auth gate on (mirrors CLAUDE.md's documented bypass). */
async function bypassFrontendAuthGate(page) {
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false, isCheckingSession: false });
  });
}

async function cleanup(request) {
  try {
    const res = await request.delete(`${API_BASE}/auth/user`, { headers: { 'X-User-ID': TEST_USER_ID } });
    if (res.ok()) console.log(`[T5330b][Cleanup] deleted ${TEST_USER_ID}`);
  } catch (e) {
    console.log(`[T5330b][Cleanup] warning: ${e.message}`);
  }
}

test.describe('T5330b — share recipient sees the NUF once in their own app', () => {
  // Auth bypass seams (test-login) are dev/staging-only and blocked in prod; this is a
  // frontend-lifecycle proof driven against local dev servers.
  test.beforeEach(() => skipOnDeployedTarget(test, 'uses /api/auth/test-login new-user bypass'));

  test.afterAll(async ({ request }) => {
    await cleanup(request);
  });

  test('a signed-up recipient with the shared_annotation_flow flag still set sees the onboarding QuestPanel, and the flag is cleared', async ({ page }) => {
    test.setTimeout(60_000);
    await setTestHeaders(page);

    const auth = await authenticateNewUser(page);
    if (auth?.error) {
      const reason = `test-login seam unavailable: ${auth.error}`;
      console.log(`[T5330b][SKIP] ${reason}`);
      test.skip(true, reason);
      return;
    }

    // Simulate exactly what SharedAnnotationView left behind: the flag sits in
    // sessionStorage as the recipient transitions from the /shared view into their
    // own app (it survived the share->login reload). We are now on '/', the main app.
    await page.evaluate((flag) => sessionStorage.setItem(flag, 'true'), FLAG);
    await bypassFrontendAuthGate(page);

    // Boot the authenticated main app with the flag present (survives the reload,
    // as sessionStorage does within a tab) — this is the recipient's real state.
    await page.reload();
    await bypassFrontendAuthGate(page);
    await waitForAppReady(page);

    // THE assertion: the onboarding QuestPanel ("Get Started" / quest_1) becomes
    // visible — the recipient is NOT stuck without a new-user flow.
    const questTitle = page.locator('.quest-title', { hasText: 'Get Started' });
    await expect(questTitle, 'Quest 1 "Get Started" panel must be visible for the signed-up recipient')
      .toBeVisible({ timeout: 20000 });

    // And the flag is gone once in the authed app, so it can't suppress the panel
    // for the rest of the session.
    const flagAfter = await page.evaluate((flag) => sessionStorage.getItem(flag), FLAG);
    expect(flagAfter, 'shared_annotation_flow must be cleared once the recipient is in their own app').toBeNull();

    console.log('[T5330b] PASS: recipient sees onboarding + flag cleared in own app.');
  });

  test('the flag is PRESERVED (not cleared) while actually on the /shared/teammate view — suppression intended there', async ({ page }) => {
    test.setTimeout(60_000);
    await setTestHeaders(page);

    const auth = await authenticateNewUser(page);
    if (auth?.error) {
      const reason = `test-login seam unavailable: ${auth.error}`;
      console.log(`[T5330b][SKIP] ${reason}`);
      test.skip(true, reason);
      return;
    }

    await bypassFrontendAuthGate(page);

    // Navigate to the actual shared-annotation route. App renders SharedAnnotationView
    // (teammateShareToken truthy), so the clear guard (isAuthenticated && !teammateShareToken)
    // must NOT fire — the flag must survive so quests stay suppressed across the
    // share->login reload roundtrip.
    await page.goto(`/shared/teammate/${FAKE_TEAMMATE_TOKEN}`);
    await bypassFrontendAuthGate(page);
    await waitForAppReady(page);

    // Give any (incorrect) clear effect a chance to run.
    await expect.poll(
      async () => page.evaluate((flag) => sessionStorage.getItem(flag), FLAG),
      { timeout: 8000, message: 'flag must remain set while on the shared-annotation view' },
    ).toBe('true');

    console.log('[T5330b] PASS: flag preserved on the shared-annotation view.');
  });
});
