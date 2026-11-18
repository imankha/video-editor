import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

/**
 * T17240: tell same-named highlights apart. The check account may not have enough
 * published highlights in BOTH shapes for "My highlights" to unlock twice, so the test
 * serves the account's own /api/collections/summary with My highlights eligible in
 * portrait AND landscape (the case the QA pass found), then reads the card names the
 * Published tab shows.
 */
test.setTimeout(300000);
test.afterEach(async ({ page }) => { await page.unrouteAll({ behavior: 'ignoreErrors' }); });

const DEFAULT_NAME = /^Play \d+$/;
const singleGame = (row) => (row.game_ids || []).length === 1 && row.clip_game_start_time != null;

const BOTH_SHAPES = {
  reel_count: 6,
  unwatched_count: 0,
  ratio_counts: { '9:16': 3, '16:9': 3 },
  ratio_durations: { '9:16': 40, '16:9': 45 },
  ratio_eligible: { '9:16': true, '16:9': true },
  total_duration: 85,
  has_null_durations: false,
  leading_reel_id: null,
  latest_published_at: null,
};

test('T17240:C1 the portrait and landscape "My highlights" cards have different names', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginForCheck(page.context());
  let served = false;
  await page.route(/\/api\/collections\/summary(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    const others = (data.smart_collections || []).filter((sc) => sc.key !== 'top_plays');
    const topPlays = (data.smart_collections || []).find((sc) => sc.key === 'top_plays');
    data.smart_collections = [
      { ...BOTH_SHAPES, key: 'top_plays', name: topPlays?.name ?? 'My highlights', tags: null, nudge_when_locked: true },
      ...others,
    ];
    served = true;
    await route.fulfill({ response, json: data });
  });
  await page.goto('/home/published');
  await expect.poll(() => served, { timeout: 90000, message: 'the Published tab loaded its summary' }).toBe(true);
  const titles = page.locator('h3', { hasText: /^My highlights/ });
  await expect(titles).toHaveCount(2, { timeout: 60000 });
  const names = await titles.allTextContents();
  expect(names.map((n) => n.trim())).toEqual(['My highlights (portrait)', 'My highlights (landscape)']);

  // Unnamed plays from different moments never share a label. Scope (owner ruling on
  // T17360): repeated reels of the SAME play (same game, same start) are out of scope.
  // They legitimately read alike, and the staging check account holds a dozen of them
  // ("Play 4" at 0:08, left over from repeated e2e publishes), so a "no two cards anywhere"
  // count failed whenever a game group had opened before it read the names.
  const dl = await page.request.get(checkApi('/downloads'));
  expect(dl.ok(), 'GET /downloads').toBe(true);
  const unnamed = (await dl.json()).downloads.filter((r) => singleGame(r) && DEFAULT_NAME.test((r.project_name || '').trim()));
  const playKey = (r) => `${r.game_ids[0]}:${Math.floor(r.clip_game_start_time)}`;
  const byPlay = new Map();
  for (const r of unnamed) (byPlay.get(playKey(r)) || byPlay.set(playKey(r), []).get(playKey(r))).push(r);
  expect(byPlay.size, 'the account has unnamed plays from at least two moments').toBeGreaterThanOrEqual(2);
  const cards = page.getByTestId('reel-card').locator('h3');
  for (const [key, reels] of byPlay) {
    const label = reels[0].display_name;
    await showReelLabel(page, reels[0].group_key, label);
    const showing = (await cards.allTextContents()).filter((t) => t.trim() === label).length;
    expect(showing, `label "${label}" (play ${key}) is on its ${reels.length} reel(s) of that play and no other`).toBe(reels.length);
  }
});

/** Open the reel's game group (collapsed by default; members load on open) until its label shows. */
async function showReelLabel(page, groupName, label) {
  const tile = page.getByTestId('reel-card').locator('h3', { hasText: label }).first();
  const header = page.getByTestId('collapsible-group-header').filter({ hasText: groupName }).first();
  for (let i = 0; i < 2; i++) {
    if (await tile.isVisible().catch(() => false)) return;
    await header.click({ timeout: 60000 });
    if (await tile.waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) return;
  }
  await expect(tile, `a reel card reads "${label}"`).toBeVisible({ timeout: 30000 });
}

