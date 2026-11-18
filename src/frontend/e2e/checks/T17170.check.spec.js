import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T17170: Mark plays flow and markers, at 390x844.
 *
 * C1 - after Done on a just-marked play, playing on past it brings "Mark play"
 *      back within a second, with no timeline tap.
 * C3 - tapping a plays-list row (its name, not a button) selects that play and
 *      jumps to it; every rating badge shows a star count in its palette color,
 *      never a chess glyph.
 */
test.setTimeout(300000);
test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

// RATING_BADGE_COLORS (clipConstants.js), as the browser reports them.
const BADGE_RGB = {
  1: 'rgb(213, 94, 0)',
  2: 'rgb(173, 20, 87)',
  3: 'rgb(21, 101, 192)',
  4: 'rgb(0, 158, 115)',
  5: 'rgb(245, 183, 0)',
};

async function activeGames(page) {
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  return ((await res.json()).games || []).filter((g) => g.storage_status === 'active');
}

async function annotationsOf(page, gameId) {
  const res = await page.request.get(checkApi(`/games/${gameId}`));
  expect(res.ok(), `GET /games/${gameId} -> ${res.status()}`).toBeTruthy();
  return (await res.json()).annotations || [];
}

// The main tile is Mark play (annotate-mark-play-button) with no play selected,
// Edit play (annotate-primary-cta) with one selected.
const markPlayVisible = (page) => page.evaluate(() => {
  return [...document.querySelectorAll('[data-testid="annotate-mark-play-button"]')]
    .some((b) => b.offsetParent !== null);
});

test('T17170:C1 playing past a just-marked play brings Mark play back within a second', async ({ context, page }) => {
  await loginForCheck(context);
  const games = await activeGames(page);
  test.skip(!games.length, '[T17170] no active game to mark a play on');
  const target = games[0];
  const existing = await annotationsOf(page, target.id);

  await openGameInAnnotate(page, target.id);
  await disableGuidanceForCheck(page);
  const markBtn = page.getByTestId('annotate-mark-play-button').locator('visible=true').first();
  await expect(page.getByTitle('Forward 5 seconds (Right arrow)').locator('visible=true').first()).toBeVisible({ timeout: 90000 });

  // Step forward (real transport taps) to a spot clear of every existing play.
  const maxEnd = existing.reduce((m, a) => Math.max(m, a.end_time), 0);
  const steps = Math.ceil((maxEnd + 15) / 5);
  const forward = page.getByTitle('Forward 5 seconds (Right arrow)').locator('visible=true').first();
  for (let i = 0; i < steps; i++) await forward.click({ timeout: 15000 });
  await expect.poll(() => markPlayVisible(page), { timeout: 30000 }).toBe(true);

  await markBtn.click();
  await expect.poll(async () => (await annotationsOf(page, target.id)).length, { timeout: 60000, intervals: [1000] })
    .toBe(existing.length + 1);
  const created = (await annotationsOf(page, target.id)).find((a) => !existing.some((e) => e.id === a.id));

  try {
    const done = page.getByTestId('play-editor-done').locator('visible=true').first();
    await expect(done).toBeVisible({ timeout: 30000 });
    await done.click();
    // The play stays selected (Edit play), so Mark play is gone for now.
    await expect.poll(() => markPlayVisible(page), { timeout: 15000 }).toBe(false);

    await page.getByTitle('Play', { exact: true }).locator('visible=true').first().click();

    // Measure, in the page, the gap between the playhead leaving the play and
    // Mark play coming back. No timeline tap anywhere.
    const end = created.end_time;
    const gapMs = await page.evaluate(async (playEnd) => {
      const visible = () => [...document.querySelectorAll('[data-testid="annotate-mark-play-button"]')]
        .some((b) => b.offsetParent !== null);
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline && !((document.querySelector('video')?.currentTime ?? 0) > playEnd + 0.1)) await sleep(25);
      const leftAt = Date.now();
      while (Date.now() < leftAt + 5000 && !visible()) await sleep(25);
      return visible() ? Date.now() - leftAt : null;
    }, end);
    expect(gapMs, 'Mark play came back after the playhead left the play').not.toBeNull();
    expect(gapMs, `Mark play took ${gapMs}ms to come back`).toBeLessThanOrEqual(1000);
  } finally {
    if (created) await page.request.delete(checkApi(`/clips/raw/${created.id}`));
  }
});

test('T17170:C3 a row tap selects its play; badges show stars in their colors, no chess glyphs', async ({ context, page }) => {
  await loginForCheck(context);
  const games = (await activeGames(page)).filter((g) => (g.clip_count || 0) > 1);
  test.skip(!games.length, '[T17170] no active game with 2+ plays');
  const target = games[0];
  const sorted = [...(await annotationsOf(page, target.id))].sort((a, b) =>
    ((a.video_sequence ?? 1) - (b.video_sequence ?? 1)) || (a.start_time - b.start_time));
  // A later play (not the one auto-selected at load), with a start clear of 0.
  const rowIndex = sorted.findIndex((a, i) => i > 0 && a.start_time >= 2);
  test.skip(rowIndex === -1, '[T17170] no later play to tap');
  const play = sorted[rowIndex];

  await openGameInAnnotate(page, target.id);
  await disableGuidanceForCheck(page);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

  // Timeline markers: digit (or N★ when selected) on the palette color.
  const badgeFacts = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="rating-icon"]')]
    .filter((i) => i.offsetParent !== null)
    .map((i) => ({ rating: i.dataset.rating, text: i.textContent, bg: getComputedStyle(i).backgroundColor })));
  const checkBadges = (facts) => {
    expect(facts.length, 'rating badges on screen').toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.text, 'no chess glyph on a badge').not.toMatch(/[!?]/);
      expect(f.text).toMatch(new RegExp(`^${f.rating}★?$`));
      expect(f.bg, `rating ${f.rating} badge keeps its color`).toBe(BADGE_RGB[f.rating]);
    }
  };
  checkBadges(await badgeFacts());

  await page.getByTitle('Show plays').click();
  const drawer = page.getByTestId('annotate-plays-drawer');
  await expect(drawer).toBeVisible();
  const rowBadges = await drawer.getByTestId('rating-icon').evaluateAll((els) => els.map((i) => i.textContent));
  for (const t of rowBadges) expect(t, 'list badge reads "N★"').toMatch(/^[1-5]★$/);
  checkBadges(await badgeFacts());

  const row = drawer.getByTestId('clip-row').nth(rowIndex);
  await expect(row.getByTitle('Jump to play')).toHaveCount(0);
  // Tap the row's name text, not a button.
  await row.locator('span.truncate').first().click();

  await expect.poll(() => page.evaluate(() => document.querySelector('video')?.currentTime ?? -1), { timeout: 15000 })
    .toBeGreaterThanOrEqual(Math.max(0, play.start_time - 1.5));
  const landedAt = await page.evaluate(() => document.querySelector('video')?.currentTime);
  expect(landedAt).toBeLessThan(play.start_time + 1.5);
  // Selected: the main tile offers Edit play, not Mark play.
  await expect.poll(() => markPlayVisible(page), { timeout: 15000 }).toBe(false);
  await expect(page.getByTestId('annotate-primary-cta').locator('visible=true').first()).toContainText('Edit play');
});
