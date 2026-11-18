/**
 * T17140 - per-criterion acceptance check (group checks protocol).
 *
 * Opening a finished highlight with "Edit highlight" (Highlights tile menu) and going back
 * Home without changing anything used to take it out of Highlights: the open unpublished it,
 * so it showed on Plays as "In progress, Private". The check opens one highlight that way,
 * leaves by the editor's back arrow, and expects the Highlights and Plays counts and the
 * highlight's finished (published) state to be what they were.
 *
 * C2 (a highlight whose game video expired) is a code check: no check account reliably holds
 * one. See T17140.checks.json.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17140.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/** Call an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: 'include' });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, checkApi(path));
}

async function highlights(page) {
  const res = await pageApi(page, '/downloads');
  expect(res.ok, `GET /downloads -> ${res.status}`).toBe(true);
  return Array.isArray(res.body) ? res.body : res.body.downloads;
}

async function highlightCount(page) {
  const res = await pageApi(page, '/downloads/count');
  expect(res.ok, `GET /downloads/count -> ${res.status}`).toBe(true);
  return res.body.count;
}

/** The number on the Plays tab (no badge once the tab has loaded = 0). */
async function playsCount(page) {
  const badge = page.getByTestId('home-tab-clips').getByTestId('tab-badge');
  await badge.first().waitFor({ timeout: 30000 }).catch(() => {});
  if (!(await badge.count())) return 0;
  return Number((await badge.first().textContent()).trim());
}

/** A single-play highlight whose game video is still there (Frame opens with the video). */
async function editableHighlight(page) {
  for (const d of await highlights(page)) {
    if (!d.project_id || (d.clip_count != null && d.clip_count > 1)) continue;
    const info = await pageApi(page, `/downloads/${d.id}/redo-info`);
    if (info.ok && info.body.game_video_available) return d;
  }
  return null;
}

test('T17140:C1 - at 1440x900, Edit highlight then back Home keeps the counts and the highlight finished', async ({ browser }) => {
  test.setTimeout(300000);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await loginForCheck(context);
    const page = await context.newPage();
    await page.goto('/home');
    await disableGuidanceForCheck(page);
    const reel = await editableHighlight(page);
    expect(reel, 'a finished single-play highlight whose game video is available').toBeTruthy();
    const beforeHighlights = await highlightCount(page);

    await page.getByTestId('home-tab-published').click();
    const panel = page.getByTestId('published-tab-panel');
    const tile = panel.getByTestId('reel-card').filter({ has: page.locator(`img[src*="/downloads/${reel.id}/poster.jpg"]`) }).first();
    const headers = panel.getByTestId('collapsible-group-header');
    await expect(headers.first()).toBeVisible({ timeout: 60000 });
    // A group may start open while its tiles load, so give the tiles time before opening one.
    await tile.waitFor({ timeout: 20000 }).catch(() => {});
    for (let i = 0; i < await headers.count() && !(await tile.isVisible()); i += 1) {
      await headers.nth(i).click();
      await tile.waitFor({ timeout: 20000 }).catch(() => {});
    }
    await expect(tile).toBeVisible({ timeout: 30000 });
    // Home has loaded its plays by the time the Highlights tiles show.
    const beforePlays = await playsCount(page);
    await tile.hover();
    await tile.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('reel-tile-menu').getByRole('button', { name: 'Edit highlight' }).click();

    await page.waitForURL(new RegExp(`/focus/p/${reel.project_id}`), { timeout: 60000 });
    await page.getByTestId('focus-video-stage').waitFor({ timeout: 90000 });
    await page.getByTestId('editor-home').first().click();
    await page.waitForURL(/\/home/, { timeout: 60000 });
    await expect(page.getByTestId('home-tab-clips')).toBeVisible({ timeout: 60000 });

    expect(await highlightCount(page), 'Highlights count').toBe(beforeHighlights);
    expect((await highlights(page)).map((d) => d.id), 'the highlight is still finished and listed').toContain(reel.id);
    await expect.poll(() => playsCount(page), { timeout: 30000, message: 'Plays count' }).toBe(beforePlays);
  } finally {
    await context.close();
  }
});
