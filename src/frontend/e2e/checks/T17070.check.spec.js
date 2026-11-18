/**
 * T17070 - per-criterion acceptance checks (group checks protocol).
 *
 * A marked play outlives its game: once the game's storage ends, "Edit highlight" on the
 * play's highlight still opens Frame with the play's own video, and nothing on the screen
 * says "expired". Each run takes a finished single-play highlight from a game the account
 * holds, ends that game's storage through the dev-only POST /api/test/expire-game-storage
 * seam (the game then lists as expired, as it does once its storage runs out), opens the
 * highlight from its Highlights tile menu and waits for the video to play.
 *
 * The seam does not exist on staging (test seams are dev-only), so these skip there.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T17070.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { skipOnDeployedTarget } from '../helpers/targetEnv';

/** Call an API path from inside the page (staging 401s page.request after the app's own session, T16100). */
async function pageApi(page, path, init = {}) {
  return page.evaluate(async ({ url, init }) => {
    const res = await fetch(url, { credentials: 'include', ...init });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, { url: checkApi(path), init });
}

/** A finished single-play highlight whose play comes from a game with a stored video. */
async function gameHighlight(page) {
  const res = await pageApi(page, '/downloads');
  expect(res.ok, `GET /downloads -> ${res.status}`).toBe(true);
  const games = await pageApi(page, '/games');
  expect(games.ok, `GET /games -> ${games.status}`).toBe(true);
  const stored = new Set((games.body.games ?? games.body)
    .filter((g) => g.storage_status === 'active').map((g) => g.id));
  for (const d of res.body.downloads ?? res.body) {
    if (!d.project_id || (d.clip_count != null && d.clip_count > 1)) continue;
    const clips = await pageApi(page, `/clips/projects/${d.project_id}/clips`);
    const clip = clips.ok && clips.body.length === 1 ? clips.body[0] : null;
    if (clip && stored.has(clip.game_id)) return { reel: d, clip };
  }
  return null;
}

async function expiredGameOpensInFrame(browser, viewport) {
  const context = await browser.newContext({ viewport });
  try {
    await loginForCheck(context);
    const page = await context.newPage();
    await page.goto('/home');
    await disableGuidanceForCheck(page);
    const found = await gameHighlight(page);
    expect(found, 'a finished single-play highlight from a game with stored video').toBeTruthy();
    const { reel, clip } = found;

    const expire = await pageApi(page, '/test/expire-game-storage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ game_id: clip.game_id }),
    });
    expect(expire.ok, `POST /test/expire-game-storage -> ${expire.status}`).toBe(true);
    const games = await pageApi(page, '/games');
    const game = (games.body.games ?? games.body).find((g) => g.id === clip.game_id);
    expect(game?.storage_status, `game ${clip.game_id} storage after the seam`).toBe('expired');

    // Reload so Home shows the game as it now is (expired).
    await page.goto('/home');
    const playback = [];
    page.on('response', (r) => {
      if (r.url().includes(`/clips/projects/${reel.project_id}/clips/`) && r.url().includes('/playback-url')) {
        playback.push(r.status());
      }
    });

    await page.getByTestId('home-tab-published').click();
    const panel = page.getByTestId('published-tab-panel');
    const tile = panel.getByTestId('reel-card').filter({ has: page.locator(`img[src*="/downloads/${reel.id}/poster.jpg"]`) }).first();
    const headers = panel.getByTestId('collapsible-group-header');
    await expect(headers.first()).toBeVisible({ timeout: 60000 });
    await tile.waitFor({ timeout: 20000 }).catch(() => {});
    for (let i = 0; i < await headers.count() && !(await tile.isVisible()); i += 1) {
      await headers.nth(i).click();
      await tile.waitFor({ timeout: 20000 }).catch(() => {});
    }
    await expect(tile).toBeVisible({ timeout: 30000 });
    await tile.hover();
    await tile.getByRole('button', { name: 'More actions' }).click();
    await page.getByTestId('reel-tile-menu').getByRole('button', { name: 'Edit highlight' }).click();

    await page.waitForURL(new RegExp(`/focus/p/${reel.project_id}`), { timeout: 60000 });
    const stage = page.getByTestId('focus-video-stage');
    await stage.waitFor({ timeout: 90000 });
    // The play's video loads and plays: it has frames, a duration, and its clock moves.
    const video = stage.locator('video').first();
    await expect.poll(() => video.evaluate((v) => v.readyState), { timeout: 60000, message: 'video has frames' })
      .toBeGreaterThanOrEqual(2);
    await video.evaluate((v) => { v.muted = true; return v.play(); });
    const t0 = await video.evaluate((v) => v.currentTime);
    await expect.poll(() => video.evaluate((v) => v.currentTime), { timeout: 15000, message: 'video plays' })
      .toBeGreaterThan(t0);

    expect(playback.length, 'Frame asked for the play\'s video').toBeGreaterThan(0);
    expect(playback, 'playback-url never answers 410 for the marked play').not.toContain(410);
    await expect(page.getByText('Game video expired')).toHaveCount(0);
    await expect(page.getByText(/expired/i)).toHaveCount(0);
    await expect(page.getByText('This highlight has nothing to show')).toHaveCount(0);
  } finally {
    await context.close();
  }
}

test('T17070:C1 - at 1440x900, Edit highlight on an expired game\'s play opens Frame with its video and no expiry message', async ({ browser }) => {
  skipOnDeployedTarget(test, 'ends a game\'s storage through /api/test/expire-game-storage (dev-only seam)');
  test.setTimeout(300000);
  await expiredGameOpensInFrame(browser, { width: 1440, height: 900 });
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  test(`T17070:C2 - at ${viewport.width}x${viewport.height}, the same, and playback-url does not answer 410`, async ({ browser }) => {
    skipOnDeployedTarget(test, 'ends a game\'s storage through /api/test/expire-game-storage (dev-only seam)');
    test.setTimeout(300000);
    await expiredGameOpensInFrame(browser, viewport);
  });
}
