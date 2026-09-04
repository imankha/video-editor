/**
 * T6730 investigation + regression guard -- clicking the "Intro" segment on the
 * composite scrubber AFTER forward auto-continue (the intro clock reached its
 * end and handed off to the reels on its own) seeks BACK into the intro.
 *
 * CONCLUSION (see docs/plans/tasks/player-intro/T6730-evidence.md): the reported
 * "nothing happens / intro never re-appears" is NOT a functional defect in the
 * current code -- it is a MEASUREMENT ARTIFACT of the repro method:
 *   (1) React 18 batches the click handler's setState (setRegion + setIntroTimeMs
 *       in IntroStoryPlayer.onScrub) and commits on the NEXT flush, so a
 *       same-tick check after a synthetic .click() still sees the reel <video>;
 *       one frame later (~14-19ms, imperceptible) the region has switched.
 *   (2) A synthetic `element.click()` gives e.clientX=0, so CompositeScrubber's
 *       fraction clamps to 0 -> seekIntro(0) -> the card mounts at t=0, where the
 *       staggered text is legitimately still opacity 0 (the athlete name fades in
 *       over ~1s) -- so it looks "blank" though it did re-appear.
 * A REAL positional/mouse click lands at the clicked fraction and shows content.
 * Verified independently by the Opus expert agent (no snap-back, no stale-rAF
 * advance, no dedup drop, endedFiredRef correctly re-armed on seekIntro(<dur)).
 *
 * These two tests are the live regression guard for the auto-continue ->
 * backward-seek path (the live coverage gap T6710's QA left; T6710 only drove
 * the backward seek after a MANUAL reel-segment click). They also DOCUMENT the
 * artifact so a future reader understands why the report looked like a bug.
 * (A third "synthetic .click() probe" test was removed by T7770 -- it was
 * investigation scaffolding, not a regression guard.)
 *
 * Setup/attach: card is attached to every reel via the supported PATCH
 * /api/downloads/{id}/intro (dodges the flaky kebab UI); player video is scoped
 * to the role=dialog panel so drawer tile-preview <video>s never confuse the
 * "intro active vs reels active" signal.
 *
 * Repro account (.dotask-kickoff.md): imankh@gmail.com / profile 9fa7378c.
 * Run: bash scripts/dev-verify.sh e2e/T6730-seek-back-to-intro.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /^Highlights/ }).first().click();
  await expect(page.getByTestId('highlights-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.getByTestId('highlights-tab-panel').getByTestId('collapsible-group-header');
  await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
    const appeared = await page.getByTestId('reel-card').first()
      .waitFor({ state: 'visible', timeout: 4000 }).then(() => true).catch(() => false);
    if (appeared) return true;
  }
  return false;
}

// Attach `cardId` to EVERY download via the supported backend endpoint
// (PATCH /api/downloads/{id}/intro -- the exact call useDownloads.setIntroCard
// makes on the OK gesture). This is the SAME persisted state a real user's
// attach produces; done over the API only to dodge the flaky kebab->menu->OK
// UI, and applied to all downloads so whichever tile is `.first()` in the
// drawer is guaranteed to open with an intro region. Returns the count attached.
async function attachCardToAllReels(page, cardId) {
  const dl = await page.request.get('/api/downloads');
  const body = await dl.json();
  const downloads = body.downloads || [];
  let ok = 0;
  for (const d of downloads) {
    const resp = await page.request.patch(`/api/downloads/${d.id}/intro`, {
      data: { intro_card_id: cardId },
      headers: { 'Content-Type': 'application/json' },
    });
    if (resp.status() < 300) ok++;
  }
  return ok;
}

test.describe('T6730 seek back into intro after forward auto-continue (real account)', () => {
  test('regression: click Intro at 60% after auto-continue seeks back into the intro (player unmounts, content shows)', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile');

    const cardsResp = await page.request.get('/api/intro-cards');
    const cardsBody = await cardsResp.json();
    const cards = cardsBody.cards || [];
    test.skip(cards.length === 0, 'no intro cards exist (run T6710 setup test first)');

    const attachedCount = await attachCardToAllReels(page, cards[0].id);
    test.skip(attachedCount === 0, 'no downloads to attach an intro card to');
    console.log(`[T6730] attached card ${cards[0].id} (${cards[0].name}) to ${attachedCount} reel(s) via API`);
    // No reload needed: handlePlay always fetches /intro-playback fresh on the
    // Play gesture, so the backend's freshly-attached card is picked up even if
    // the drawer's cached download rows don't yet show the intro badge.

    // Player video scoped to the dialog panel -> tile-preview <video>s in the
    // drawer never confuse the intro-active vs reels-active signal.
    const playerVideo = page.getByRole('dialog').locator('video');
    const introSegment = page.getByRole('button', { name: 'Intro', exact: true });

    const introPlaybackResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro-playback$/.test(r.url()),
      { timeout: 10000 },
    );
    await page.getByTestId('reel-card').first().click();
    const resp = await introPlaybackResp;
    const payload = await resp.json();
    test.skip(!payload.intro, 'resolver returned null intro for the first reel');
    const introDurSec = payload.intro.card?.duration || 4.0;
    console.log(`[T6730] intro=${payload.intro.card?.name} dur=${introDurSec}s`);

    await expect(introSegment).toBeVisible({ timeout: 10000 });
    // Intro region active first -> no player video yet.
    await expect(playerVideo, 'intro region active first, no player video yet').toHaveCount(0);

    // ---- FORWARD AUTO-CONTINUE: do NOT click anything. Wait for the intro
    // clock to reach its end and hand off to the reels on its own. ----
    await expect(playerVideo, 'forward auto-continue: player video must auto-mount when intro clock ends')
      .toHaveCount(1, { timeout: (introDurSec * 1000) + 15000 });
    console.log('[T6730] forward auto-continue landed in reels (player video mounted)');
    await saveEvidence(page, 'T6730-after-auto-continue-in-reels');

    // Let the reel play a beat so we are unambiguously in the reels region.
    await page.waitForTimeout(1500);

    // ---- THE REPRO: click the Intro segment at ~60% of its own width. ----
    const introBox = await introSegment.boundingBox();
    expect(introBox, 'intro segment must still be laid out after auto-continue').toBeTruthy();
    const cx = introBox.x + introBox.width * 0.6;
    const cy = introBox.y + introBox.height / 2;
    const hit = await page.evaluate(({ x, y }) => {
      const top = document.elementFromPoint(x, y);
      return { tag: top?.tagName, kind: top?.getAttribute?.('data-segment-kind'), label: top?.getAttribute?.('aria-label') };
    }, { x: cx, y: cy });
    console.log(`[T6730] hit-test at intro 60%: ${JSON.stringify(hit)}`);

    await introSegment.click({ position: { x: introBox.width * 0.6, y: introBox.height / 2 } });

    const introFillAfter = await introSegment.locator('[style*="width"]').first()
      .evaluate((el) => el.style.width).catch(() => null);
    console.log(`[T6730] intro fill right after backward click: ${introFillAfter}`);
    await saveEvidence(page, 'T6730-right-after-backward-click');

    // ---- ASSERTION: region must return to intro -> player video unmounts. ----
    await expect(playerVideo, 'clicking Intro after auto-continue seeks back into the intro (player video unmounts)')
      .toHaveCount(0, { timeout: 8000 });
    await saveEvidence(page, 'T6730-backward-seek-landed-in-intro');

    // And it must be a true arbitrary seek (~60%), not restart-from-0.
    const introFill = await introSegment.locator('[style*="width"]').first()
      .evaluate((el) => el.style.width);
    console.log(`[T6730] intro fill after backward seek to ~60%: ${introFill}`);
    expect(parseFloat(introFill), 'true seek to ~60%, not restart-from-0').toBeGreaterThan(10);

    await page.keyboard.press('Escape').catch(() => {});
  });

  // Removed the "EXACT kickoff repro: synthetic .click()" test: it was
  // investigation scaffolding whose only assertion was `probe.f5 toBeTruthy`
  // (i.e. a snapshot was captured), documenting the resolved measurement
  // artifact (a synthetic element.click() reports clientX=0, so the scrubber
  // clamps to fraction 0) via console.log. The real regression guards -- the
  // real-positional-click seek (test above) and the real-mouse repeated seek
  // (test below) -- fully cover the auto-continue -> backward-seek path with
  // genuine positional assertions (T7770, survey item 16).

  test('REAL mouse gesture, no settle, repeated: region switches reliably AND intro name becomes visible', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels');
    const cards = (await (await page.request.get('/api/intro-cards')).json()).cards || [];
    test.skip(cards.length === 0, 'no intro cards');
    test.skip((await attachCardToAllReels(page, cards[0].id)) === 0, 'no downloads');

    const playerVideo = page.getByRole('dialog').locator('video');
    const introSegment = page.getByRole('button', { name: 'Intro', exact: true });
    const introPlaybackResp = page.waitForResponse((r) => /\/api\/downloads\/\d+\/intro-playback$/.test(r.url()), { timeout: 10000 });
    await page.getByTestId('reel-card').first().click();
    const payload = await (await introPlaybackResp).json();
    test.skip(!payload.intro, 'null intro');
    const introDurSec = payload.intro.card?.duration || 4.0;

    // Auto-continue into reels.
    await expect(playerVideo).toHaveCount(1, { timeout: (introDurSec * 1000) + 15000 });

    // Real mouse click at ~40% of the intro segment, IMMEDIATELY (no settle).
    // Measure how many rAF frames until the region actually switches, and
    // whether the intro name renders (opacity resolves > 0) after the fade-in.
    for (let iter = 0; iter < 3; iter++) {
      const box = await introSegment.boundingBox();
      const tMs = await page.evaluate(() => performance.now());
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2);
      await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
      // Poll for the region switch and record elapsed time.
      await expect(playerVideo, `iter ${iter}: region must switch to intro (video unmounts)`).toHaveCount(0, { timeout: 5000 });
      const switchedMs = (await page.evaluate(() => performance.now())) - tMs;
      // After the fade-in window, the athlete name text must actually be
      // rendered visible (a real DOM node with resolved opacity > 0), not just
      // present-but-transparent.
      await page.waitForTimeout(1500);
      const nameVisible = await page.evaluate(() => {
        const mp = document.querySelector('[data-testid="motion-preview"]');
        if (!mp) return { ok: false, why: 'no motion-preview' };
        const txt = mp.textContent || '';
        // find any descendant whose computed opacity chain is > 0 and shows the name
        const hasName = /Mehdi|Khabazian/.test(txt);
        // check the slot wrapper opacities (MotionPreview slots start opacity:0, animate up)
        const slots = [...mp.querySelectorAll('[data-testid^="motion-slot-"]')];
        const anyVisibleSlot = slots.some((s) => parseFloat(getComputedStyle(s).opacity) > 0.5
          || [...s.querySelectorAll('*')].some((c) => parseFloat(getComputedStyle(c).opacity) > 0.5 && (c.textContent || '').trim()));
        return { ok: hasName, anyVisibleSlot, slotCount: slots.length };
      });
      console.log(`[T6730-real] iter ${iter}: region switched after ~${Math.round(switchedMs)}ms; name=${JSON.stringify(nameVisible)}`);
      expect(nameVisible.ok, `iter ${iter}: intro content (name) must be present after seek-back`).toBe(true);
      expect(nameVisible.anyVisibleSlot, `iter ${iter}: at least one intro text slot must actually be VISIBLE (opacity>0.5) after the fade-in window`).toBe(true);
      // Reset for next iteration: let it auto-continue back into reels.
      await expect(playerVideo, `iter ${iter}: re-arm — must auto-continue back into reels`).toHaveCount(1, { timeout: (introDurSec * 1000) + 8000 });
    }
    await saveEvidence(page, 'T6730-real-mouse-repeated');
    await page.keyboard.press('Escape').catch(() => {});
  });
});
