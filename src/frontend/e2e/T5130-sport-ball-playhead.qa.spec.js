import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

// T5130 QA — the published-video scrub handle is the publishing profile's sport
// ball. This drives the PUBLIC shared-reel viewer end to end: it exercises the
// backend surfacing (shares.sharer_default_sport -> ShareDetailResponse.sport),
// SharedVideoOverlay -> MediaPlayer -> VideoControls, and proves the ball rides
// the progress and drag-to-seek still works.
//
// Author-side resolution (DraftTile preview -> MediaPlayer) + the exact soccer/
// football glyph mapping + the unknown-sport plain-dot fallback are covered by
// the unit specs (VideoControls.test.jsx, MediaPlayer.test.jsx); Highlight Reels /
// RankingGame use CollectionPlayer (a segmented bar, no scrub-dot handle), so
// they are out of scope for the handle swap.

// Mirror of tagRegistry SPORT_EMOJI so the spec (node context) doesn't import a
// browser module. Proves the rendered glyph matches the frozen sport, not a
// hardcoded ball.
const SPORT_EMOJI = {
  soccer: '⚽', flag_football: '🏈', american_football: '🏈', basketball: '🏀',
  lacrosse: '🥍', rugby: '🏉', volleyball: '🏐', hockey: '🏒', tennis: '🎾',
  baseball: '⚾', softball: '🥎',
};

const REEL_ID = 34; // an existing published reel on the imankh fixture
let shareToken = null;

test.describe('T5130 sport-ball playhead handle (public share)', () => {
  test('the frozen-sport ball rides the timeline and drag-to-seek still works', async ({ browser, context, page }) => {
    test.setTimeout(90_000);
    await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');

    // Create a PUBLIC share for a real published reel.
    const createResp = await page.request.post(`/api/gallery/${REEL_ID}/share`, {
      data: { recipient_emails: [], is_public: true },
    });
    expect(createResp.ok()).toBeTruthy();
    shareToken = (await createResp.json()).shares[0].share_token;

    // Backend surfaced the frozen publishing-profile sport onto the payload.
    const detail = await (await page.request.get(`/api/shared/${shareToken}`)).json();
    const expectedSport = detail.sport;
    expect(expectedSport, 'share payload carries the frozen sport').toBeTruthy();
    const expectedGlyph = SPORT_EMOJI[expectedSport];
    expect(expectedGlyph, `known sport emoji for ${expectedSport}`).toBeTruthy();

    // Open the PUBLIC viewer in a FRESH, UNAUTHENTICATED context — App.jsx only
    // renders the public-share-only path when !isAuthenticated. Reusing the
    // logged-in page keeps the full dashboard (with its own ~7 background <video>
    // tags) mounted underneath, which breaks the unscoped `video` locator below.
    // A new context matches real public-viewer semantics.
    const publicContext = await browser.newContext();
    const page2 = await publicContext.newPage();
    await page2.goto(`/shared/${shareToken}`);
    const video = page2.locator('video');
    await video.waitFor({ timeout: 30000 });
    await page2.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && v.readyState >= 1 && v.duration > 0;
    }, { timeout: 30000 });

    // 1) The handle is the frozen profile's sport ball, not the plain purple dot.
    const glyph = page2.getByTestId('scrub-handle-glyph');
    await expect(glyph).toBeVisible();
    expect((await glyph.textContent()).trim()).toBe(expectedGlyph);
    // Plain dot is gone (rounded-full + purple; progress fill is purple but not rounded).
    expect(await page2.locator('.rounded-full.bg-purple-500').count()).toBe(0);
    await saveEvidence(page2, 'T5130-criterion1-2-sport-ball-handle');

    // 2) Rides the progress: the handle's left position tracks currentTime.
    // Pause so playback drift doesn't race the assertions; the handle position is
    // bound to currentTime, so setting it deterministically moves the ball.
    await video.evaluate((v) => v.pause());
    const leftPctAt = async () => {
      const left = await glyph.evaluate((el) => el.style.left);
      const m = left.match(/calc\(([\d.]+)%/);
      return m ? parseFloat(m[1]) : NaN;
    };
    await video.evaluate((v) => { v.currentTime = v.duration * 0.25; });
    await expect.poll(leftPctAt).toBeGreaterThan(20); // ~25% along
    await video.evaluate((v) => { v.currentTime = v.duration * 0.75; });
    await expect.poll(leftPctAt).toBeGreaterThan(70); // ball rode forward to ~75%

    // 3) Drag-to-seek still works. Reset to the start; reveal the auto-hidden
    // controls by hovering the player; then click the timeline at ~40% via a
    // Playwright element click (auto-waits for pointer-events, so a hidden-control
    // miss surfaces as a clear failure instead of silently toggling play).
    await video.evaluate((v) => { v.pause(); v.currentTime = 0; });
    await expect.poll(leftPctAt).toBeLessThan(5);
    const timeline = page2.getByTestId('scrub-timeline');
    const box = await timeline.boundingBox();
    const tx = box.x + box.width * 0.4;
    const ty = box.y + box.height / 2;
    // Move first so MediaPlayer reveals its auto-hidden controls (flips the
    // container from pointer-events-none to auto) BEFORE the press lands.
    await page2.mouse.move(tx, ty);
    await page2.waitForTimeout(300);
    await page2.mouse.down();
    await page2.mouse.up();
    await video.evaluate((v) => v.pause());       // pressing may also start playback
    const seekedRatio = await video.evaluate((v) => (v.duration ? v.currentTime / v.duration : 0));
    expect(seekedRatio, 'click at 40% seeked playback to ~40%').toBeGreaterThan(0.3);
    await expect.poll(leftPctAt, { message: 'handle followed the seek' }).toBeGreaterThan(30);
    await saveEvidence(page2, 'T5130-criterion3-drag-to-seek');
    await publicContext.close();
  });

  test('responsive sweep: shared viewer has no horizontal overflow', async ({ browser, context, page }) => {
    test.setTimeout(60_000);
    await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
    const createResp = await page.request.post(`/api/gallery/${REEL_ID}/share`, {
      data: { recipient_emails: [], is_public: true },
    });
    shareToken = (await createResp.json()).shares[0].share_token;
    // Public viewer in a fresh unauthenticated context (see the criterion test's
    // note) so the real !isAuthenticated share layout is what gets swept.
    const publicContext = await browser.newContext();
    const page2 = await publicContext.newPage();
    await page2.goto(`/shared/${shareToken}`);
    await page2.locator('video').waitFor({ timeout: 30000 });
    await responsiveSweep(page2);
    await publicContext.close();
  });

  test.afterEach(async ({ context }) => {
    // Clean up the share row so the QA does not leak orphans onto the live
    // imankh account (annotate.md landmine).
    if (shareToken) {
      await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
      await context.request.delete(`/api/shared/${shareToken}`).catch(() => {});
      shareToken = null;
    }
  });
});
