import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';
import { openGameInAnnotate } from '../helpers/realAuth';

/**
 * T15550: "Keep marking plays" (the Highlight choice card's secondary button,
 * BACK_TO_EDITING) must return to Annotate ready to mark the next play, not
 * leave the just-marked play open in the editor ("Edit play" / "Highlights
 * from this play").
 *
 * C1 - Mark a play, rate it Highlight (5 stars), tap Done (opens the choice
 *      card), tap "Keep marking plays" -> the main screen shows the Mark Play
 *      CTA again (not Edit play).
 */
test.setTimeout(240000);

test.describe('T15550:C1 Keep marking plays returns to marking', () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test('T15550:C1 "Keep marking plays" returns to the Mark Play screen', async ({ context, page }) => {
    page.on('console', (msg) => console.log('[browser]', msg.text()));
    await loginForCheck(context);
    const res = await page.request.get(checkApi('/games'));
    expect(res.ok(), `GET /games -> ${res.status()}`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T15550] no active game to mark a play on');

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 90000 });

    // The auto-select-at-playhead effect selects whichever clip covers 0:00,
    // swapping Mark play for Edit play. Jump into open video past every
    // existing clip (30 x 5s = 150s) so nothing is selected and Mark play
    // (what the bug report actually taps) renders.
    const forward = page.getByTitle('Forward 5 seconds (Right arrow)');
    for (let i = 0; i < 30; i++) {
      await forward.click({ timeout: 5000 });
    }

    const markBtn = page.getByTestId('annotate-mark-play-button');
    await expect(markBtn).toBeVisible({ timeout: 90000 });
    await markBtn.click();

    // The editor opens on the new play. Rate it Highlight (5) then Done.
    const fiveStars = page.getByRole('radio', { name: /5 stars/ });
    await expect(fiveStars).toBeVisible({ timeout: 30000 });
    await fiveStars.click();
    await page.getByTestId('play-editor-done').click();

    // Done on a Highlight-rated, not-yet-highlight play opens the choice card.
    const later = page.getByTestId('highlight-choice-later');
    await expect(later).toBeVisible({ timeout: 30000 });
    await later.click();

    // Back on the main screen: Mark Play CTA visible, no "Edit play" panel.
    // Generous timeout: the choice card stays disabled until its save round-trip
    // (raw clip save + highlight PUT) resolves, which can be slow on a dev stack.
    await expect(markBtn).toBeVisible({ timeout: 90000 });
    await expect(page.getByTestId('annotate-primary-cta')).toHaveCount(0);
  });
});
