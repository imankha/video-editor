/**
 * The T16730:C1 flow, shared by the checks that must prove it (T16730:C1, and T16800:C1, whose
 * criterion is that these same steps pass on staging).
 *
 * Sharpen a single-clip draft and wait for the ready panel; return to /home three times on fast
 * loads (the bootstrap path) and once with /api/bootstrap held back 3 s (the unacknowledged
 * fallback path), each time expecting "Your highlight is in Highlights" on the recovery card; View
 * opens the in-Highlights panel; the highlight is listed in Highlights. Makes a draft when the
 * account has no sharpenable one left (see sharpenableDraft). The caller sets the test timeout.
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from './checkAuth';

const IN_HIGHLIGHTS = 'It’s in your Highlights';
const RETURNED = 'Your highlight is in Highlights';

/** Call an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path, method = 'GET', body = undefined) {
  return page.evaluate(async ({ url, method, body }) => {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, { url: checkApi(path), method, body });
}

async function listOf(page, path, key) {
  const res = await pageApi(page, path);
  expect(res.ok, `GET ${path} -> ${res.status}`).toBe(true);
  return Array.isArray(res.body) ? res.body : res.body[key] || [];
}

/**
 * A single-clip draft not sharpened yet whose game video is ready. The staging account's last two
 * such drafts sat on a game stuck uploading (2026-11-17), where Frame shows "Game video still
 * uploading" and no Sharpen button; when none is left, make another highlight from a play on a
 * ready game, the same request Annotate's "Make Another Highlight" sends (T11430).
 */
export async function sharpenableDraft(page) {
  const ready = new Set((await listOf(page, '/games', 'games'))
    .filter((g) => g.status === 'ready' && g.storage_status === 'active').map((g) => g.id));
  const drafts = (await listOf(page, '/projects', 'projects'))
    .filter((p) => (p.clip_count || 0) === 1 && !p.has_working_video && !p.has_final_video);
  for (const draft of drafts) {
    const clips = await listOf(page, `/clips/projects/${draft.id}/clips`, 'clips');
    if (ready.has(clips[0]?.game_id)) return draft;
  }
  for (const gameId of ready) {
    const play = (await listOf(page, `/clips/raw?game_id=${gameId}`, 'clips'))[0];
    if (!play) continue;
    const made = await pageApi(page, `/clips/raw/${play.id}`, 'PUT', { create_project: true, force_new: true });
    expect(made.ok, `PUT /clips/raw/${play.id} (make another highlight) -> ${made.status}`).toBe(true);
    const before = new Set(drafts.map((d) => d.id));
    return (await listOf(page, '/projects', 'projects')).find(
      (p) => !before.has(p.id) && (p.clip_count || 0) === 1 && !p.has_working_video && !p.has_final_video,
    );
  }
  return undefined;
}

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {string} tag - task id for the skip message, e.g. 'T16730'
 */
export async function returnAfterSharpenFindsHighlight(browser, tag) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await loginForCheck(context);
    const page = await context.newPage();

    // Sharpen a draft the way a parent does, and wait for the ready panel.
    await page.goto('/home');
    await disableGuidanceForCheck(page);
    const draft = await sharpenableDraft(page);
    test.skip(!draft, `[${tag}] no unsharpened single-clip draft on a ready game, and no play on a ready game to make one from`);
    await page.goto(`/focus/p/${draft.id}`);
    await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
    const sharpen = page.getByRole('button', { name: 'Sharpen!' }).first();
    await expect(sharpen).toBeEnabled({ timeout: 60000 });
    await sharpen.click();
    const confirm = page.getByTestId('focus-box-confirm');
    if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await confirm.getByRole('button', { name: 'Sharpen!' }).click();
    }
    await page.getByTestId('focus-publish-action-bar').waitFor({ timeout: 480000 });

    // Leave without tapping anything and come back on fresh page loads: bootstrap path, three times.
    const card = page.getByTestId('focus-completion-recovery');
    for (let i = 1; i <= 3; i++) {
      await page.goto('/home');
      await expect(card, `return ${i} (bootstrap path)`).toContainText(RETURNED, { timeout: 60000 });
    }
    // Once more with bootstrap held back past the card's 2 s wait: the fallback path.
    await page.route('**/api/bootstrap**', async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });
    await page.goto('/home');
    await expect(card, 'return 4 (unacknowledged fallback path)').toContainText(RETURNED, { timeout: 60000 });
    // Let the held request finish before moving on: a handler still sleeping when the page
    // navigates would find its route already settled and throw.
    await page.unroute('**/api/bootstrap**', { behavior: 'wait' });

    await card.getByRole('button', { name: 'View' }).click();
    const bar = page.getByTestId('focus-publish-action-bar');
    await expect(bar.getByRole('heading', { name: IN_HIGHLIGHTS })).toBeVisible({ timeout: 60000 });
    await expect(page.getByTestId('focus-choice-publish')).toHaveCount(0);
    await bar.getByRole('button', { name: 'Done' }).click();

    await page.goto('/home');
    await page.getByTestId('home-tab-published').click();
    await expect(page.getByText(draft.name, { exact: false }).first()).toBeVisible({ timeout: 60000 });
  } finally {
    await context.close();
  }
}
