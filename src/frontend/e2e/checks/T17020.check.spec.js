/**
 * T17020 - per-criterion acceptance check (group checks protocol).
 *
 * The server finishes a sharpened highlight (T16520), but Home's Highlights tab only learned
 * about it on a reload: the tile was missing and the tab and group counts stayed at the old
 * number. Each test sharpens a draft, goes back to Home with the editor's back arrow (in-app,
 * no page load), opens Highlights and, without reloading, expects the new highlight there.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17020.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { sharpenableDraft } from '../helpers/returnAfterSharpen';

/** Call an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, checkApi(path));
}

async function highlightCount(page) {
  const res = await pageApi(page, '/downloads/count');
  expect(res.ok, `GET /downloads/count -> ${res.status}`).toBe(true);
  return res.body.count;
}

/**
 * Sharpen a draft, then leave the editor by its back arrow while it sharpens.
 * Returns the draft and the Highlights count before the sharpen.
 */
async function sharpenThenGoHome(page, tag) {
  await page.goto('/home');
  await disableGuidanceForCheck(page);
  const draft = await sharpenableDraft(page);
  test.skip(!draft, `[${tag}] no unsharpened single-clip draft on a ready game, and no play on a ready game to make one from`);
  const before = await highlightCount(page);

  await page.goto(`/focus/p/${draft.id}`);
  await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
  const sharpen = page.getByRole('button', { name: 'Sharpen!' }).first();
  await expect(sharpen).toBeEnabled({ timeout: 60000 });
  await sharpen.click();
  const confirm = page.getByTestId('focus-box-confirm');
  if (await confirm.waitFor({ timeout: 5000 }).then(() => true, () => false)) {
    await confirm.getByRole('button', { name: 'Sharpen!' }).click();
  }
  // The back arrow while it sharpens: an in-app route change, the page never reloads.
  await page.getByTestId('editor-home').first().click();
  await page.waitForURL(/\/home/, { timeout: 60000 });
  return { draft, before };
}

async function waitForFinish(page, before) {
  await expect.poll(() => highlightCount(page), { timeout: 600000, intervals: [5000] }).toBe(before + 1);
}

/** The new highlight's tile, by the id in its poster URL (names repeat across highlights). */
async function newTile(page, draft) {
  const res = await pageApi(page, '/downloads');
  expect(res.ok, `GET /downloads -> ${res.status}`).toBe(true);
  const list = Array.isArray(res.body) ? res.body : res.body.downloads;
  const made = list.filter((d) => d.project_id === draft.id).sort((a, b) => b.id - a.id)[0];
  expect(made, `a highlight for draft ${draft.id}`).toBeTruthy();
  return page.getByTestId('published-tab-panel').locator(`img[src*="/downloads/${made.id}/poster.jpg"]`).first();
}

test('T17020:C1 - at 390x844, Go to Highlights shows the new highlight tile without a reload', async ({ browser }) => {
  test.setTimeout(900000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  try {
    await loginForCheck(context);
    const page = await context.newPage();
    const { draft, before } = await sharpenThenGoHome(page, 'T17020');
    await page.evaluate(() => { window.__t17020NoReload = true; });
    // A look at Highlights while it sharpens, then back to Plays to wait. The group list this
    // first look loads is the copy that went stale (on the QA phone the game had no group yet).
    await page.getByTestId('home-tab-published').click();
    const panel = page.getByTestId('published-tab-panel');
    await expect(panel).toBeVisible({ timeout: 60000 });
    if (before > 0) await expect(panel.locator('img[src*="/poster.jpg"]').first()).toBeVisible({ timeout: 60000 });
    await page.getByTestId('home-tab-clips').click();

    await waitForFinish(page, before);
    // "Go to Highlights" shows on the Plays tab when no other draft is left; otherwise the
    // Highlights tab is the same gesture's destination.
    const goTo = page.getByRole('button', { name: 'Go to Highlights' });
    if (await goTo.isVisible()) await goTo.click();
    else await page.getByTestId('home-tab-published').click();

    await expect(await newTile(page, draft), 'new highlight tile').toBeVisible({ timeout: 30000 });
    expect(await page.evaluate(() => window.__t17020NoReload === true), 'the page reloaded').toBe(true);
  } finally {
    await context.close();
  }
});

test('T17020:C2 - at 1440x900 and 768x1024, the Highlights tab and game group counts include the new highlight without a reload', async ({ browser }) => {
  test.setTimeout(1800000);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 1024 }]) {
    const context = await browser.newContext({ viewport });
    try {
      await loginForCheck(context);
      const page = await context.newPage();
      const { draft, before } = await sharpenThenGoHome(page, 'T17020');
      await page.evaluate(() => { window.__t17020NoReload = true; });
      // Wait on the Highlights tab, as the parent did.
      await page.getByTestId('home-tab-published').click();

      await waitForFinish(page, before);
      const label = `${viewport.width}x${viewport.height}`;
      await expect(page.getByTestId('home-tab-published').getByTestId('tab-badge'), `${label} tab counter`)
        .toHaveText(String(before + 1), { timeout: 30000 });

      const clips = await pageApi(page, `/clips/projects/${draft.id}/clips`);
      const gameId = (Array.isArray(clips.body) ? clips.body : clips.body.clips)[0].game_id;
      const summary = await pageApi(page, '/collections/summary');
      const game = summary.body.games.find((g) => g.game_id === gameId);
      expect(game, `${label} game ${gameId} has a Highlights group`).toBeTruthy();
      const header = page.getByTestId('collapsible-group-header').filter({ hasText: game.game_name }).first();
      await expect(header.locator('span').last(), `${label} group count`).toHaveText(String(game.reel_count), { timeout: 30000 });
      const tile = await newTile(page, draft);
      if (!(await tile.isVisible())) await header.click();
      await expect(tile, `${label} new highlight tile`).toBeVisible({ timeout: 30000 });
      expect(await page.evaluate(() => window.__t17020NoReload === true), `${label} the page reloaded`).toBe(true);
    } finally {
      await context.close();
    }
  }
});
