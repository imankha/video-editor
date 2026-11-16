import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

/**
 * T16590:C3 - with Guidance on, a freshly loaded Annotate page, then disableGuidanceForCheck:
 * the "Make highlight" click lands (opens the new highlight in Frame) instead of being
 * swallowed by the guide's shade until the timeout. Same flow as the T16090:C3 check up to
 * that click, so the run is minutes, not the whole publish.
 */
test.setTimeout(600000);

function projectIdFromUrl(page) {
  const m = new URL(page.url()).pathname.match(/^\/(?:focus|overlay)\/p\/(\d+)/);
  return m ? Number(m[1]) : null;
}

test('T16590:C3 after the helper on a fresh page, the Make highlight click opens Frame', async ({ context, page }) => {
  await loginForCheck(context);

  const gamesRes = await page.request.get(checkApi('/games'));
  expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
  const games = await gamesRes.json();
  let gameId = null;
  for (const g of (games.games || games).filter((g) => g.clip_count > 0)) {
    const loadRes = await page.request.get(checkApi(`/games/${g.id}/load`));
    if (!loadRes.ok()) continue;
    const loaded = await loadRes.json();
    if ((loaded.game?.annotations || []).length > 0) { gameId = g.id; break; }
  }
  expect(gameId, 'an existing game with at least one play').toBeTruthy();

  // Guidance on, the way a user turns it on (the staging check account already has it on).
  await page.goto(`/annotate/g/${gameId}`);
  const toggle = page.getByTestId('guidance-toggle').first();
  await expect(toggle).toBeEnabled({ timeout: 120000 });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') {
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30000 });
  }

  // Fresh page load: the switch is not drawn yet when the helper is called.
  await page.reload();
  await disableGuidanceForCheck(page);
  await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 1000 });

  const clipRows = page.getByTestId('clip-row');
  await expect.poll(() => clipRows.count(), { timeout: 180000 }).toBeGreaterThan(0);
  await clipRows.first().click({ timeout: 30000 });
  const makeButton = page.getByTestId('annotate-make-highlight');
  await makeButton.waitFor({ state: 'visible', timeout: 120000 });
  await makeButton.click({ timeout: 30000 });
  await expect.poll(() => projectIdFromUrl(page), { timeout: 180000 }).not.toBeNull();
});
