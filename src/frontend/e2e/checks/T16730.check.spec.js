/**
 * T16730 - per-criterion acceptance check (group checks protocol).
 *
 * C1 re-runs T16525:C2, which failed intermittently: a parent who returns after a sharpen must
 * see "Your highlight is in Highlights" on the recovery card, View must open the in-Highlights
 * panel, and the highlight must be listed in Highlights.
 *
 * The recovery card reads the export list from /api/bootstrap when it lands within 2 s and from
 * GET /api/exports/unacknowledged otherwise; the bug was bootstrap's list missing `finished`, so
 * the outcome depended on which one won. This check returns several times on fast loads (the
 * bootstrap path) and once with /api/bootstrap held back 3 s (the fallback path), and every
 * return must show the in-Highlights message. The framing card stays until View is tapped
 * (T9285), so every reload sees it.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16730.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

const IN_HIGHLIGHTS = 'It’s in your Highlights';
const RETURNED = 'Your highlight is in Highlights';

/** GET an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, checkApi(path));
}

test('T16730:C1 - a parent who returns later sees the same message and finds the highlight in Highlights', async ({ browser }) => {
  test.setTimeout(900000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await loginForCheck(context);
    const page = await context.newPage();

    // Sharpen a draft the way a parent does, and wait for the ready panel.
    await page.goto('/home');
    await disableGuidanceForCheck(page);
    const projects = await pageApi(page, '/projects');
    expect(projects.ok, `GET /projects -> ${projects.status}`).toBe(true);
    const list = Array.isArray(projects.body) ? projects.body : projects.body.projects || [];
    const draft = list.find((p) => (p.clip_count || 0) === 1 && !p.has_working_video && !p.has_final_video);
    test.skip(!draft, '[T16730] no single-clip draft that has not been sharpened yet in this account');
    await page.goto(`/focus/p/${draft.id}`);
    await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
    const sharpen = page.getByRole('button', { name: 'Sharpen my highlight' }).first();
    await expect(sharpen).toBeEnabled({ timeout: 60000 });
    await sharpen.click();
    const confirm = page.getByTestId('focus-box-confirm');
    if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
      await confirm.getByRole('button', { name: 'Sharpen my highlight' }).click();
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
});