/*
 * T17240:C2 -- an unnamed play ("Play N", the one-tap default name) shows as its game
 * plus in-match time on the reel tiles, the draft tiles and in the ranking game, and
 * renaming still replaces what the tile shows.
 *
 * Setup (input data, before the first navigation): two reels of one shape from a
 * single game are both given the stored name "Play 1" (the QA pass's case), and one
 * single-game draft "Play 2". The ranking game only opens once a shape has enough
 * highlights, so /api/rank/confidence is served as eligible for that shape; the
 * matchup itself (/api/rank/next) and every name come from the real backend.
 * The original names are put back at the end.
 */

/** 14.2 -> "0:14", 3725 -> "1:02:05" (the in-match clock the label ends with). */
function clock(sec) {
  const t = Math.floor(sec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}


/** In-page API call: page.request after the app's own session can 401 on staging (T16100). */
async function pageApi(page, path, init) {
  return page.evaluate(async ([url, opts]) => {
    const res = await fetch(url, { credentials: 'include', ...opts });
    return { ok: res.ok, status: res.status };
  }, [checkApi(path), init]);
}

/** Open the game group a reel lives in (groups collapse by default; members load on open). */
async function openGameGroup(page, groupName) {
  const header = page.getByTestId('collapsible-group-header').filter({ hasText: groupName }).first();
  await header.waitFor({ state: 'visible', timeout: 60000 });
  const tiles = page.getByTestId('reel-card');
  for (let i = 0; i < 2; i++) {
    if (await tiles.first().isVisible().catch(() => false)) return;
    await header.click();
    if (await tiles.first().waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false)) return;
  }
}

