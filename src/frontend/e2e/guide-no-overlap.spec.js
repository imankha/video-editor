/**
 * T12800 layer 2: the guide never covers what its sentence names. Drives the reachable guide states at
 * four viewports (plus the landscape-phone cockpit) and asserts, per state:
 *   - no `[data-guide-overlap]` on the coach host (the FloatingCoach oracle: the final card position
 *     intersects no pulsing control and no keepClear rect), and
 *   - every visible `.coach-target-pulse` is topmost at its centre (elementFromPoint returns it or a
 *     descendant). With a dialog open, only the pulses inside that dialog are checked (the screen behind
 *     it is meant to be covered).
 * Each coach state is checked before and after "Got it".
 *
 * Covered: Home Games empty, Upload modal (choose), Clips empty, Finished empty; Home Games / Clips /
 * Finished with data; Annotate watch, watch.playing, editor, choice (Brilliant play), has-plays,
 * selected; Focus drag, play, keep/preview, generate; landscape cockpit; Overlay pick (when the
 * fixture draft has detections); Finished viewer; dialogs Buy credits and Edit game.
 * Not reached (reasons in the T12800 task file): upload.submit / upload.failed / games.uploading /
 * games.error, Focus video-error / fullscreen / trim / job states, Overlay job states and text, share
 * modal, Annotate expired / review / portrait steps, and the dialogs that need a payment, a share
 * recipient, a second profile or a file pick.
 *
 * Writes: Annotate marks one play and Focus creates one draft on the dev-fixture account; both are
 * deleted in `finally`. Branch CI does not run Playwright: run locally and record the output.
 *
 * Known account-load flakes (NOT the invariant this spec checks -- that's held clean, zero overlap/
 * buried findings, across every full run; these are noise from a shared, heavily-reused dev account):
 *   - Guidance is a profile-persisted setting (see .claude/knowledge/guidance.md). Every test that
 *     clicks through Home before its own `setGuidance(true)` forces it OFF first, and `setGuidance`
 *     confirms the toggle's `aria-checked` before returning -- but has been seen (once, unreproduced
 *     on a clean account) reverting moments later, which then surfaces downstream as "no guide
 *     showed". If this recurs, it is a `useSettingsStore` bootstrap-refetch-clobbers-optimistic-write
 *     race, not a placement bug -- root-cause that separately, not by patching this spec further.
 *   - Browser-context teardown can itself exceed the per-test budget under heavy concurrent load
 *     (observed once as "Tearing down 'context' exceeded the test timeout", with the test's own body
 *     already fully passed). Infra, not app code.
 *
 * Run: E2E_BASE_URL=http://localhost:<port> npx playwright test e2e/guide-no-overlap.spec.js --workers=1
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { createUnframedDraft, deleteClip } from './helpers/annotateClips.js';
import { openLoadableOverlayDraft, probeOverlayDrafts } from './helpers/overlayDraft.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh+devfixture@gmail.com';
const REAL_PROFILE = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const CROP_BOX = '[data-testid="focus-video-stage"] .cursor-move';
const VIEWPORTS = [[390, 844], [768, 1024], [1280, 800], [1579, 1103]];

/** The index.html #preloader covers the app until bootstrap finishes; nothing is checkable or clickable under it. */
async function appReady(page) {
  await page.locator('#preloader').waitFor({ state: 'detached', timeout: 60000 })
    .catch(() => { throw new Error('#preloader never cleared (bootstrap did not finish within 60s)'); });
}

async function setGuidance(page, on) {
  await appReady(page);
  const toggle = page.getByTestId('guidance-toggle').first();
  await toggle.waitFor({ timeout: 30000 });
  if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
  // The click's own save is async (GuidanceToggle.jsx); confirm it actually landed before
  // relying on it -- a later facts/bootstrap refresh can otherwise appear to revert it.
  await expect(toggle).toHaveAttribute('aria-checked', String(on), { timeout: 10000 });
}

