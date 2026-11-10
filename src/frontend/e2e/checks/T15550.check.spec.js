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

    // T15930: the e2e-gate account has Guidance on, and a focusable coach step
    // shades everything outside its named targets (data-testid="guide-shade",
    // pointer-events captured by design -- see .claude/knowledge/guidance.md
    // "modal shade is a GUARANTEE"). The Forward 5s button below isn't one of
    // those targets, so its clicks were silently retried into this test's own
    // 5s timeout. Turn Guidance off once via its header toggle (same pattern
    // as e2e/guide-no-overlap.spec.js's setGuidance) so every control stays
    // reachable for the rest of this check.
    const guidanceToggle = page.getByTestId('guidance-toggle').first();
    if (await guidanceToggle.count().catch(() => 0)) {
      if ((await guidanceToggle.getAttribute('aria-checked')) !== 'false') {
        await guidanceToggle.click();
        await expect(guidanceToggle).toHaveAttribute('aria-checked', 'false', { timeout: 10000 });
      }
    }

    // The auto-select-at-playhead effect selects whichever clip covers the
    // playhead, swapping Mark play for Edit play. A fixed "jump past every
    // clip" guess (this check used to do 30 x 5s = 150s) breaks once repeat
    // runs on the shared e2e-gate account have covered most of a short video
    // (observed live: an 89.3s video with clips at 0-32 and 83.3-89.3 leaves
    // no room 150s in). Read the game's real clips/duration and land in the
    // middle of the largest untaken gap instead, so this keeps working no
    // matter how many clips already exist.
    const gameRes = await page.request.get(checkApi(`/games/${target.id}`));
    expect(gameRes.ok(), `GET /games/${target.id} -> ${gameRes.status()}`).toBeTruthy();
    const gameDetail = await gameRes.json();
    const duration = gameDetail.video_duration || 0;
    const clips = (gameDetail.annotations || [])
      .map((a) => ({ start: a.start_time, end: a.end_time }))
      .sort((a, b) => a.start - b.start);

    // Margin well above FRAME_TOLERANCE (0.15s, see regionAtTime.js) so the
    // new play's start/end can't land inside an existing clip's boundary match.
    const GAP_MARGIN = 1;
    const gaps = [];
    let cursor = 0;
    for (const c of clips) {
      if (c.start - cursor > GAP_MARGIN * 2) gaps.push([cursor, c.start]);
      cursor = Math.max(cursor, c.end);
    }
    if (duration - cursor > GAP_MARGIN * 2) gaps.push([cursor, duration]);
    gaps.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const biggestGap = gaps[0];
    test.skip(!biggestGap, '[T15930] no free window left in this video to mark a new play');
    const seekTarget = (biggestGap[0] + biggestGap[1]) / 2;

    // Don't assume the playhead starts at 0: openGameInAnnotate resumes
    // last_playhead_position, which earlier runs against this same shared
    // account can leave anywhere (observed live: resumed at 84s on an 89.3s
    // video). Read where the <video> actually is and close the real gap with
    // whichever transport button moves the right way.
    await expect(async () => {
      const readyState = await page.evaluate(() => document.querySelector('video')?.readyState ?? 0);
      expect(readyState).toBeGreaterThanOrEqual(1);
    }).toPass({ timeout: 30000 });
    const currentTime = await page.evaluate(() => document.querySelector('video')?.currentTime ?? 0);

    const delta = seekTarget - currentTime;
    const button = delta >= 0
      ? page.getByTitle('Forward 5 seconds (Right arrow)')
      : page.getByTitle('Back 5 seconds (Left arrow)');
    const clicksNeeded = Math.ceil(Math.abs(delta) / 5);
    for (let i = 0; i < clicksNeeded; i++) {
      await button.click({ timeout: 5000 });
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
