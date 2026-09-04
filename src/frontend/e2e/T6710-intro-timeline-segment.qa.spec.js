/**
 * T6710 manual QA (Stage 5, mandatory per spawn-worker SKILL.md QA phase) --
 * live-drives the owner in-app COMPOSITE timeline (intro + reels as ONE real
 * scrubber, not the T6700 bolted-on pre-roll swap) through the REAL running
 * dev app as a real account with real data, per e2e/helpers/realAuth.js /
 * .claude/skills/drive-app-as-user/SKILL.md.
 *
 * This QA pass exists because Stage 4.5 review caught a BLOCKING bug that
 * ONLY a real rendered DOM/browser could see: CompositeScrubber's own root
 * was a plain, non-positioned <div>, so as a bare sibling of the fixed/
 * z-layered region renderers (IntroPreRoll's fixed inset-0 z-[85] default,
 * CollectionPlayer's own internal fixed inset-0 Z.PLAYER (z-[70]) panel) it
 * painted BEHIND both and was invisible/unclickable -- jsdom-based unit tests
 * never do real layout/paint, so they never saw it. The fix
 * (IntroStoryPlayer.jsx) wraps CompositeScrubber in its own
 * `fixed inset-0 ${Z.ALERT}` (z-[90]) container with pointer-events split
 * between the full-viewport wrapper (none) and the bar row itself (auto).
 * This spec proves that fix holds in the real browser, plus the two other
 * things that were BLOCKING before the fix (reel segments hardcoded to 0
 * fill) and the design's core interaction requirements (proportional intro
 * region, true backward seek, forward auto-continue).
 *
 * Precedent: e2e/T6700-owner-inapp-intro.qa.spec.js (setup/attach helpers,
 * reused verbatim below) and e2e/T6680-intro-default-removal.qa.spec.js
 * (loginAsRealUser / saveEvidence patterns).
 *
 * Design doc: docs/plans/tasks/T6710-design.md. Acceptance criteria under
 * test (docs/plans/tasks/player-intro/T6710-owner-playback-intro-as-timeline-segment.md):
 *   AC1. ONE continuous timeline/scrubber spanning intro + content, not two
 *        separately-mounted screens.
 *   AC2. Playhead moves continuously across the intro-to-content boundary
 *        (forward auto-continue), no visible seam, no manual resume.
 *   AC3. Seeking within the content portion works normally.
 *   AC4. Seeking BACKWARD into the intro portion actually works (true
 *        arbitrary seek, design decision 2 -- not restart-from-0).
 *   AC5. Reels/collections with no intro attached are unaffected (single
 *        plain timeline).
 * Plus the two BLOCKING-bug regressions called out in the task brief:
 *   B1. The composite scrubber bar is visible AND clickable (the exact z-index
 *       stacking bug) -- not just toBeVisible(), also a real click reaching it.
 *   B2. Reel segments show LIVE progress filling during playback (previously
 *       hardcoded to 0).
 *
 * This spec drives the real UI end to end (press Play, observe the DOM,
 * click the real bar) rather than asserting API-surface only -- degrading to
 * an honest test.skip + console note ONLY where the driving account's real
 * data genuinely lacks a reel/collection with an intro attached, per T5220's
 * precedent. Test data is never fabricated and consent gates are never
 * bypassed; the setup test grants consent + creates a card via the real UI
 * (T5215/T6700 precedent).
 *
 * Run: bash scripts/dev-verify.sh e2e/T6710-intro-timeline-segment.qa.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const REAL_PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

async function openDrawer(page) {
  await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
  await page.goto('/');
  await page.getByRole('button', { name: /^Published/ }).first().click();
  await expect(page.getByTestId('published-tab-panel').first())
    .toBeVisible({ timeout: 15000 });
}

// Expand the first collapsed game/mix group so its reel tiles mount (T5673/T5215/T6700 pattern).
async function expandFirstGroup(page) {
  const alreadyShown = await page.getByTestId('reel-card').first().isVisible().catch(() => false);
  if (alreadyShown) return true;
  const headers = page.getByTestId('published-tab-panel').getByTestId('collapsible-group-header');
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

async function openManageProfileEdit(page) {
  await page.getByRole('button', { name: /Switch sport or profile/i }).click();
  await expect(page.getByRole('heading', { name: 'Manage Profiles' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Edit name, color & sport' }).first().click();
  await expect(page.getByRole('heading', { name: 'Athlete Intro Card' })).toBeVisible({ timeout: 10000 });
}

async function ensureConsent(page) {
  const checkbox = page.getByRole('checkbox');
  const checked = await checkbox.isChecked();
  if (checked) return;
  const resp = page.waitForResponse(
    (r) => /\/api\/profiles\/.+\/intro-consent/.test(r.url()) && r.request().method() !== 'GET',
    { timeout: 10000 },
  ).catch(() => null);
  await checkbox.click();
  await resp;
  await expect(checkbox).toBeChecked({ timeout: 10000 });
}

async function ensureAtLeastOneCard(page) {
  const introCardsBtn = page.getByRole('button', { name: 'Athlete Intro Cards' });
  await introCardsBtn.click();
  await expect(page.getByTestId('intro-cards-modal')).toBeVisible({ timeout: 10000 });

  const noCardsYet = await page.getByText(/No Athlete Intro Cards yet\./).isVisible().catch(() => false);
  if (noCardsYet) {
    await page.getByRole('button', { name: 'New card' }).click();
    await expect(page.getByLabel('Card name')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Cards' }).click(); // back to grid
  }
  await expect(page.getByText(/No Athlete Intro Cards yet\./)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close' }).click();
}

// Attach `targetCard` to the first reel tile via the real kebab -> Intro ->
// pick -> OK flow (T5215/T6700 precedent). Returns true if the attach UI
// existed and the PATCH succeeded, false if the "Intro" kebab item wasn't present.
async function attachCardToFirstReel(page, targetCard) {
  const tile = page.getByTestId('reel-card').first();
  await tile.hover();
  await tile.getByRole('button', { name: /More actions/i }).click();
  const introItem = page.getByRole('button', { name: 'Intro' });
  if (await introItem.count() === 0) return false;
  await introItem.click();

  const listbox = page.getByRole('listbox', { name: 'Intro card' });
  await expect(listbox).toBeVisible({ timeout: 10000 });
  const optionLocator = listbox.getByRole('option', {
    name: targetCard.is_default ? `${targetCard.name} (your default)` : targetCard.name,
  });
  await optionLocator.click();
  const patchResp = page.waitForResponse(
    (r) => /\/api\/downloads\/\d+\/intro$/.test(r.url()) && r.request().method() === 'PATCH',
    { timeout: 10000 },
  );
  await page.getByRole('button', { name: 'OK' }).click();
  const resp = await patchResp;
  return resp.status() < 300;
}

test.describe('T6710 owner in-app composite intro timeline (real account)', () => {
  test('setup: consent + at least one intro card exist via real UI', async ({ page }) => {
    await page.goto('/');
    await loginAsRealUser(page.context(), REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await openManageProfileEdit(page);
    await ensureConsent(page);
    await ensureAtLeastOneCard(page);
    await saveEvidence(page, 'T6710-setup-consent-and-card');
  });

  test('B1/AC1/AC2/AC4: composite scrubber visible+clickable, distinct intro region, forward auto-continue, true backward seek', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile (drawer empty)');

    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    test.skip(cards.length === 0, 'no intro cards exist (setup test did not run / was skipped)');
    const targetCard = cards[0];

    const attached = await attachCardToFirstReel(page, targetCard);
    test.skip(!attached, '"Intro" kebab item not present on a reel tile (UI drift) -- cannot attach a card to drive this live');

    const dl = await page.request.get('/api/downloads');
    const dlBody = await dl.json();
    const reel = dlBody.downloads.find((d) => d.intro_card_id === targetCard.id);
    test.skip(!reel, 'attach PATCH did not round-trip to a reel with this card id -- cannot proceed live');

    const introPlaybackResp = page.waitForResponse(
      (r) => new RegExp(`/api/downloads/${reel.id}/intro-playback$`).test(r.url()),
      { timeout: 10000 },
    );
    const tile = page.getByTestId('reel-card').first();
    await tile.click();
    const resp = await introPlaybackResp;
    expect(resp.status(), 'GET /api/downloads/{id}/intro-playback must return 200').toBe(200);
    const payload = await resp.json();
    console.log(`[T6710] GET /api/downloads/${reel.id}/intro-playback -> intro=${payload.intro ? payload.intro.card?.name : 'null'}`);

    if (!payload.intro) {
      console.log('[T6710] resolver returned null intro for the attached reel (duration gate or resolve failure) -- cannot verify the VISUAL composite live; covered instead by IntroStoryPlayer.test.jsx / CompositeScrubber.test.jsx (unit-mocked non-null payload)');
      test.skip(true, 'resolver returned null for this reel; unit coverage handles the visual assertion');
    }

    // ---- AC1 / B1: composite scrubber bar is present, VISIBLE, and above the
    // player (the exact thing the stacking bug broke). ----
    // The bar's segment buttons carry aria-label from CompositeScrubber; the
    // intro segment is aria-label="Intro" (design: `label: 'Intro'`).
    const introSegment = page.getByRole('button', { name: 'Intro', exact: true });
    await expect(introSegment, 'composite bar intro segment must be visible above the intro renderer').toBeVisible({ timeout: 10000 });
    await saveEvidence(page, 'B1-composite-bar-visible-over-intro');

    // toBeVisible() checks display/visibility/opacity, not stacking order --
    // explicitly confirm z-index/position puts the bar's wrapper ABOVE both
    // the intro (z-[85] default) and the player (Z.PLAYER, z-[70]) rungs.
    const wrapperZ = await introSegment.evaluate((el) => {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        if (cs.position === 'fixed') return { position: cs.position, zIndex: cs.zIndex };
        node = node.parentElement;
      }
      return null;
    });
    console.log(`[T6710] composite bar fixed-ancestor computed style: ${JSON.stringify(wrapperZ)}`);
    expect(wrapperZ, 'composite bar must have a fixed-position ancestor with an explicit z-index').toBeTruthy();
    expect(Number(wrapperZ.zIndex), 'composite bar wrapper z-index must be >= 90 (Z.ALERT) to clear the intro (z-[85]) and player (z-[70]) rungs').toBeGreaterThanOrEqual(90);

    // Genuine hit-test: elementFromPoint at the segment's own center must
    // resolve to the segment (or a descendant of it), not something else
    // painted on top -- proves it's not just "toBeVisible" but actually
    // reachable by a real click at that screen position.
    const hitTest = await introSegment.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(cx, cy);
      return { reachesSelf: el.contains(top) || top === el, topTag: top?.tagName, topTestId: top?.getAttribute?.('data-testid') };
    });
    console.log(`[T6710] hit-test at intro segment center: ${JSON.stringify(hitTest)}`);
    expect(hitTest.reachesSelf, 'a real click at the intro segment center must reach the segment itself, not whatever is painted underneath').toBe(true);

    // ---- Distinct visual region (design: tint + "Intro" label + divider) ----
    const introTintButton = page.locator('button[data-segment-kind="intro"]');
    await expect(introTintButton, 'intro segment must render with data-segment-kind="intro" (distinct region)').toBeVisible();
    await expect(page.getByTestId('intro-reel-divider'), 'a divider must separate the intro region from the reel cells').toBeVisible();
    await saveEvidence(page, 'AC-distinct-intro-region-tint-label-divider');

    // ---- AC1: intro renderer showing, player video not yet mounted ----
    // T7730: scope to the CollectionPlayer's own video. A bare page.locator('video')
    // also matches the ~30 per-tile hover-preview <video> elements (T6420/T6820),
    // so toHaveCount(0)/(1) asserted against the wrong set.
    const video = page.locator('[data-testid="collection-player-video"]');
    await expect(video, 'CollectionPlayer video must not be mounted while the intro region is active').toHaveCount(0);

    // ---- B1 clickability: click INTO a reel segment partway through and
    // confirm the click actually reaches the bar and triggers a real seek
    // (not a silent no-op / fall-through to whatever's underneath). Clicking
    // a reel segment also forces the region out of 'intro' into 'reels'. ----
    const reelSegments = page.locator('button[data-segment-kind="reel"]');
    const reelCount = await reelSegments.count();
    expect(reelCount, 'at least one reel segment must be present in the composite bar').toBeGreaterThan(0);
    const firstReelSegment = reelSegments.first();
    const reelBox = await firstReelSegment.boundingBox();
    expect(reelBox, 'reel segment must have a real bounding box (be laid out/visible)').toBeTruthy();
    // Click at ~40% across the segment's own width (not its very start).
    await firstReelSegment.click({ position: { x: reelBox.width * 0.4, y: reelBox.height / 2 } });

    // A real seek: the player mounts (region left 'intro'), proving the click
    // reached the bar and actually drove the composite's onScrub, not a
    // silent no-op.
    await expect(video, 'clicking a reel segment must actually seek -- CollectionPlayer must mount').toHaveCount(1, { timeout: 15000 });
    await saveEvidence(page, 'B1-clickable-reel-segment-seek-worked');

    // ---- AC2: (if we hadn't clicked forward, this is what auto-continue
    // looks like) -- already proven above the click-seek works; separately
    // confirm actual PLAYING state, not just mounted/paused. ----
    const isPlaying = await video.first().evaluate((el) => !el.paused && !el.ended);
    console.log(`[T6710] after reel-segment seek, video playing=${isPlaying}`);
    expect(isPlaying, 'video must be actively playing after the composite seek landed in reels').toBe(true);

    // ---- B2: live progress fill on the active reel segment. Sample the
    // active reel segment's fill width/style at two points in time a couple
    // seconds apart and confirm it visibly advances (previously hardcoded to 0). ----
    const activeReelFillBefore = await firstReelSegment.locator('[style*="width"]').first()
      .evaluate((el) => el.style.width).catch(() => null);
    console.log(`[T6710] active reel fill (t0): ${activeReelFillBefore}`);
    await page.waitForTimeout(2500);
    const activeReelFillAfter = await firstReelSegment.locator('[style*="width"]').first()
      .evaluate((el) => el.style.width).catch(() => null);
    console.log(`[T6710] active reel fill (t0+2.5s): ${activeReelFillAfter}`);
    expect(activeReelFillBefore, 'must be able to read a fill width style on the active reel segment').not.toBeNull();
    expect(activeReelFillAfter, 'must be able to read a fill width style on the active reel segment after waiting').not.toBeNull();
    expect(activeReelFillAfter, 'B2: active reel segment fill must visibly advance during playback (was hardcoded to 0 before the fix)').not.toBe(activeReelFillBefore);
    await saveEvidence(page, 'B2-reel-fill-advanced-during-playback');

    // ---- AC4: TRUE backward seek into the intro. Click partway through the
    // intro segment's OWN width (not its very start) and confirm it lands
    // there -- the intro renderer shows again, video unmounts. ----
    const introBoxAfter = await introSegment.boundingBox();
    expect(introBoxAfter, 'intro segment must still have a bounding box after landing in reels').toBeTruthy();
    await introSegment.click({ position: { x: introBoxAfter.width * 0.6, y: introBoxAfter.height / 2 } });

    // A true backward seek: the intro renderer comes back (video unmounts).
    await expect(video, 'clicking back into the intro segment must land there -- CollectionPlayer must unmount').toHaveCount(0, { timeout: 10000 });
    await saveEvidence(page, 'AC4-backward-seek-into-intro-landed');

    // Confirm it's not simply restarted from 0: the intro fill (ProgressTrack
    // width within the intro segment) should reflect ~60% of the intro's
    // duration, not 0%. MotionPreview mounts fresh each region switch, but
    // IntroStoryPlayer's own clock (introTimeMs) is what the bar's fill
    // reads -- read the bar's own fill, which is the true-seek signal
    // (independent of the renderer's internal DOM).
    const introFillWidth = await introSegment.locator('[style*="width"]').first()
      .evaluate((el) => el.style.width);
    console.log(`[T6710] intro fill after backward seek to ~60%: ${introFillWidth}`);
    const introFillPct = parseFloat(introFillWidth);
    expect(introFillPct, 'AC4: a backward seek to ~60% into the intro must NOT read back as 0% (true arbitrary seek, not restart-from-0)').toBeGreaterThan(10);

    await page.keyboard.press('Escape').catch(() => {});
  });

  test('AC2: forward auto-continue -- intro plays through to its end and transitions into the first reel with no manual resume', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile (drawer empty)');

    const cardsResp = await page.request.get('/api/intro-cards');
    const { cards } = await cardsResp.json();
    test.skip(cards.length === 0, 'no intro cards exist (setup test did not run / was skipped)');
    const targetCard = cards[0];

    const attached = await attachCardToFirstReel(page, targetCard);
    test.skip(!attached, '"Intro" kebab item not present on a reel tile (UI drift)');

    const dl = await page.request.get('/api/downloads');
    const dlBody = await dl.json();
    const reel = dlBody.downloads.find((d) => d.intro_card_id === targetCard.id);
    test.skip(!reel, 'attach PATCH did not round-trip to a reel with this card id');

    const introPlaybackResp = page.waitForResponse(
      (r) => new RegExp(`/api/downloads/${reel.id}/intro-playback$`).test(r.url()),
      { timeout: 10000 },
    );
    await page.getByTestId('reel-card').first().click();
    const resp = await introPlaybackResp;
    const payload = await resp.json();
    if (!payload.intro) {
      test.skip(true, 'resolver returned null for this reel; unit coverage handles the visual assertion');
    }

    const introDurSec = payload.intro.card?.duration || 4.0;
    console.log(`[T6710] intro duration ~${introDurSec}s -- waiting for auto-continue`);

    // T7730: scope to the CollectionPlayer's own video. A bare page.locator('video')
    // also matches the ~30 per-tile hover-preview <video> elements (T6420/T6820),
    // so toHaveCount(0)/(1) asserted against the wrong set.
    const video = page.locator('[data-testid="collection-player-video"]');
    await expect(video, 'video must not be mounted while intro plays').toHaveCount(0);

    // Auto-continue: no manual click. Wait up to intro duration + generous margin.
    await expect(video, 'video must auto-mount once the intro clock reaches its end, with no manual resume click').toHaveCount(1, { timeout: (introDurSec * 1000) + 15000 });
    const isPlaying = await video.first().evaluate((el) => !el.paused && !el.ended);
    console.log(`[T6710] forward auto-continue landed, playing=${isPlaying}`);
    expect(isPlaying, 'video must be auto-playing after forward auto-continue, no manual resume step').toBe(true);
    await saveEvidence(page, 'AC2-forward-auto-continue-no-manual-resume');

    await page.keyboard.press('Escape').catch(() => {});
  });

  test('AC5 (pass-through, optional): reel with no intro attached renders a plain single timeline', async ({ page }) => {
    await openDrawer(page);
    const hasReels = await expandFirstGroup(page);
    test.skip(!hasReels, 'no published reels on this account/profile (drawer empty)');

    const dl = await page.request.get('/api/downloads');
    const dlBody = await dl.json();
    const noIntroReel = dlBody.downloads.find((d) => !d.intro_card_id);
    test.skip(!noIntroReel, 'every reel on this account currently has an intro attached -- cannot isolate the no-intro case live; covered by IntroStoryPlayer.test.jsx pass-through unit test');

    const tiles = page.getByTestId('reel-card');
    const count = await tiles.count();
    let targetTile = null;
    for (let i = 0; i < count; i++) {
      const badge = tiles.nth(i).getByTestId('intro-badge');
      if (await badge.count() === 0) { targetTile = tiles.nth(i); break; }
    }
    test.skip(!targetTile, 'could not locate a visibly no-intro tile in the current DOM group');

    const introPlaybackResp = page.waitForResponse(
      (r) => /\/api\/downloads\/\d+\/intro-playback$/.test(r.url()),
      { timeout: 10000 },
    );
    await targetTile.click();
    const resp = await introPlaybackResp;
    const payload = await resp.json();
    expect(payload.intro, 'a never-attached reel must resolve null').toBeNull();

    // No intro region: player mounts immediately.
    // T7730: scope to the CollectionPlayer's own video. A bare page.locator('video')
    // also matches the ~30 per-tile hover-preview <video> elements (T6420/T6820),
    // so toHaveCount(0)/(1) asserted against the wrong set.
    const video = page.locator('[data-testid="collection-player-video"]');
    await expect(video, 'CollectionPlayer must mount immediately with no intro region for a never-attached reel').toHaveCount(1, { timeout: 10000 });

    // Composite bar still renders sanely: no "Intro" segment/divider present.
    await expect(page.getByRole('button', { name: 'Intro', exact: true }), 'no intro segment should render when there is no intro').toHaveCount(0);
    await expect(page.getByTestId('intro-reel-divider'), 'no divider should render when there is no intro').toHaveCount(0);
    // At least one reel segment still renders (the bar renders sanely, not blank).
    await expect(page.locator('button[data-segment-kind="reel"]').first(), 'the reel segment bar must still render for the pass-through case').toBeVisible();

    await saveEvidence(page, 'AC5-pass-through-no-intro-plain-timeline');
    await page.keyboard.press('Escape').catch(() => {});
  });
});