/** The oracle + topmost check for whatever the guide shows right now. */
async function checkNow(page, label) {
  await appReady(page);
  // Wait for the guide to show (a visible coach, an inline dialog guide, or a pulse) so a check never passes vacuously.
  await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="floating-coach-host"]');
    return (host && host.style.visibility !== 'hidden' && host.textContent.trim())
      || document.querySelector('[data-testid="modal-guide"], [data-testid="upload-guide"]') || document.querySelector('.coach-target-pulse');
  }, null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500); // measure runs on rAF, scroll and resize; let it settle
  const r = await page.evaluate(() => {
    const visible = el => el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true;
    // A dialog's guide is inline (modal-guide / upload-guide); its fixed-position layer is the dialog. Only its pulses count.
    let layer = document.querySelector('[data-testid="modal-guide"], [data-testid="upload-guide"]');
    while (layer && getComputedStyle(layer).position !== 'fixed') layer = layer.parentElement;
    const dialogs = layer && visible(layer) ? [layer] : [];
    const scope = dialogs.length ? dialogs : [document];
    const host = document.querySelector('[data-testid="floating-coach-host"]');
    const pulses = scope.flatMap(s => [...s.querySelectorAll('.coach-target-pulse')]);
    const buried = pulses.filter(el => {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) return false;
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false; // off-screen: the scroll hint names it
      const top = document.elementFromPoint(x, y);
      return !(top && (top === el || el.contains(top)));
    }).map(el => {
      const b = el.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return `${el.dataset.testid || el.tagName.toLowerCase()} under ${top?.dataset?.testid || top?.closest('[data-testid]')?.dataset.testid || top?.tagName.toLowerCase()}`;
    });
    const coach = host && host.style.visibility !== 'hidden' && host.textContent.trim() ? host.textContent.trim().slice(0, 70) : null;
    const R = el => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)].join(','); };
    const geometry = host?.getAttribute('data-guide-overlap') ? {
      viewport: `${innerWidth}x${innerHeight}`, card: R(host.firstElementChild ?? host), host: R(host),
      covered: host.getAttribute('data-guide-overlap').split(',').map(n => `${n}=[${[...document.querySelectorAll(`[data-testid="${n}"]`)].map(R).join(' ')}]`),
      pulses: [...document.querySelectorAll('.coach-target-pulse')].map(el => `${el.dataset.testid || el.tagName}=${R(el)}`),
      band: [...document.querySelectorAll('[data-testid="action-band"], [data-guidance-band]')].map(R),
    } : null;
    const inlineGuide = document.querySelector('[data-testid="modal-guide"], [data-testid="upload-guide"]')?.textContent.trim().slice(0, 70) ?? null;
    return { overlap: host?.getAttribute('data-guide-overlap') ?? null, buried, pulses: pulses.length, coach: coach ?? inlineGuide, inlineGuide, dialog: dialogs.length > 0, geometry };
  });
  const vp = page.viewportSize();
  await page.screenshot({ path: `test-results/t12800-sweep/${vp.width}x${vp.height}/${label.replace(/[^a-z0-9.]+/gi, '-')}.png` });
  console.log(`[sweep] ${label} | coach: ${r.coach ?? '-'} | pulses: ${r.pulses}${r.dialog ? ' (in dialog)' : ''} | overlap: ${r.overlap ?? 'none'} | buried: ${r.buried.join(';') || 'none'}`);
  if (r.geometry) console.log(`[sweep] ${label} geometry ${JSON.stringify(r.geometry)}`);
  expect(r.overlap, `${label}: coach covers`).toBeNull();
  expect(r.buried, `${label}: pulsing controls not topmost`).toEqual([]);
  return r;
}

