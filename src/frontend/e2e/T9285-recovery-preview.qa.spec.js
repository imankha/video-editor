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

async function stubUnacknowledged(page, jobs, { delayMs = 0 } = {}) {
  // T3370: the app's bootstrap payload already carries `exports.unacknowledged`
  // and useExportRecovery consumes THAT (window.__bootstrapExports) before ever
  // hitting this REST endpoint directly (it only falls back to the discrete
  // fetch if bootstrap didn't populate it in time) — so both must be stubbed,
  // or a reload never reaches this route at all.
  //
  // `delayMs` (review fix): recovery discovery resolves fast enough after a
  // reload that a `page.evaluate` call issued right after
  // `waitForLoadState('domcontentloaded')` can lose the race against it —
  // i.e. the app may already have decided idle-on-home (and auto-opened, per
  // Option C) before a test gets to change that state. Delaying the response
  // this route stub controls gives a subsequent evaluate() call a reliable
  // window to win that race deterministically.
  const delay = () => (delayMs > 0 ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  await page.route('**/api/exports/unacknowledged', async (route) => {
    await delay();
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ exports: jobs }) });
  });
  await page.route('**/api/bootstrap', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.exports = { ...(data.exports || {}), unacknowledged: jobs };
    await delay();
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

  test('(a) passive card when the completion is discovered while the user is elsewhere; (c) View opens the same action bar', async ({ page }) => {
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

  test('(d) Dismiss acknowledges the job and clears the card WITHOUT navigating', async ({ page }) => {
    const userId = makeUserId('dismiss');
    await loginTestUser(page, userId);
    const projectId = await createProject(page, userId, 'Dismiss Reel');
    const otherProjectId = await createProject(page, userId, 'Currently Editing');

    // Elsewhere, same as the passive-card scenario, so Dismiss is exercised
    // against the passive card (not the auto-open path).
    await page.evaluate(async (id) => {
      const { useProjectsStore } = await import('/src/stores/projectsStore.js');
      await useProjectsStore.getState().selectProject(id);
    }, otherProjectId);
    await page.waitForTimeout(300);

    const ackRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/exports/acknowledge')) ackRequests.push(req.postDataJSON());
    });
    await page.evaluate(async ({ jobId, projectId, projectName }) => {
      const { useFocusCompletionStore } = await import('/src/stores/focusCompletionStore.js');
      useFocusCompletionStore.getState().noteRecovered({ jobId, projectId, projectName });
    }, { jobId: 'e2e-job-dismiss', projectId, projectName: 'Dismiss Reel' });

    const card = page.getByTestId('focus-completion-recovery');
    await expect(card).toBeVisible({ timeout: 5000 });

    await card.getByRole('button', { name: 'Dismiss' }).click();

    await expect(page.getByTestId('focus-completion-recovery')).toHaveCount(0);
    // No navigation: the action bar for the dismissed reel never appears, and
    // the user's current selection (otherProjectId) is untouched.
    await expect(page.getByRole('button', { name: /Publish without spotlight/i })).toHaveCount(0);
    await expect.poll(() => ackRequests.flat()).toContain('e2e-job-dismiss');
    await page.screenshot({ path: 'test-results/T9285-dismiss.png' });
  });

  test('(e) §6a re-prompt: repeated discovery BEFORE the user acts never silently acknowledges, and the card persists', async ({ page }) => {
    const userId = makeUserId('reprompt');
    await loginTestUser(page, userId);
    const projectId = await createProject(page, userId, 'Reprompt Reel');
    const otherProjectId = await createProject(page, userId, 'Currently Editing');
    const jobId = 'e2e-job-3';

    // T9285 review fix: the earlier version of this test used TWO idle-on-home
    // reloads, so Option C auto-opened on the FIRST one — and Option C's
    // auto-open legitimately DOES acknowledge after opening (that's a real,
    // separate, already-covered behavior — see test (a)/(b)'s "acknowledge
    // fires AFTER View succeeds"). Asserting "never acknowledged" against that
    // scenario was asserting something the app doesn't even claim.
    //
    // §6a's actual claim is narrower: the RECONCILIATION step itself
    // (useExportRecovery's unacknowledged-jobs loop) must never acknowledge a
    // framing completion on its own, no matter how many times it re-discovers
    // the SAME still-unacknowledged job — only a real View/Dismiss gesture
    // (including Option C's auto-invoked View) may. Staying "elsewhere" (a
    // project selected) for the whole test keeps Option C from ever firing,
    // isolating that claim: the card must persist across repeated discovery,
    // and zero acknowledge requests may ever contain this job id.
    const ackRequests = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/exports/acknowledge')) ackRequests.push(req.postDataJSON());
    });

    const selectOtherProject = () => page.evaluate(async (id) => {
      const { useProjectsStore } = await import('/src/stores/projectsStore.js');
      await useProjectsStore.getState().selectProject(id);
    }, otherProjectId);

    await selectOtherProject();
    await page.waitForTimeout(300);

    const job = unacknowledgedFramingJob(projectId, 'Reprompt Reel', jobId);
    // Delayed (see stubUnacknowledged): discovery resolves fast enough after a
    // reload that re-selecting "elsewhere" right after domcontentloaded can
    // otherwise lose the race and land on idle-on-home's auto-open instead.
    await stubUnacknowledged(page, [job], { delayMs: 500 });
    await stubPreviewUrl(page, projectId, 'https://example.com/fake-preview-3.mp4');

    // First discard: a genuine reload drives the REAL recovery path (not a
    // manually-injected store call). Re-select "elsewhere" immediately after
    // the reload — before the app's own (deliberately delayed) recovery
    // discovery resolves — so this lands on the passive-card case, not auto-open.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await selectOtherProject();

    await expect(page.getByTestId('focus-completion-recovery')).toBeVisible({ timeout: 15000 });
    expect(ackRequests.flat(), 'discovery alone must never acknowledge').not.toContain(jobId);

    // A SECOND discard before the user ever tapped View/Dismiss — the job is
    // (correctly) STILL unacknowledged server-side, so the same stub is
    // faithful to what a real reload would find.
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await selectOtherProject();

    // The completion-preview moment did not vanish — the card is back.
    await expect(page.getByTestId('focus-completion-recovery')).toBeVisible({ timeout: 15000 });
    expect(ackRequests.flat(), 'the framing job must never be mount-time-acknowledged').not.toContain(jobId);

    await page.screenshot({ path: 'test-results/T9285-reprompt-after-second-discard.png' });
  });
});
