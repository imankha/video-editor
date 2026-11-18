/**
 * T17010 -- with Guidance on, the phone "Tags and Notes" sheet's close X (top right)
 * sat under the fixed Guidance switch: a tap on the X flipped Guidance and the sheet
 * stayed open. C1 at 390x844, C2 at 360x640 and iPad 768x1024 (all touch: a touch
 * iPad gets the same full-screen sheet, useIsMobile's coarse-pointer branch).
 *
 * Path: open a game with plays, Show plays, a play's View details (opens the play
 * editor; else Edit play), Details. Guidance is switched on just before Details so the coach shade
 * does not stand in the way of the navigation taps.
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

test.setTimeout(480000);

const CASES = [
  { id: 'T17010:C1', name: 'phone 390x844', width: 390, height: 844 },
  { id: 'T17010:C2', name: 'phone 360x640', width: 360, height: 640 },
  { id: 'T17010:C2', name: 'iPad 768x1024', width: 768, height: 1024 },
];

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

for (const vp of CASES) {
  test.describe(vp.name, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test(`${vp.id} - Tags and Notes close X is not under the Guidance switch and closes the sheet (${vp.name})`, async ({ context, page }) => {
      await loginForCheck(context);
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

      await detailsButton.click();
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
    });
  });
}