/** Check the state, press Got it if the coach offers it, and check again. A state with no guide at all fails. */
async function checkState(page, label) {
  const r = await checkNow(page, label);
  expect(r.coach || r.pulses || r.inlineGuide, `${label}: no guide showed (nothing was checked)`).toBeTruthy();
  const gotIt = page.getByTestId('floating-coach-host').getByRole('button', { name: 'Got it' });
  if (r.coach && await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    // The shade blocks everything outside its cutouts; wait for it to actually clear (acknowledge()
    // unmounts it synchronously, but a slow/loaded run can leave the DOM node around for a beat) so
    // a caller's next click right after checkState never lands on it instead of its real target.
    await page.getByTestId('guide-shade').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
    await checkNow(page, `${label} (after Got it)`);
  }
}

/** T13460: the Guidance switch must overlap no logo, icon, button, chip or banner in the top 120px of the page. */
async function expectSwitchClear(page, label) {
  await appReady(page);
  await page.getByTestId('guidance-toggle').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(500); // the layer re-pins every frame; let it settle
  const hits = await page.evaluate(() => {
    const toggle = document.querySelector('[data-testid="guidance-toggle"]');
    // T13770: a full-screen panel (data-covers-header) hides the switch; a hidden switch covers nothing.
    if (!(toggle.checkVisibility?.({ visibilityProperty: true }) ?? true)) return [];
    const t = toggle.getBoundingClientRect();
    const R = b => [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)].join(',');
    return [...document.querySelectorAll('button, a, img, svg, [role="status"], [data-testid*="logo"], [data-testid*="banner"]')]
      .filter(el => el !== toggle && !toggle.contains(el) && !el.contains(toggle) && !el.closest('[data-testid="guidance-toggle-layer"]'))
      .filter(el => el.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) ?? true)
      .map(el => [el, el.getBoundingClientRect()])
      .filter(([, b]) => b.width > 0 && b.height > 0 && b.top < 120 && b.left < t.right && b.right > t.left && b.top < t.bottom && b.bottom > t.top)
      .map(([el, b]) => `${el.dataset.testid || el.getAttribute('aria-label') || el.tagName.toLowerCase()}=${R(b)} vs switch=${R(t)}`);
  });
  expect(hits, `${label}: Guidance switch overlaps`).toEqual([]);
}

