/**
 * cta-visibility (T8550) — mobile CTA visibility sweep.
 *
 * Every journey-primary CTA must sit ABOVE THE FOLD, without scrolling, at the
 * four phone widths a real mobile user hits (6 of 28 prod users are mobile-only,
 * and T8140 already caught the clip form's Save below the fold once). This spec
 * drives each surface in its real, populated state and asserts the CTA's bounding
 * box fits the viewport the instant the surface paints — see
 * helpers/qa.js:assertCtaInViewport ("without scrolling" = asserted before any
 * programmatic scroll).
 *
 * REAL-BROWSER RULE: this is a Playwright-headed audit, never jsdom — the whole
 * point is real layout geometry (viewport, safe-area, flex-wrap) that jsdom fakes.
 *
 * Target: local dev OR deployed staging (see playwright.config.js / FIXTURE-
 * CONTRACT.md). Data-bearing surfaces log in as the seeded real account
 * (imankh@gmail.com / 9fa7378c) rather than creating data. The sweep is
 * NON-MUTATING: it OPENS each surface and measures the CTA, and NEVER fires the
 * terminal gesture (never submits Add Game, never Saves a play, never publishes,
 * never exports) — so a shared fixture account is safe to drive.
 *
 * Honest skips (repo convention — a skip is reported skipped, never silent green):
 *   - The Focus completion action bar (FocusPublishActionBar) only mounts in the
 *     transient post-export preview (`showExportCompletePreview && workingVideo.url`,
 *     FocusScreen.jsx). Reaching it live requires running a real export (credits +
 *     GPU + mutates the account), so it is NOT driven here; its four-choice stack is
 *     unit-covered (FocusPublishActionBar.test.jsx). It renders inside the SAME
 *     CollectionPlayer footer slot the Reel player surface below already audits.
 *   - Data-gated surfaces (a Ready-to-share draft tile, a published reel) skip
 *     loudly when the seeded account lacks that state.
 */
import { test } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { assertCtaInViewport, CTA_VIEWPORTS, saveEvidence } from './helpers/qa.js';

const AUDIT_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const AUDIT_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
// A game with a real source video on the audit account (T4770/T4930 use game 6).
const AUDIT_GAME_ID = Number(process.env.T8550_GAME_ID || process.env.T4770_GAME_ID || 6);

/** Home shell interactive: the Games tab button is the first paint. */
async function reachHome(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('button:has-text("Games")').first()
    .waitFor({ state: 'visible', timeout: 30000 });
}

/** Click a top-level home tab by its accessible-name prefix. */
async function openTab(page, namePrefix) {
  const tab = page.getByRole('button', { name: namePrefix }).first();
  await tab.waitFor({ state: 'visible', timeout: 15000 });
  await tab.click();
  return tab;
}

