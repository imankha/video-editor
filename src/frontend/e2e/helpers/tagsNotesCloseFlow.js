import { expect } from '@playwright/test';
import { checkApi, disableGuidanceForCheck } from './checkAuth';

/**
 * The T17010:C1/C2 flow, shared by its own check and T17290:C1's (which first signs the same
 * account in a second time, the way concurrent staging checks do).
 *
 * Path: open a game with plays, Show plays, a play's View details (opens the play editor;
 * else Edit play), Details. Guidance is switched on just before Details so the coach shade
 * does not stand in the way of the navigation taps. Then the sheet's close X must be what a
 * tap at its centre reaches, from the first moment the sheet exists, and that tap closes it
 * with Guidance still on. The page must already be signed in.
 */

/** Bring the header back into view: on a short screen the play editor scrolls the page
 *  and takes the header (and the switch pinned to its slot) off screen. */
async function scrollAllToTop(page) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    for (const el of document.querySelectorAll('*')) if (el.scrollTop > 0) el.scrollTop = 0;
  });
}

async function findGameWithPlays(page) {
  const gamesRes = await page.request.get(checkApi('/games'));
  expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
  const body = await gamesRes.json();
  const games = body.games || body;
  for (const g of games.filter((g) => g.clip_count > 0)) {
    const loadRes = await page.request.get(checkApi(`/games/${g.id}/load`));
    if (!loadRes.ok()) continue;
    const loaded = await loadRes.json();
    if ((loaded.game?.annotations || []).length > 0) return g.id;
  }
  return null;
}

/** @param {import('@playwright/test').Page} page */
export async function tagsNotesCloseFlow(page) {
  const gameId = await findGameWithPlays(page);
  expect(gameId, 'a game with at least one play').toBeTruthy();

  await page.goto(`/annotate/g/${gameId}`);
  const showPlays = page.getByTitle('Show plays');
  await showPlays.waitFor({ timeout: 180000 });
  await disableGuidanceForCheck(page);

  await showPlays.click();
  const drawer = page.getByTestId('annotate-plays-drawer');
  await drawer.waitFor({ timeout: 30000 });
  const firstRow = drawer.getByTestId('clip-row').first();
  await firstRow.waitFor({ timeout: 30000 });
  await firstRow.getByTitle('View details').click();
  if (await drawer.isVisible()) await page.getByTestId('annotate-plays-drawer-close').click();
  await expect(drawer).toHaveCount(0, { timeout: 30000 });
  // The selected play offers "Edit play" (unless View details already opened its editor).
  const detailsButton = page.getByTestId('add-details-button').locator('visible=true').first();
  const editPlay = page.getByRole('button', { name: /^Edit play/ }).locator('visible=true').first();
  await expect.poll(async () => (await detailsButton.count()) + (await editPlay.count()), { timeout: 60000 }).toBeGreaterThan(0);
  if (!(await detailsButton.count())) await editPlay.click();
  await detailsButton.waitFor({ timeout: 30000 });

  // Guidance on: the criterion is about the sheet with Guidance on.
  await scrollAllToTop(page);
  const toggle = page.getByTestId('guidance-toggle').first();
  await expect(toggle).toBeVisible({ timeout: 30000 });
  await expect(toggle).toBeEnabled({ timeout: 30000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 10000 });

  // Sample the very first moment the sheet exists (a MutationObserver callback runs before the
  // next frame): a user's tap right as the sheet opens must reach the X too, not only once some
  // later frame has caught up. Fix round 1: the switch used to hide one rAF + one React render late.
  await page.evaluate(() => {
    window.__t17010FirstHit = null;
    const obs = new MutationObserver(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((d) => d.textContent.includes('Tags and Notes'));
      const x = dialog?.querySelector('button[aria-label="Close"]');
      if (!x) return;
      obs.disconnect();
      const r = x.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      window.__t17010FirstHit = !top ? 'nothing' : x.contains(top) ? 'close'
        : top.closest('[data-testid="guidance-toggle"]') ? 'guidance-toggle' : `${top.tagName}.${top.className}`.slice(0, 120);
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
  await detailsButton.click();
  await expect.poll(() => page.evaluate(() => window.__t17010FirstHit), { timeout: 30000 }).not.toBeNull();
  expect(await page.evaluate(() => window.__t17010FirstHit), 'a tap at the close X centre reaches the X the moment the sheet opens').toBe('close');
  const sheet = page.getByRole('dialog', { name: 'Details' }).filter({ hasText: 'Tags and Notes' });
  await expect(sheet).toBeVisible({ timeout: 30000 });
  await scrollAllToTop(page);
  const close = sheet.getByRole('button', { name: 'Close' });
  await expect(close).toBeVisible();

  // What a tap at the X's centre lands on: the X itself, never the Guidance switch.
  const box = await close.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hit = await close.evaluate((el, [x, y]) => {
    const top = document.elementFromPoint(x, y);
    if (!top) return 'nothing';
    if (el.contains(top)) return 'close';
    return top.closest('[data-testid="guidance-toggle"]') ? 'guidance-toggle' : `${top.tagName}.${top.className}`.slice(0, 120);
  }, [cx, cy]);
  expect(hit, 'a tap at the close X centre reaches the X').toBe('close');

  // And that tap closes the sheet (Guidance untouched).
  await page.touchscreen.tap(cx, cy);
  await expect(sheet).toHaveCount(0, { timeout: 15000 });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
}