async function testLogin(page) {
  const userId = `t12800_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const headers = { 'Content-Type': 'application/json', 'X-User-ID': userId, 'X-Test-Mode': 'true' };
  await page.setExtraHTTPHeaders({ 'X-User-ID': userId, 'X-Test-Mode': 'true' });
  await page.goto('/');
  expect(await page.evaluate(async h => (await fetch('/api/auth/test-login', { method: 'POST', credentials: 'include', headers: h })).ok, headers)).toBe(true);
  await page.reload();
}

/** Read-only: empty every plays-like array of the loaded game so the watch step shows. */
async function routeZeroPlays(page) {
  await page.route('**/api/games/*/load', async route => {
    const res = await route.fetch();
    const body = await res.json();
    for (const key of Object.keys(body.game ?? {})) if (/clip|annot|region|play/i.test(key) && Array.isArray(body.game[key])) body.game[key] = [];
    await route.fulfill({ response: res, json: body });
  });
}

for (const [width, height] of VIEWPORTS) {
  test.describe(`${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('Home, empty account: Games, Upload modal, Clips, Finished', async ({ page }) => {
      test.setTimeout(120_000);
      await testLogin(page);
      await page.getByTestId('home-upload-game').waitFor({ timeout: 30000 });
      await setGuidance(page, true);
      await checkState(page, 'home games empty');
      await expectSwitchClear(page, 'home header');
      await page.getByTestId('home-upload-game').click();
      await page.getByTestId('upload-dropzone').waitFor({ timeout: 15000 });
      await checkState(page, 'upload modal choose');
      await page.keyboard.press('Escape');
      await page.getByTestId('upload-dropzone').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
      for (const tab of ['home-tab-clips', 'home-tab-published']) {
        await page.getByTestId(tab).click();
        await checkState(page, `home ${tab} empty`);
      }
    });

    test('Home, dev fixture: Games, Clips, Finished', async ({ context, page }) => {
      test.setTimeout(120_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      await page.goto('/');
      await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
      await setGuidance(page, true);
      // Games is already the default landing tab: don't re-click it. Clicking an already-active,
      // already-fully-visible tab button is a known, UNRELATED quirk here (it reproduces with
      // Guidance fully OFF, no coach, no pulse anywhere) -- the page scrolls ~370px, which then
      // parks whatever sits at that offset under the fixed header cluster. Real navigation
      // (switching tabs) never triggers it; only redundantly re-clicking the active one does.
      await checkState(page, 'home games (fixture)');
      for (const tab of ['home-tab-clips', 'home-tab-published']) {
        await page.getByTestId(tab).click();
        await checkState(page, `home ${tab} (fixture)`);
      }
    });

    test('Annotate, zero plays: watch, playing, editor, choice, has-plays, selected', async ({ context, page }) => {
      test.setTimeout(240_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      await routeZeroPlays(page);
      let rawClipId = null;
      try {
        await openGameInAnnotate(page, GAME_ID);
        await page.getByTestId('annotate-mark-play-button').waitFor({ timeout: 60000 });
        await setGuidance(page, true);
        await checkState(page, 'annotate watch');
        await expectSwitchClear(page, 'annotate header');
        await page.getByTestId('annotate-play-button').click();
        await page.waitForTimeout(800);
        await checkState(page, 'annotate watch.playing');
        // Mark play WRITES a play to the fixture game (the route only fakes the load); deleted in finally.
        const saved = page.waitForResponse(res => /\/clips\/raw\/save/.test(res.url()) && res.request().method() === 'POST', { timeout: 30000 });
        await page.getByTestId('annotate-mark-play-button').click();
        rawClipId = (await (await saved).json()).raw_clip_id;
        await page.getByTestId('play-editor-done').waitFor({ timeout: 20000 });
        await checkState(page, 'annotate editor');
        // Brilliant + Done opens the highlight choice (Generate now / later) for a 5-star play.
        await page.getByTestId('rating-input').getByText('Brilliant', { exact: true }).click();
        await page.getByTestId('play-editor-done').click();
        const choice = await page.getByTestId('highlight-choice-now').waitFor({ timeout: 8000 }).then(() => true, () => false);
        if (choice) await checkState(page, 'annotate choice');
        else console.log('[sweep] annotate choice: not shown after Brilliant + Done');
        if (choice) await page.getByTestId('highlight-choice-close').click();
        await checkState(page, 'annotate after Done (has-plays.one / selected)');
        // The play list is a side panel on desktop; on phone and tablet it is not on screen here.
        const row = page.getByTestId('clip-row').first();
        if (await row.isVisible().catch(() => false)) {
          await row.click();
          await checkState(page, 'annotate selected');
        } else console.log('[sweep] annotate selected: play list not on screen at this viewport (not reachable here)');
      } finally {
        await deleteClip(context, rawClipId);
      }
    });

    test('Annotate, fixture game with plays: has-plays.many, selected', async ({ context, page }) => {
      test.setTimeout(180_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      await openGameInAnnotate(page, GAME_ID);
      await page.getByTestId('annotate-mark-play-button').waitFor({ timeout: 60000 });
      await setGuidance(page, true);
      await checkState(page, 'annotate has-plays.many');
      // T13570: the shade leaves the screen's other main buttons (Review plays, Share plays) reachable: each sits inside a cutout.
      for (const id of ['annotate-review-plays', 'annotate-share-plays-action']) {
        const box = await page.getByTestId(id).boundingBox();
        const cuts = JSON.parse(await page.getByTestId('guide-shade').getAttribute('data-cutouts'));
        const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
        expect(cuts.some(c => cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom), `${id} is inside a shade cutout`).toBe(true);
      }
      // T13770: at phone widths the Plays drawer and its Play details sheet are full-screen panels with a
      // close X at the top right, where the Guidance switch sits: the switch must not cover any control
      // and the marker tooltip must not draw over the panel.
      const drawerBtn = page.getByTitle('Show plays');
      if (await drawerBtn.isVisible().catch(() => false)) {
        await drawerBtn.click();
        const drawer = page.getByTestId('annotate-plays-drawer');
        await drawer.waitFor({ timeout: 15000 });
        await expectSwitchClear(page, 'plays drawer open');
        await expect(page.getByTestId('annotate-plays-drawer-close')).toBeVisible();
        const info = drawer.getByTitle('View details').first();
        await expect(info, 'the fixture game has a play with a View details button').toBeVisible();
        await info.click();
        await expectSwitchClear(page, 'play details sheet open');
        await expect(page.getByTestId('clip-marker-tooltip')).toBeHidden();
        await page.getByTestId('annotate-plays-drawer-close').click();
        await drawer.waitFor({ state: 'detached', timeout: 10000 });
        await expectSwitchClear(page, 'plays drawer closed');
      }
      const row = page.getByTestId('clip-row').first();
      if (await row.isVisible().catch(() => false)) {
        await row.click();
        await checkState(page, 'annotate selected (fixture play)');
      } else console.log('[sweep] annotate selected (fixture): play list not on screen at this viewport (not reachable here)');
    });

    test('Focus: drag, play, keep / preview, generate', async ({ context, page }) => {
      test.setTimeout(240_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE });
      try {
        await page.goto('/');
        await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
        // Guidance is a PROFILE-persisted setting (not per-session): a prior run can leave it ON for
        // this shared dev-fixture account, and Home's shade then blocks whatever it doesn't cut out --
        // including these setup clicks, which hung the test for its full 240s (T12800 finding). Force
        // it to a known OFF state before any click, then turn it on once we're in Focus for the checks.
        await setGuidance(page, false);
        await page.getByTestId('home-tab-clips').click();
        await page.getByText(name.slice(0, 18), { exact: false }).first().click();
        await page.locator(CROP_BOX).first().waitFor({ timeout: 90000 });
        await setGuidance(page, true);
        await checkState(page, 'focus drag');
        const b = await page.locator(CROP_BOX).first().boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2 + 10, { steps: 6 });
        await page.mouse.up();
        await checkState(page, 'focus play');
        await page.getByTestId('play-button').first().click();
        await page.waitForTimeout(5000); // the draft is ~3s: play it through
        await checkState(page, 'focus after play-through (keep / preview)');
        const preview = page.getByTestId('framing-preview-toggle');
        if (await preview.isVisible().catch(() => false)) {
          await preview.click();
          await page.waitForTimeout(5000);
          await checkState(page, 'focus after preview (generate)');
        }
      } finally {
        await deleteClip(context, rawClipId);
      }
    });

    test('Overlay: pick walk', async ({ context, page }) => {
      test.setTimeout(240_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      // Same guard as the Focus test: openLoadableOverlayDraft clicks through Home internally, and a
      // profile-persisted Guidance=ON would let the shade block those clicks. Force it off first via a
      // throwaway Home visit (the helper's own page.goto('/') below re-navigates, guidance stays OFF).
      await page.goto('/');
      await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
      await setGuidance(page, false);
      const opened = await openLoadableOverlayDraft(page);
      test.skip(!opened.ok, opened.reason);
      await setGuidance(page, true);
      await page.getByTestId('floating-coach-host').waitFor({ state: 'attached', timeout: 30000 }).catch(() => {});
      await checkState(page, 'overlay pick');
    });

    test('Finished viewer', async ({ page }) => {
      test.setTimeout(120_000);
      await testLogin(page);
      await setGuidance(page, true);
      // Only the network boundary is mocked (stream/poster); the viewer is the real DraftReelPreview (as in T12730).
      await page.route('**/api/downloads/*/stream**', route => route.fulfill({ status: 200, contentType: 'video/mp4', body: Buffer.from([]) }));
      await page.route('**/api/downloads/*/poster.jpg**', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) }));
      await page.evaluate(async () => {
        const { openFinishedReel } = await import('/src/utils/finishedReelNav.js');
        openFinishedReel(
          { id: 42, final_video_id: 912760, name: 'Brilliant Dribble', aspect_ratio: '9:16', clip_count: 1, game_names: ['Lakers'], clip_game_start_time: 750, game_ids: [55] },
          { alreadyPublished: true },
        );
      });
      await page.getByTestId('finished-get-link').waitFor({ timeout: 20000 });
      await checkState(page, 'finished viewer');
    });

    test('Dialogs: Buy credits, Edit game', async ({ context, page }) => {
      test.setTimeout(120_000);
      await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
      await page.goto('/');
      await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
      await setGuidance(page, true);
      // Games is already the default landing tab: don't re-click it (see the comment above).
      // The focused coach shades everything but its cutouts until Got it (T12580): acknowledge it first.
      await checkState(page, 'home games before dialogs');
      await page.locator('button[title$="click to buy more"]').first().click();
      await page.getByTestId('modal-guide').waitFor({ timeout: 15000 });
      await checkState(page, 'dialog buy-credits');
      await page.keyboard.press('Escape');
      await page.getByTestId('modal-guide').waitFor({ state: 'detached', timeout: 15000 });
      // The game tile itself is role="button" and its accessible name gathers up nested
      // controls' labels (an ARIA anti-pattern), so a name-based "Edit game" locator matches
      // the WHOLE TILE before the pencil -- .first() landed on the tile and opened Annotate
      // instead. [data-game-edit] on the pencil (GameTile.jsx) is unambiguous.
      await page.locator('[data-game-edit]').first().click();
      await page.getByTestId('modal-guide').waitFor({ timeout: 15000 });
      await checkState(page, 'dialog edit-game');
      await page.keyboard.press('Escape');
    });
  });
}

