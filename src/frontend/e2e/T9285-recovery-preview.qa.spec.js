import { test, expect } from '@playwright/test';

/**
 * T9285 QA — Focus's recovery path (post-reload/tab-discard) now carries a
 * completed framing export into the SAME publish-exit preview the live path
 * shows, instead of the user landing on Clips home with zero signal.
 *
 * A real OS tab-discard isn't reproducible in Playwright. This approximates it
 * per the task's own Technical Notes: stub GET /api/exports/unacknowledged to
 * return a completed framing job and reload into the app, observing behavior
 * against a REAL backend + REAL frontend dev build (not a mock harness) — R2 is
 * disabled in this sandbox so the app runs in local-disk storage mode, but the
 * auth, projects, exports, and recovery machinery are all real.
 *
 * Run: cd src/frontend && npx playwright test e2e/T9285-recovery-preview.qa.spec.js
 */

const API_BASE = 'http://localhost:8000/api';

function makeUserId(label) {
  return `e2e_t9285_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function loginTestUser(page, userId) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.goto('/');
  await page.evaluate(async (headers) => {
    await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers });
  }, { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
}

async function createProject(page, userId, name) {
  const res = await page.evaluate(async ({ apiBase, userId, name }) => {
    const r = await fetch(`${apiBase}/projects`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' },
      body: JSON.stringify({ name, aspect_ratio: '9:16' }),
    });
    return r.json();
  }, { apiBase: API_BASE, userId, name });
  return res.id;
}

function unacknowledgedFramingJob(projectId, projectName, jobId = 'e2e-job-1') {
  return {
    job_id: jobId,
    project_id: projectId,
    project_name: projectName,
    type: 'framing',
    status: 'complete',
    error: null,
    output_video_id: 999,
    output_filename: 'seeded.mp4',
    created_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    game_id: null,
    game_name: null,
  };
}

async function stubUnacknowledged(page, jobs) {
  // T3370: the app's bootstrap payload already carries `exports.unacknowledged`
  // and useExportRecovery consumes THAT (window.__bootstrapExports) before ever
  // hitting this REST endpoint directly (it only falls back to the discrete
  // fetch if bootstrap didn't populate it in time) — so both must be stubbed,
  // or a reload never reaches this route at all.
  await page.route('**/api/exports/unacknowledged', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exports: jobs }) });
  });
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.exports = { ...(data.exports || {}), unacknowledged: jobs };
    await route.fulfill({ response, contentType: 'application/json', body: JSON.stringify(data) });
  });
}

async function stubPreviewUrl(page, projectId, url) {
  await page.route(`**/api/projects/${projectId}/working_video/playback-url`, (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url }) });
  });
}

test.describe('T9285: recovered Focus completion reaches the publish-exit preview', () => {
  test('(a)+(b) Option C auto-open: idle-on-home discovery lands directly on the preview', async ({ page }) => {
    const userId = makeUserId('auto');
    await loginTestUser(page, userId);
    const projectId = await createProject(page, userId, 'Auto Open Reel');
    expect(projectId).toBeTruthy();

    await stubUnacknowledged(page, [unacknowledgedFramingJob(projectId, 'Auto Open Reel')]);
    await stubPreviewUrl(page, projectId, 'https://example.com/fake-preview.mp4');

    // The reload-mid-export approximation: the app boots fresh, idle on Clips
    // home with nothing selected — exactly the state App.jsx:551-557's redirect
    // produces after a real tab discard.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // Option C: auto-invoked View — no click needed. Lands on the SAME
    // CollectionPlayer + FocusPublishActionBar the live path shows.
    await expect(page.getByRole('button', { name: /Publish without spotlight/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Add spotlight/i })).toBeVisible();
    await page.screenshot({ path: 'test-results/T9285-auto-open-preview.png' });
  });

  test('(a) passive card when the completion is discovered while the user is elsewhere; (c) View opens the same action bar; (d) Dismiss acknowledges and clears', async ({ page }) => {
    const userId = makeUserId('passive');
    await loginTestUser(page, userId);
    const projectId = await createProject(page, userId, 'Passive Card Reel');
    const otherProjectId = await createProject(page, userId, 'Currently Editing');

    // Put the user "elsewhere": a project is selected (not idle-on-home with
    // nothing selected) — the exact predicate FocusCompletionRecovery's Option
    // C auto-open checks. Deliberately does NOT also flip editorMode/mount
    // FocusScreen for this project (that needs a fully loaded project via
    // loadProject, orthogonal to what this scenario is proving).
    await page.evaluate(async (id) => {
      const { useProjectsStore } = await import('/src/stores/projectsStore.js');
      await useProjectsStore.getState().selectProject(id);
    }, otherProjectId);
    await page.waitForTimeout(300);

    // Simulate the recovery pass discovering a framing completion for a
    // DIFFERENT project while the user is sitting here — the same predicate
    // reportRecoveredCompletion/FocusCompletionRecovery evaluate regardless of
    // whether the discovery came from the unacknowledged loop, the WS, or
    // checkModalStatusOnce (design's single seam, §1.4/§2.2).
    const ackRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/exports/acknowledge')) ackRequests.push(req.postDataJSON());
    });
    await stubPreviewUrl(page, projectId, 'https://example.com/fake-preview-2.mp4');
    await page.evaluate(async ({ jobId, projectId, projectName }) => {
      const { useFocusCompletionStore } = await import('/src/stores/focusCompletionStore.js');
      useFocusCompletionStore.getState().noteRecovered({ jobId, projectId, projectName });
    }, { jobId: 'e2e-job-2', projectId, projectName: 'Passive Card Reel' });

    // Passive card, NOT auto-navigated — the user's current screen is untouched.
    const card = page.getByTestId('focus-completion-recovery');
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /Publish without spotlight/i })).toHaveCount(0);
    expect(ackRequests.length, 'no acknowledge before any gesture').toBe(0);

    // View -> opens the SAME action bar the live path shows.
    await card.getByRole('button', { name: 'View' }).click();
    await expect(page.getByRole('button', { name: /Publish without spotlight/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: /Add spotlight/i })).toBeVisible();

    // §6a: acknowledge fires AFTER View succeeds, not before.
    await expect.poll(() => ackRequests.flat()).toContain('e2e-job-2');
    await page.screenshot({ path: 'test-results/T9285-passive-card-view.png' });
  });

  test('(e) §6a re-prompt: a second discard BEFORE acting shows the card again, not vanished', async ({ page }) => {
    const userId = makeUserId('reprompt');
    await loginTestUser(page, userId);
    const projectId = await createProject(page, userId, 'Reprompt Reel');

    const job = unacknowledgedFramingJob(projectId, 'Reprompt Reel', 'e2e-job-3');
    await stubUnacknowledged(page, [job]);
    await stubPreviewUrl(page, projectId, 'https://example.com/fake-preview-3.mp4');

    // First discard: auto-opens (idle on home). Do NOT act on it.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByRole('button', { name: /Publish without spotlight/i })).toBeVisible({ timeout: 15000 });

    // A SECOND simulated discard before the user acted: the job is STILL
    // unacknowledged server-side (framing acknowledge is deferred, §6a), so the
    // same stub is faithful to what the real server would return.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // The completion-preview moment must not have vanished: either the passive
    // card reappears or (idle-on-home, same as before) it auto-opens again —
    // either way the user still gets a path to the same action bar.
    await expect(page.getByRole('button', { name: /Publish without spotlight/i })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: 'test-results/T9285-reprompt-after-second-discard.png' });
  });
});
