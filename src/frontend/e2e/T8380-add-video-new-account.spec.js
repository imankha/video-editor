// T8380 new-account E2E — the "Add Video" entry point makes the In Progress
// Clips tab a valid clip-creation surface, so a brand-new user (zero games, zero
// clips) must be able to REACH it and see the Add Video CTA, while Games stays
// the default landing tab. This is the highest-risk part of T8380 (it removes the
// old dead-end guard that used to bounce a zero-content account off /home/reels).
//
// Scope: the deterministic UI contract (reachability, two-path empty state, the
// consequence-notice gate). The upload plumbing itself (hash -> R2 -> POST
// /api/clips/upload) is T8370's and is covered by useClipUpload unit tests + the
// backend endpoint's own tests, so this spec does NOT perform a real R2 upload
// (which would need a configured R2 in the headless env).
//
// Uses the empty new-user bypass (X-User-ID + test-login), so it targets Vite dev.
import { test, expect } from '@playwright/test';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const TEST_USER_ID = `e2e_t8380_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';

const gamesTab = (p) => p.getByRole('button', { name: /^Games/i });
const clipsTab = (p) => p.getByRole('button', { name: /^In Progress Clips/i });

async function authFreshUser(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'e2e@test.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

test.describe('T8380 Add Video — brand-new account', () => {
  skipOnDeployedTarget(test, 'empty new-user flow imports /src/stores/*.js (Vite-dev paths 404 on a deployed build)');
  test.setTimeout(120000);

  test.afterAll(async ({ request }) => {
    await request.delete(`${API_BASE}/auth/user`, { headers: { 'X-User-ID': TEST_USER_ID } }).catch(() => {});
  });

  test('zero-content account: Games is the default tab, Clips is reachable with Add Video', async ({ page }) => {
    await authFreshUser(page);
    await page.goto('/home');
    await page.waitForLoadState('domcontentloaded');

    // Games is the default LANDING tab for a zero-content account.
    await expect(gamesTab(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Game' })).toBeVisible();

    // The In Progress Clips tab is NOT disabled (the T6830 dead-end guard is gone),
    // and the old "Extract clips from a game first..." caption is not shown.
    const tab = clipsTab(page);
    await expect(tab).toBeVisible();
    await expect(tab).toBeEnabled();
    await expect(page.getByText(/Extract clips from a game first using Annotate mode to unlock/i)).toHaveCount(0);

    // Clicking in reveals the two-path empty state with the Add Video CTA.
    await tab.click();
    const addVideo = page.getByRole('button', { name: 'Add Video' });
    await expect(addVideo).toBeVisible();
    await expect(addVideo).toHaveAttribute('data-tutorial-target', 'clips-add-video');
    // Path B guidance (extract in Annotate) is present alongside.
    await expect(page.getByText(/Clip Out Play/i)).toBeVisible();
    // No dead-end redirect: we stay on /home/reels.
    expect(await page.evaluate(() => window.location.pathname)).toBe('/home/reels');
  });

  test('Add Video shows the consequence notice before opening the file picker', async ({ page }) => {
    await authFreshUser(page);
    await page.goto('/home/reels');
    await page.waitForLoadState('domcontentloaded');

    await page.getByRole('button', { name: 'Add Video' }).click();

    // The one-time consequence notice appears (never a hard gate): Cancel + Continue.
    const notice = page.getByRole('alertdialog');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(/won.t be linked to a game/i);
    await expect(notice.getByRole('button', { name: 'Cancel' })).toBeVisible();
    const continueBtn = notice.getByRole('button', { name: 'Continue' });
    await expect(continueBtn).toBeVisible();

    // Continue closes the notice and opens the (hidden) multi-file picker. We can't
    // observe the OS dialog, but the input is wired and multi-file capable.
    const input = page.getByTestId('clip-upload-input');
    await expect(input).toHaveAttribute('multiple', '');
    await continueBtn.click();
    await expect(notice).toBeHidden();

    // Cancel path also works without side effects.
    await page.getByRole('button', { name: 'Add Video' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toBeHidden();
  });
});