/**
 * T13570 B, C, E: the card sits beside what it names without covering it, and the named control is lit.
 * Each geometry check reads live rects: `coach` is the card, `cuts` the shade's cutouts.
 */
const FOCUS_GAME_ID = Number(process.env.E2E_FOCUS_GAME_ID || 32);
const overlaps = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** Clipped to the viewport: a stage that runs under the fold only counts where it is on screen. */
async function rectOf(page, selector) {
  return page.evaluate(sel => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const r = { left: Math.max(0, b.left), top: Math.max(0, b.top), right: Math.min(innerWidth, b.right), bottom: Math.min(innerHeight, b.bottom) };
    return r.right > r.left && r.bottom > r.top ? r : null;
  }, selector);
}
const coachCard = page => rectOf(page, '[data-testid="floating-coach-host"]:not([style*="hidden"]) > *');
async function expectLit(page, selector, label) {
  const r = await rectOf(page, selector);
  expect(r, `${label}: ${selector} is on screen`).not.toBeNull();
  const cuts = JSON.parse(await page.getByTestId('guide-shade').getAttribute('data-cutouts'));
  const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
  expect(cuts.some(c => cx >= c.left && cx <= c.right && cy >= c.top && cy <= c.bottom), `${label}: ${selector} sits inside a shade cutout`).toBe(true);
}
async function expectNotCovered(page, selector, label) {
  const card = await coachCard(page);
  const r = await rectOf(page, selector);
  console.log(`[t13570] ${label}: card=${JSON.stringify(card)} ${selector}=${JSON.stringify(r)}`);
  expect(card, `${label}: the coach card is showing`).not.toBeNull();
  expect(overlaps(card, r), `${label}: card covers ${selector}`).toBe(false);
}