test('T17240:C2 an unnamed play shows its game plus time on tiles and in the ranking game; rename still works', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginForCheck(page.context());

  // ---- setup: two same-shape single-game reels named "Play 1", one draft "Play 2" ----
  const dl = await page.request.get(checkApi('/downloads'));
  expect(dl.ok(), 'GET /downloads').toBe(true);
  const reels = (await dl.json()).downloads.filter(singleGame);
  const byRatio = {};
  for (const r of reels) (byRatio[r.aspect_ratio] ||= []).push(r);
  const pool = Object.values(byRatio).find((rs) => rs.length >= 2);
  expect(pool, 'the account has two single-game reels of one shape').toBeTruthy();
  const [reelA, reelB] = pool;
  const ratio = reelA.aspect_ratio;

  const pj = await page.request.get(checkApi('/projects'));
  expect(pj.ok(), 'GET /projects').toBe(true);
  const draft = (await pj.json()).find((p) => singleGame(p) && !p.final_video_id);
  expect(draft, 'the account has a single-game draft').toBeTruthy();

  const restore = [
    ['reel', reelA.id, reelA.project_name],
    ['reel', reelB.id, reelB.project_name],
    ['draft', draft.id, draft.name],
  ];
  for (const r of [reelA, reelB]) {
    const res = await page.request.patch(checkApi(`/downloads/${r.id}/name`), { data: { name: 'Play 1' } });
    expect(res.ok(), `name reel ${r.id} "Play 1"`).toBe(true);
  }
  const pr = await page.request.put(checkApi(`/projects/${draft.id}`), { data: { name: 'Play 2' } });
  expect(pr.ok(), `name draft ${draft.id} "Play 2"`).toBe(true);

  try {
    // ---- reel tiles (the Published list) ----
    await page.route(/\/api\/rank\/confidence(\?.*)?$/, async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const asked = new URL(route.request().url()).searchParams.get('aspect_ratio');
      if (asked === ratio) data.eligible = true;
      await route.fulfill({ response, json: data });
    });
    await page.goto('/home/published');
    const reelTitles = page.getByTestId('reel-card').locator('h3');
    await openGameGroup(page, reelA.group_key);
    const tileNameOf = {};
    for (const r of [reelA, reelB]) {
      const tile = page.getByTestId('reel-card').filter({
        has: page.locator('h3', { hasText: new RegExp(`${clock(r.clip_game_start_time)}$`) }),
      });
      await expect(tile.first(), `reel ${r.id} tile ends with its game time`).toBeVisible({ timeout: 60000 });
      tileNameOf[r.id] = (await tile.first().locator('h3').textContent()).trim();
    }
    const shown = (await reelTitles.allTextContents()).map((t) => t.trim());
    expect(shown, 'no reel tile reads "Play 1"').not.toContain('Play 1');
    for (const r of [reelA, reelB]) {
      const name = tileNameOf[r.id];
      expect(name).not.toMatch(DEFAULT_NAME);
      // "<game> <time>": the game part is the opponent ("Vs X"/"at X") or the game's own name.
      const game = name.slice(0, -clock(r.clip_game_start_time).length).trim();
      expect(game.length, `reel ${r.id} label "${name}" names its game`).toBeGreaterThan(0);
      expect(
        /^(Vs|at) /.test(game) || (r.game_names || []).some((g) => g.startsWith(game) || game.startsWith(g)),
        `reel ${r.id} label "${name}" names its game (${(r.game_names || []).join(', ')})`,
      ).toBe(true);
    }

    // ---- ranking game ----
    const pairPromise = page.waitForResponse((res) => /\/api\/rank\/next/.test(res.url()) && res.status() === 200);
    await page.getByRole('button', { name: /Rank highlights/i }).first().click();
    const pair = await (await pairPromise).json();
    const sides = [pair.a, pair.b];
    for (const side of sides) {
      await expect(page.getByRole('button', { name: `Pick ${side.name}` }).first(),
        `the ranking game shows side ${side.id} as "${side.name}"`).toBeVisible({ timeout: 60000 });
      if (side.id === reelA.id || side.id === reelB.id) {
        expect(side.name, `ranking name of reel ${side.id}`).toBe(tileNameOf[side.id]);
      }
    }
    expect(sides.some((s) => s.id === reelA.id || s.id === reelB.id),
      'the matchup includes one of the two "Play 1" reels').toBe(true);
    await page.goto('/home/published');
    await openGameGroup(page, reelA.group_key);

    // ---- rename a reel from its tile: the new name replaces the label ----
    const reelTile = page.getByTestId('reel-card').filter({
      has: page.locator('h3', { hasText: tileNameOf[reelA.id] }),
    }).first();
    await reelTile.getByRole('button', { name: 'Rename highlight' }).click();
    const reelInput = page.getByTestId('reel-card').locator('input');
    await expect(reelInput, 'rename starts from the stored name').toHaveValue('Play 1');
    await reelInput.fill('T17240 reel renamed');
    await reelInput.press('Enter');
    await expect(page.getByTestId('reel-card').locator('h3', { hasText: /^T17240 reel renamed$/ })).toBeVisible({ timeout: 30000 });

    // ---- draft tile (the Clips list) ----
    await page.goto('/home/reels');
    const draftH3 = page.locator('h3', { hasText: new RegExp(`${clock(draft.clip_game_start_time)}$`) });
    const draftName = page.getByTestId('project-card').locator(draftH3);
    await expect(draftName.first(), 'the "Play 2" draft tile ends with its game time').toBeVisible({ timeout: 60000 });
    const draftTitles = (await page.getByTestId('project-card').locator('h3').allTextContents()).map((t) => t.trim());
    expect(draftTitles, 'no draft tile reads "Play 2"').not.toContain('Play 2');
    const draftTile = page.getByTestId('project-card').filter({ has: draftH3 }).first();
    await draftTile.getByRole('button', { name: 'Rename highlight' }).click();
    const draftInput = page.getByTestId('project-card').locator('input');
    await expect(draftInput, 'rename starts from the stored name').toHaveValue('Play 2');
    await draftInput.fill('T17240 draft renamed');
    await draftInput.press('Enter');
    await expect(page.getByTestId('project-card').locator('h3', { hasText: /^T17240 draft renamed$/ }),
      'the renamed draft tile shows its new name').toBeVisible({ timeout: 30000 });

    // ---- both renames survive a reload ----
    await page.reload();
    await expect(page.getByTestId('project-card').locator('h3', { hasText: /^T17240 draft renamed$/ })).toBeVisible({ timeout: 60000 });
  } finally {
    for (const [kind, id, name] of restore) {
      if (kind === 'reel') await pageApi(page, `/downloads/${id}/name`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {});
      else await pageApi(page, `/projects/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }).catch(() => {});
    }
  }
});
