import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T17790: in phone landscape (844x390, real touch) Mark Plays' four action tiles were
 * 126.5x38 and the "All" play filter was 33.56x44 -- below the 44x44 touch target.
 *
 * C1 - every listed control is at least 44x44 at the stated real-touch size.
 * C2 - the enlarged controls overlap no other control and keep their labels visible.
 */
test.setTimeout(240000);
test.use({ hasTouch: true, isMobile: true, viewport: { width: 844, height: 390 } });

const TILE_IDS = [
  'annotate-mark-play-button',
  'annotate-review-plays',
  'annotate-share-plays-action',
  'add-footage-button',
];

async function openClippedGame(context, page) {
  await loginForCheck(context);
  const res = await page.request.get(checkApi('/games'));
  expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
  const games = (await res.json()).games || [];
  const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
  if (!target) return null;
  await openGameInAnnotate(page, target.id);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });
  // Playhead 0:00 sits inside the first play, which swaps Mark play for Edit play and hides
  // the whole-game tiles. Step into open video (same move as T15460's check).
  const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
  for (let i = 0; i < 30; i++) await forward.click({ timeout: 5000 });
  return target;
}

function filterAll(page) {
  return page.locator('button[aria-pressed]', { hasText: /^All$/ }).first();
}

// The control's own box plus every other visible interactive element whose box it intersects
// (ancestors/descendants excluded) and whether its label text is clipped.
async function inspect(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const sel = 'button, a[href], input, select, textarea, [role="button"], [role="slider"]';
    const overlaps = [];
    for (const other of document.querySelectorAll(sel)) {
      if (other === el || other.contains(el) || el.contains(other)) continue;
      const o = other.getBoundingClientRect();
      if (o.width === 0 || o.height === 0) continue;
      const cs = getComputedStyle(other);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const w = Math.min(r.right, o.right) - Math.max(r.left, o.left);
      const h = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
      if (w > 0.5 && h > 0.5) overlaps.push(`${other.tagName} "${(other.textContent || other.getAttribute('aria-label') || '').trim().slice(0, 30)}" ${w.toFixed(1)}x${h.toFixed(1)}`);
    }
    // Label = the visible title text (ActionCard's bold span, or the chip's own text).
    const label = el.querySelector('span.font-bold') || el;
    const lr = label.getBoundingClientRect();
    const labelVisible = lr.width > 0 && lr.height > 0
      && label.scrollWidth <= label.clientWidth + 1
      && lr.left >= r.left - 0.5 && lr.right <= r.right + 0.5
      && lr.top >= r.top - 0.5 && lr.bottom <= r.bottom + 0.5;
    return { w: r.width, h: r.height, overlaps, label: label.textContent.trim(), labelVisible };
  });
}

async function controls(page) {
  const out = {};
  for (const id of TILE_IDS) {
    const loc = page.getByTestId(id);
    await expect(loc, `${id} rendered`).toBeVisible({ timeout: 60000 });
    out[id] = loc;
  }
  const all = filterAll(page);
  await expect(all, 'All filter rendered').toBeAttached({ timeout: 60000 });
  out['filter-All'] = all;
  return out;
}

test('T17790:C1 Mark Plays landscape controls are at least 44x44 on touch', async ({ context, page }) => {
  const target = await openClippedGame(context, page);
  test.skip(!target, '[T17790] no active game with clips');
  const failures = [];
  for (const [name, loc] of Object.entries(await controls(page))) {
    const m = await inspect(loc);
    if (m.w < 44 || m.h < 44) failures.push(`${name} ${m.w.toFixed(2)}x${m.h.toFixed(2)}`);
  }
  expect(failures, 'controls below 44x44').toEqual([]);
});

test('T17790:C2 enlarged controls overlap no other control and keep labels visible', async ({ context, page }) => {
  const target = await openClippedGame(context, page);
  test.skip(!target, '[T17790] no active game with clips');
  const failures = [];
  for (const [name, loc] of Object.entries(await controls(page))) {
    const m = await inspect(loc);
    if (m.w < 44 || m.h < 44) failures.push(`${name} not enlarged: ${m.w.toFixed(2)}x${m.h.toFixed(2)}`);
    if (m.overlaps.length) failures.push(`${name} overlaps ${m.overlaps.join('; ')}`);
    if (!m.labelVisible) failures.push(`${name} label "${m.label}" clipped or hidden`);
  }
  expect(failures, 'overlap / label problems').toEqual([]);
});