test.describe('T13570 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('B: Home Games card stays off Upload game and the game tile, both lit', async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
    await setGuidance(page, true);
    await page.getByTestId('floating-coach-host').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const tile = '.coach-target-pulse[data-testid="home-first-game"]';
    await expectNotCovered(page, '[data-testid="home-upload-game"]', 'B card');
    await expectNotCovered(page, tile, 'B card');
    await expectLit(page, '[data-testid="home-upload-game"]', 'B');
    await expectLit(page, tile, 'B');
    await page.screenshot({ path: 'test-results/t13570/B-card-390.png' });
  });

  test('B2: the Highlight-ready card stays off the game tile, Upload game and the coach card', async ({ context, page }) => {
    test.setTimeout(120_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    await page.goto('/');
    await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
    await setGuidance(page, true);
    await page.getByTestId('floating-coach-host').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const tile = '.coach-target-pulse[data-testid="home-first-game"]';
    // The recovered-export card (FocusCompletionRecovery) is what a reload after a finished Focus export shows.
    await page.evaluate(async () => {
      const { useFocusCompletionStore } = await import('/src/stores/focusCompletionStore.js');
      useFocusCompletionStore.getState().noteRecovered({ jobId: 't13570-probe', projectId: -1, projectName: 'QA Portrait Spotlight' });
    });
    await page.getByTestId('focus-completion-recovery').waitFor({ timeout: 5000 });
    await page.waitForTimeout(500);
    const toast = await rectOf(page, '[data-testid="focus-completion-recovery"] > div');
    console.log(`[t13570] B toast=${JSON.stringify(toast)} tile=${JSON.stringify(await rectOf(page, tile))} card=${JSON.stringify(await coachCard(page))}`);
    expect(overlaps(toast, await rectOf(page, tile)), 'B: Highlight ready card covers the game tile').toBe(false);
    expect(overlaps(toast, await rectOf(page, '[data-testid="home-upload-game"]')), 'B: Highlight ready card covers Upload game').toBe(false);
    expect(overlaps(toast, await coachCard(page)), 'B: Highlight ready card covers the coach card').toBe(false);
    await expectLit(page, '[data-testid="focus-completion-recovery"] > div', 'B toast (View/Dismiss reachable)');
    await page.screenshot({ path: 'test-results/t13570/B2-toast-390.png' });
    await page.evaluate(async () => {
      const { useFocusCompletionStore } = await import('/src/stores/focusCompletionStore.js');
      useFocusCompletionStore.getState().clearRecovered();
    });
  });

  test('C: Frame preview card stays off the preview video', async ({ context, page }) => {
    test.setTimeout(240_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE, gameId: FOCUS_GAME_ID });
    try {
      await page.goto('/');
      await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
      await setGuidance(page, false);
      await page.getByTestId('home-tab-clips').click();
      await page.getByText(name.slice(0, 18), { exact: false }).first().click();
      await page.locator(CROP_BOX).first().waitFor({ timeout: 90000 });
      await setGuidance(page, true);
      const b = await page.locator(CROP_BOX).first().boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 25, b.y + b.height / 2 + 10, { steps: 6 });
      await page.mouse.up();
      // The shade can sit over these controls mid-walk; dispatch the click itself (the guide is not under test here).
      await page.getByTestId('play-button').first().dispatchEvent('click');
      await page.waitForTimeout(5000);
      await page.getByTestId('framing-preview-toggle').dispatchEvent('click');
      await expect(page.getByTestId('framing-guide-text')).toContainText('Watch it through', { timeout: 10000 });
      await page.waitForTimeout(800);
      await expectNotCovered(page, '[data-testid="focus-video-stage"]', 'C card');
      await expectNotCovered(page, '[data-testid="framing-preview-toggle"]', 'C card');
      await expectLit(page, '[data-testid="framing-preview-toggle"]', 'C');
      expect(await page.getByTestId('floating-coach-host').getAttribute('data-guide-overlap'), 'C: oracle').toBeNull();
      await page.screenshot({ path: 'test-results/t13570/C-390.png' });
    } finally {
      await deleteClip(context, rawClipId);
    }
  });
});