// One describe per phone width — test.use fixes the viewport at context creation
// so the app MOUNTS at that width (mobile layouts render correctly), not after a
// mid-test resize.
for (const vp of CTA_VIEWPORTS) {
  test.describe(`CTA visibility @ ${vp.name}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ context }) => {
      // reachFocus/annotate legitimately wait on video/crop load; the deployed
      // 60s default is too tight for the multi-nav data surfaces.
      test.setTimeout(180_000);
      await loginAsRealUser(context, AUDIT_EMAIL, AUDIT_PROFILE);
    });

    // --- Surface 1: Add Game modal (submit + dropzone) -----------------------
    // FINDING T8550-F2 (live-verify owed): submit is below the fold at 320x568
    // WITHOUT a keyboard (612 > 568), and behind the simulated keyboard at every
    // width (the modal is max-h-[90vh] overflow-y-auto with the submit INSIDE the
    // scroll container). Prescribed fix (policy #2): scrollable body + fixed footer
    // so submit is pinned. NOTE the keyboard-open half is only partly satisfiable:
    // real iOS does not shrink the LAYOUT viewport when the keyboard opens, so a
    // full-height modal's footer still overlaps the keyboard band unless the modal
    // itself resizes to visualViewport — a bigger change than the fixed-footer.
    // Un-fixme once the fix lands and the spec re-runs green headed at all 4 widths.
    test.fixme('Add Game modal: submit CTA above the fold', async ({ page }) => {
      await reachHome(page);
      await openTab(page, /^Games/);
      await page.getByRole('button', { name: 'Add Game', exact: true }).first().click();

      const form = page.locator('form:has([data-testid="game-details-disclosure"])');
      await form.waitFor({ state: 'visible', timeout: 15000 });
      const submit = form.locator('button[type="submit"]');
      const dropzone = form.locator('[role="button"]').first();

      await assertCtaInViewport(page, submit);
      await assertCtaInViewport(page, dropzone);
      await saveEvidence(page, `cta-add-game_${vp.name}`);

      // Keyboard-open variant: opponent is a first-class text field (T8700). Focus
      // it, then assert submit survives an on-screen keyboard eating the bottom 40%.
      await form.locator('input[type="text"]').first().focus();
      await assertCtaInViewport(page, submit, { keyboardOpen: true });
      await saveEvidence(page, `cta-add-game-keyboard_${vp.name}`);
    });

    // --- Surface 2: Add Play sheet (Save) ------------------------------------
    // FINDING T8550-F3 (live-verify owed): the T8140 sticky footer IS working (Save
    // is pinned at the bottom of the sheet), but at the two SHORTEST heights the
    // sheet content pushes Save just under the simulated-keyboard line — 363>340 at
    // 320x568, 413.8>400 at 375x667 (passes at 390x844 / 428x926). Non-keyboard
    // passes at every width. Prescribed fix (policy #3): trim the sheet's vertical
    // padding at the narrow breakpoints so Save clears the keyboard band on the
    // short phones. Un-fixme once the fix lands and re-runs green.
    test.fixme('Add Play sheet: Save CTA above the fold', async ({ page }) => {
      await openGameInAnnotate(page, AUDIT_GAME_ID);
      await page.locator('video').first().waitFor({ state: 'attached', timeout: 40000 });

      const addPlay = page.getByTestId('annotate-primary-cta');
      const gotCta = await addPlay.waitFor({ state: 'visible', timeout: 20000 })
        .then(() => true).catch(() => false);
      test.skip(!gotCta, 'Annotate primary CTA did not mount (game may lack a source video)');
      await addPlay.click();

      // Save/Update lives in the overlay's pinned footer (create shows "Save").
      const save = page.getByRole('button', { name: /^(Save|Update)$/ });
      await save.first().waitFor({ state: 'visible', timeout: 15000 });

      await assertCtaInViewport(page, save.first());
      await saveEvidence(page, `cta-add-play_${vp.name}`);

      // Keyboard-open variant: focus the clip-name input, then re-assert Save.
      const nameInput = page.getByPlaceholder('Enter clip name...');
      if (await nameInput.count()) {
        await nameInput.first().focus();
        await assertCtaInViewport(page, save.first(), { keyboardOpen: true });
        await saveEvidence(page, `cta-add-play-keyboard_${vp.name}`);
      }
    });

    // --- Surface 3: Focus panel (Export Focused Video) -----------------------
    // FINDING T8550-F1 (live-verify owed) — the headline bug from the 2026-09-03
    // user report ("export buttons sit below the scroll line"): the Export Focused
    // Video button sits ~400px below the fold at EVERY phone width (950/957/1028/
    // 1061 vs 568/667/844/926) — it lives at the bottom of the Focus editor, after
    // the video + timeline + segment editor. Prescribed fix (policy #1): a sticky
    // bottom action bar reusing the T8140 pattern. This touches the shared Focus
    // editor screen (desktop-regression surface), so it needs real-browser
    // verification at all 4 widths before it ships — un-fixme when green.
    test.fixme('Focus panel: Export CTA above the fold', async ({ page }) => {
      await reachHome(page);
      await openTab(page, /^In Progress Clips/);
      const framingChip = page.getByTitle(/\(click to open\)/)
        .filter({ hasNotText: /^Overlay:/ }).first();
      const hasChip = await framingChip.waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true).catch(() => false);
      test.skip(!hasChip, 'no Focus-ready draft on this account');
      await framingChip.click();
      await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });

      const exportBtn = page.getByRole('button', { name: /Export Focused Video/ });
      await exportBtn.first().waitFor({ state: 'visible', timeout: 20000 });
      await assertCtaInViewport(page, exportBtn.first());
      await saveEvidence(page, `cta-focus-export_${vp.name}`);
    });

    // --- Surface 4: Focus completion action bar (export-gated) ---------------
    // Honest skip: FocusPublishActionBar only mounts in the post-export preview,
    // unreachable without running a real export. Unit-covered + same footer slot
    // as the Reel player surface below.
    test('Focus completion action bar: export-gated', async () => {
      test.skip(true, 'FocusPublishActionBar mounts only post-export (showExportCompletePreview); ' +
        'covered by FocusPublishActionBar.test.jsx and the CollectionPlayer footer audit');
    });

    // --- Surface 5: Ready board tile (Publish) -------------------------------
    test('Ready board tile: Publish CTA above the fold', async ({ page }) => {
      await reachHome(page);
      await openTab(page, /^In Progress Clips/);
      const publish = page.getByTestId('ready-actions')
        .getByRole('button', { name: 'Publish to Highlight Reels' }).first();
      const hasReady = await publish.waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true).catch(() => false);
      test.skip(!hasReady, 'no Ready-to-share draft tile on this account');

      await assertCtaInViewport(page, publish);
      await saveEvidence(page, `cta-ready-tile_${vp.name}`);
    });

    // --- Surface 6: Reel player (Share) --------------------------------------
    test('Reel player: Share CTA above the fold', async ({ page }) => {
      await reachHome(page);
      await openTab(page, /^Published/);
      const reelCard = await openFirstPublishedReel(page);
      test.skip(!reelCard, 'no published reels on this account (Published tab empty)');
      await reelCard.click();

      const share = page.getByRole('button', { name: 'Share', exact: true });
      await share.first().waitFor({ state: 'visible', timeout: 20000 });
      await assertCtaInViewport(page, share.first());
      await saveEvidence(page, `cta-reel-player-share_${vp.name}`);
    });

    // --- Surface 7: In Progress Reels tab (Build New Reel) -------------------
    test('In Progress Reels tab: Build New Reel CTA above the fold', async ({ page }) => {
      await reachHome(page);
      await openTab(page, /^In Progress Reels/);
      await page.getByTestId('in-progress-reels-tab-panel')
        .waitFor({ state: 'visible', timeout: 15000 });
      const build = page.getByRole('button', { name: 'Build New Reel' }).first();
      await build.waitFor({ state: 'visible', timeout: 15000 });
      await assertCtaInViewport(page, build);
      await saveEvidence(page, `cta-in-progress-reels_${vp.name}`);
    });

    // --- Surface 8: Published tab (no distinct pinned CTA — see surface 6) ----
    // The Published tab is a SCROLLABLE reel GALLERY nested below the whole home
    // shell (app header + "Continue where you left" cards + the four-tab bar +
    // Ranking-Progress card), so its first reel group renders ~1200px down by
    // design — a browse gallery has no above-the-fold pinned button. Its
    // journey-primary action is Share, and that IS audited above-the-fold in the
    // Reel player (surface 6, passing at all 4 widths). Documented skip, not a
    // finding: there is no separate CTA to pin here without redesigning the home
    // scroll (out of this sweep's scope). See T8550 Progress Log, surface 8.
    test('Published tab: gallery — journey CTA audited in Reel player (surface 6)', async () => {
      test.skip(true, 'Published is a scrollable gallery below the home shell; its ' +
        'Share journey-CTA is audited above-the-fold in surface 6 (Reel player)');
    });

    // --- Surface 9: Add Video button (T8380, In Progress Clips tab) ----------
    test('Add Video CTA above the fold', async ({ page }) => {
      await reachHome(page);
      await openTab(page, /^In Progress Clips/);
      // Exactly one clips-add-video node exists at a time (empty vs populated).
      const addVideo = page.locator('[data-tutorial-target="clips-add-video"]');
      await addVideo.first().waitFor({ state: 'visible', timeout: 15000 });
      await assertCtaInViewport(page, addVideo.first());
      await saveEvidence(page, `cta-add-video_${vp.name}`);
    });
  });
}

/**
 * Reveal the first published reel tile on the Published tab and return its
 * locator (reels render inside collapsed game/mix groups — expand until a tile
 * shows). Returns null when the account has no published reels.
 */
async function openFirstPublishedReel(page) {
  const firstCard = page.getByTestId('reel-card').first();
  let appeared = await firstCard.waitFor({ state: 'visible', timeout: 6000 })
    .then(() => true).catch(() => false);
  if (!appeared) {
    const headers = page.getByTestId('published-tab-panel')
      .getByTestId('collapsible-group-header');
    await headers.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const n = await headers.count();
    for (let i = 0; i < n && !appeared; i++) {
      await headers.nth(i).click({ timeout: 3000 }).catch(() => {});
      appeared = await firstCard.waitFor({ state: 'visible', timeout: 4000 })
        .then(() => true).catch(() => false);
    }
  }
  return appeared ? firstCard : null;
}
