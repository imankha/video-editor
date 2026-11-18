import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T17210: after a 5-star play, "Make this a highlight now?" offers "Make
 * highlight" / "Keep marking plays". "Keep marking plays" used to create an
 * in-progress highlight nobody asked for, and its sub-line read "Saves this
 * play as a highlight in Plays".
 *
 * C1 - after "Keep marking plays", no new in-progress highlight exists for
 *      that play and the Plays tab count is unchanged.
 * C2 - the sub-line reads "This play is saved. You can make its highlight any time."
 */
test.setTimeout(240000);

const SUB_LINE = 'This play is saved. You can make its highlight any time.';

// T16100: page.request after the app started its own session got 401 on
// staging, so every API call after the first navigation runs inside the page.
async function pageApi(page, apiPath, init = {}) {
  return page.evaluate(async ({ url, init: i }) => {
    const res = await fetch(url, { credentials: 'include', ...i });
    let body = null;
    try { body = await res.json(); } catch { /* empty body */ }
    return { status: res.status, body };
  }, { url: checkApi(apiPath), init });
}

// The Plays tab lists projects that are auto-created for one play and not
// yet published (utils/draftStage.js isPlayInProgress).
async function playsInProgress(page) {
  const r = await pageApi(page, '/projects');
  expect(r.status, 'GET /projects').toBe(200);
  return r.body.filter((p) => p.is_auto_created && !p.is_published).map((p) => p.id);
}

async function readClips(page, gameId) {
  const r = await pageApi(page, `/games/${gameId}`);
  expect(r.status, `GET /games/${gameId}`).toBe(200);
  return {
    duration: r.body.videos?.[0]?.duration ?? r.body.video_duration ?? 0,
    clips: (r.body.annotations || [])
      .filter((a) => (a.video_sequence ?? 1) === 1)
      .map((a) => ({ id: a.id, start: a.start_time, end: a.end_time })),
  };
}

async function pickGame(page) {
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  return games.find((g) => g.storage_status === 'active');
}

/**
 * Mark a new play in the largest free stretch of the game's first video,
 * rate it 5 stars and tap Done, so the choice card shows. Returns the new
 * play's id (pushed into `made` for cleanup).
 */
async function markFiveStarPlay(page, gameId, made) {
  await openGameInAnnotate(page, gameId);
  await expect(async () => {
    const readyState = await page.evaluate(() => document.querySelector('video')?.readyState ?? 0);
    expect(readyState).toBeGreaterThanOrEqual(1);
  }).toPass({ timeout: 90000 });
  await disableGuidanceForCheck(page);

  const { duration, clips } = await readClips(page, gameId);
  const initialIds = new Set(clips.map((c) => c.id));
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start > cursor) gaps.push([cursor, c.start]);
    cursor = Math.max(cursor, c.end);
  }
  if (duration > cursor) gaps.push([cursor, duration]);
  gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  const gap = gaps[0];
  // A play spans mark-6..mark+2 and 5 s skips aim within 5 s.
  test.skip(!gap || gap[1] - gap[0] < 14, `[T17210] no 14 s free window left in this video`);

  const current = await page.evaluate(() => {
    const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    return [...document.querySelectorAll('video')].sort((a, b) => area(b) - area(a))[0]?.currentTime ?? 0;
  });
  const steps = Math.ceil((gap[0] + 6 - current) / 5);
  const skip = steps >= 0
    ? page.getByTitle('Forward 5 seconds (Right arrow)')
    : page.getByTitle('Back 5 seconds (Left arrow)');
  for (let i = 0; i < Math.abs(steps); i++) {
    await skip.click({ timeout: 5000 });
  }
  const markBtn = page.getByTestId('annotate-mark-play-button');
  await expect(markBtn).toBeVisible({ timeout: 60000 });
  await markBtn.click();

  const fiveStars = page.getByRole('radio', { name: /5 stars/ });
  await expect(fiveStars).toBeVisible({ timeout: 30000 });
  await fiveStars.click();
  await page.getByTestId('play-editor-done').click();
  await expect(page.getByTestId('highlight-choice-card')).toBeVisible({ timeout: 30000 });

  let playId;
  await expect.poll(async () => {
    playId = (await readClips(page, gameId)).clips.find((c) => !initialIds.has(c.id))?.id;
    return Boolean(playId);
  }, { timeout: 60000, message: 'new play saved' }).toBe(true);
  made.push(playId);
  return playId;
}

async function deletePlays(page, ids) {
  for (const id of ids) {
    const del = await pageApi(page, `/clips/raw/${id}`, { method: 'DELETE' });
    expect([200, 404], `DELETE /clips/raw/${id}`).toContain(del.status);
  }
}

test.describe('T17210 Keep marking plays creates nothing', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('T17210:C1 after "Keep marking plays", no new in-progress highlight and the Plays tab count is unchanged', async ({ context, page }) => {
    await loginForCheck(context);
    const target = await pickGame(page);
    test.skip(!target, '[T17210] no active game to mark a play on');

    // The Plays tab count before, as the parent sees it on Home.
    await page.goto('/home');
    const playsBadge = page.getByTestId('home-tab-clips').getByTestId('tab-badge');
    const before = await playsInProgress(page);
    await expect(playsBadge, 'Plays tab count before').toHaveText(String(before.length), { timeout: 60000 });

    const highlightWrites = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && /\/clips\/raw\//.test(req.url()) && (req.postData() || '').includes('create_project')) {
        highlightWrites.push(req.url());
      }
    });

    const made = [];
    try {
      await markFiveStarPlay(page, target.id, made);
      await page.getByTestId('highlight-choice-later').click();
      await expect(page.getByTestId('annotate-mark-play-button')).toBeVisible({ timeout: 30000 });

      // A highlight create, if one were made, goes out at once; give it time.
      await page.waitForTimeout(8000);
      expect(highlightWrites, 'highlight create requests after "Keep marking plays"').toEqual([]);
      const after = await playsInProgress(page);
      expect(after.filter((id) => !before.includes(id)), 'new in-progress highlights').toEqual([]);

      // Back on Home (in-app), the Plays tab shows the same number.
      await page.getByTestId('editor-home').first().click();
      await expect(page.getByTestId('home-tab-clips')).toBeVisible({ timeout: 60000 });
      await page.waitForTimeout(3000);
      await expect(playsBadge, 'Plays tab count after').toHaveText(String(before.length), { timeout: 30000 });
    } finally {
      await deletePlays(page, made);
    }
  });

  test('T17210:C2 the "Keep marking plays" sub-line reads as written', async ({ context, page }) => {
    await loginForCheck(context);
    const target = await pickGame(page);
    test.skip(!target, '[T17210] no active game to mark a play on');

    const made = [];
    try {
      await markFiveStarPlay(page, target.id, made);
      await expect(page.getByTestId('highlight-choice-later')).toContainText(SUB_LINE);
      // Leave without choosing (Escape's touch twin): nothing is written.
      await page.getByTestId('highlight-choice-close').click();
    } finally {
      await deletePlays(page, made);
    }
  });
});