test.describe('T13570 1440x900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('E: spotlight pick card stays off the video, and "My athlete isn\'t outlined" keeps a coach on screen', async ({ context, page }) => {
    test.setTimeout(240_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    // Read-only: drop the saved picks from the loaded overlay data so the walk parks on moment 1 (nothing is written back).
    await page.route('**/api/export/projects/*/overlay-data', async route => {
      const res = await route.fetch();
      await route.fulfill({ response: res, body: (await res.text()).replace(/"fromDetection":\s*true/g, '"fromDetection":false') });
    });
    await page.goto('/');
    await page.getByTestId('home-tab-games').waitFor({ timeout: 30000 });
    await setGuidance(page, false);
    const { loadable } = await probeOverlayDrafts(page);
    let parkedOn = null;
    for (const id of loadable) {
      await page.goto('/');
      await page.getByTestId('home-tab-clips').click();
      const card = page.locator('[data-testid="project-card"]').filter({ has: page.locator(`img[src*="/projects/${id}/poster"]`) }).first();
      if (!(await card.count())) continue;
      await card.scrollIntoViewIfNeeded();
      await card.click();
      if (!(await page.getByTestId('overlay-video-stage').first().waitFor({ timeout: 30000 }).then(() => true, () => false))) continue;
      await setGuidance(page, true);
      await page.waitForTimeout(4000);
      const gid = await page.evaluate(() => document.querySelector('[data-testid="spotlight-pick-guide"]')?.dataset.guideId);
      console.log(`[t13570] E draft ${id}: ${gid}`);
      if (gid === 'overlay.pick.first' || gid === 'overlay.pick.at-marker') { parkedOn = id; break; }
      await setGuidance(page, false);
    }
    test.skip(!parkedOn, `no streamable draft with detection markers parks the pick walk (tried ${loadable.join(', ')})`);
    await expectNotCovered(page, '[data-testid="overlay-video-stage"]', 'E moment 1');
    await expectLit(page, '[data-testid="overlay-video-stage"]', 'E moment 1');
    await page.getByTestId('pick-guide-not-boxed').dispatchEvent('click');
    await page.waitForTimeout(1500);
    await expect(page.getByTestId('spotlight-pick-guide'), 'E: coach still shows after "My athlete isn\'t outlined"').toBeVisible();
    await expect(page.getByTestId('spotlight-pick-guide')).toHaveAttribute('data-guide-id', 'overlay.pick.not-outlined');
    await expect(page.getByTestId('floating-coach-host')).toContainText('Drag the circle');
    await expectNotCovered(page, '[data-testid="overlay-video-stage"]', 'E not outlined');
    await expectLit(page, '[data-testid="overlay-video-stage"]', 'E not outlined');
    await page.screenshot({ path: 'test-results/t13570/E-1440.png' });
    await page.getByTestId('pick-guide-not-boxed').dispatchEvent('click');
  });
});

test.describe('844x390 landscape phone (cockpit)', () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true });

  test('Focus cockpit: drag, preview', async ({ context, page }) => {
    test.setTimeout(240_000);
    await loginAsRealUser(context, REAL_EMAIL, REAL_PROFILE);
    const { rawClipId, name } = await createUnframedDraft(context, { profileId: REAL_PROFILE });
    try {
      await page.goto('/');
      await page.getByTestId('home-tab-clips').click();
      await page.getByText(name.slice(0, 18), { exact: false }).first().click();
      await page.locator('.crop-handle').first().waitFor({ timeout: 90000 });
      // The cockpit's one-time intro card ("More room in landscape") is not the guide; dismiss it first.
      const intro = page.getByTestId('cockpit-intro-confirm');
      if (await intro.isVisible().catch(() => false)) await intro.click();
      await setGuidance(page, true);
      await checkState(page, 'cockpit drag');
      const b = await page.locator('.cursor-move').first().boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 20, b.y + b.height / 2 + 5, { steps: 6 });
      await page.mouse.up();
      await checkState(page, 'cockpit after drag (preview)');
    } finally {
      await deleteClip(context, rawClipId);
    }
  });
});
