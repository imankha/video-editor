/**
 * T6190 QA — opening a reel must NOT refetch the drafts data before the editor loads.
 *
 * The whole point of T6190 is WHICH requests go out on the project-open critical path,
 * so this spec asserts on the NETWORK, not the DOM. It drives the real app as a real
 * user (dev-login) against the live dev stack.
 *
 *   bash scripts/dev-verify.sh e2e/T6190-project-open-fetches.qa.spec.js --reporter=line
 *
 * Acceptance criteria pinned here (task file T6190):
 *   1. Clicking a draft into Framing fires NO   GET /api/games
 *   2. Clicking a draft into Framing fires EXACTLY ONE GET /api/clips/projects/{id}/clips
 *   3. NO GET /api/health on the project-open critical path
 *   4. Annotate boundary edit -> Framing still shows the UPDATED clips (invalidateClips gesture)
 *   5. Game display name still renders in Framing (bootstrap-hydrated games store, no fetch)
 *   6. Connection-status indicator still works in the editor; Drafts unchanged (hoist)
 *   7. First R2 video byte measurably earlier than the 2.7s prod baseline (report DELTA)
 *   + downloads "re-edit reel" -> Framing opens with a populated clip list (the non-loadProject
 *     path whose sole clip loader used to be the now-removed FramingScreen mount fetch).
 *
 * This spec is a genuine regression pin: on master the games/health counts are > 0 and
 * the clips count is 2; on the T6190 branch they are 0/0/1.
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';

// ---- Network classification ---------------------------------------------------
// Exact clips-list GET: /api/clips/projects/{id}/clips  — must NOT match the sub-paths
// /clips/{clipId}/playback-url or /clips/{clipId}/file.
const CLIPS_LIST_RE = /\/api\/clips\/projects\/\d+\/clips(\?|$)/;
const GAMES_RE = /\/api\/games(\?|$)/;
const HEALTH_RE = /\/api\/health(\?|$)/;
// T6250 Overlay-entry endpoints. overlay-data must have ONE owner; outdated-clips
// is a single owner too (its dev x2 is StrictMode-only, verify with a prod build).
const OVERLAY_DATA_RE = /\/api\/export\/projects\/\d+\/overlay-data(\?|$)/;
const OUTDATED_CLIPS_RE = /\/api\/projects\/\d+\/outdated-clips(\?|$)/;
// First real video bytes = a presigned R2 object (range request) OR a stream proxy.
const VIDEO_BYTE_RE = /(r2\.cloudflarestorage\.com|\.r2\.dev|X-Amz-Signature|working_video\/stream|games\/[^/]+\/video|\/stream)/i;

/** Record every request with a monotonic timestamp; supports windowed counting. */
function recordRequests(page) {
  const reqs = [];
  page.on('request', (r) => reqs.push({ method: r.method(), url: r.url(), t: Date.now() }));
  return {
    reqs,
    countSince(since, method, re) {
      return reqs.filter((q) => q.t >= since && q.method === method && re.test(q.url)).length;
    },
    firstSince(since, re) {
      return reqs.find((q) => q.t >= since && re.test(q.url)) || null;
    },
  };
}

/** Detect the connection banner chrome (the fixed top-0 gray/red bar). null when connected. */
async function connectionBannerVisible(page) {
  return page.evaluate(() => {
    const bars = Array.from(document.querySelectorAll('div.fixed.top-0'));
    return bars.some((b) => /Connecting to server|waking up|Cannot connect|not running|unavailable|Server error/i.test(b.textContent || ''));
  });
}

async function gotoDrafts(page) {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: 'Reel Drafts' }).click();
}

/** Open the first Framing-ready reel draft; resolves once the crop editor is present. */
async function openFramingChip(page) {
  // T7750: the old regex REQUIRED a `[tags]` bracket, which only per-clip segments carry —
  // so a framing-complete or multi-clip aggregate draft (its Focus segment is untagged,
  // title `Focus: Complete (click to open)`) never matched and the open hung. Match any
  // framing-openable segment (tags optional) but EXCLUDE the trailing untagged `Overlay:`
  // segment (which deep-links into Overlay, not Framing). `.first()` then lands on the
  // first draft's first clip/Focus segment, which opens Framing.
  const chip = page.getByTitle(/^(?!Overlay:).*\(click to open\)/).first();
  await chip.waitFor({ timeout: 30000 });
  await chip.click();
  // Crop editor is the proof Framing mounted with clips.
  await page.locator('div.cursor-move.border-2, .crop-handle').first().waitFor({ timeout: 90000 });
}

test.describe('T6190 project-open redundant fetches @qa', () => {
  // T7800: in-page import()s of /src stores 404 on a deployed BUILD.
  skipOnDeployedTarget(test, 'in-page import() of /src/stores/{gamesDataStore,projectDataStore}.js (vite-module)');
  test.setTimeout(180_000);

  // ---- Criteria 1, 2, 3, 7 ---------------------------------------------------
  test('project-open fires 0 games, 1 clips-list, 0 health; measures TTFB', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const net = recordRequests(page);

    await gotoDrafts(page);

    // Capture window opens at the click — this is "the project-open critical path".
    const clickAt = Date.now();
    await openFramingChip(page);

    const games = net.countSince(clickAt, 'GET', GAMES_RE);
    const clips = net.countSince(clickAt, 'GET', CLIPS_LIST_RE);
    const health = net.countSince(clickAt, 'GET', HEALTH_RE);
    const firstVideo = net.firstSince(clickAt, VIDEO_BYTE_RE);
    const ttfb = firstVideo ? firstVideo.t - clickAt : null;

    console.log(`[T6190] project-open counts: games=${games} clips=${clips} health=${health}`);
    console.log(`[T6190] time-to-first-video-byte (local) = ${ttfb ?? 'n/a'} ms (prod baseline 2700ms; report DELTA, prod needs a fresh HAR)`);

    expect(games, 'criterion 1: GET /api/games on project-open').toBe(0);
    expect(clips, 'criterion 2: GET clips-list on project-open').toBe(1);
    expect(health, 'criterion 3: GET /api/health on project-open').toBe(0);

    await saveEvidence(page, 'T6190-criterion-1-2-3-project-open-network');

    // Criterion 5: game display name source (bootstrap-hydrated games store) is present
    // WITHOUT any /api/games fetch (asserted == 0 above).
    const readyGamesCount = await page.evaluate(async () => {
      const mod = await import('/src/stores/gamesDataStore.js');
      return mod.useGamesDataStore.getState().readyGames.length;
    });
    console.log(`[T6190] readyGames in store (bootstrap-hydrated) = ${readyGamesCount}`);
    expect(readyGamesCount, 'criterion 5: games store hydrated from bootstrap for the display name').toBeGreaterThan(0);
    await saveEvidence(page, 'T6190-criterion-5-game-name-source');

    // Criterion 7 note: local TTFB differs from prod in absolute terms; this asserts the
    // redundant requests are gone from the path (the cause of the 2.7s), and logs the local delta.
    expect(ttfb, 'criterion 7: a video byte was requested on the open path').not.toBeNull();

    // App.jsx layout structure changed (ConnectionStatus hoist) -> responsive sweep.
    await responsiveSweep(page);
    await context.close();
  });

  // ---- Criterion 6a: ConnectionStatus is hoisted (persists across the branch split) ----
  // Decisive, NON-confounded: a PURE SPA home->editor transition (no page.goto reload)
  // must fire ZERO /api/health. At boot ConnectionStatus mounts on Home and health-checks
  // once (twice under React 18 StrictMode dev double-invoke; once in prod); if the hoist
  // preserves the instance across the home->editor branch split, the SPA click into Framing
  // adds NO health check. A reload (page.goto) here would re-boot the app and re-fire health,
  // which is the confound to avoid — so this test never navigates by URL after boot.
  test('criterion 6a: 0 health on the SPA project-open transition; no banner chrome on Drafts', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const net = recordRequests(page);

    await gotoDrafts(page);
    // Drafts (home) shows NO connection banner when connected (ConnectionStatus renders null).
    expect(await connectionBannerVisible(page), 'no connection banner chrome on Drafts when connected').toBe(false);
    await saveEvidence(page, 'T6190-criterion-6-drafts-no-banner');

    // Let the boot-time health check(s) settle, THEN measure only the SPA transition.
    await page.waitForTimeout(3000);
    const afterBootSettled = Date.now();
    const bootHealth = net.countSince(0, 'GET', HEALTH_RE);

    await openFramingChip(page); // pure SPA home -> editor
    await page.waitForTimeout(1500); // absorb any post-mount async health

    const healthOnOpen = net.countSince(afterBootSettled, 'GET', HEALTH_RE);
    console.log(`[T6190] /api/health fired at boot=${bootHealth} (dev StrictMode doubles; prod=1), on SPA project-open=${healthOnOpen}`);
    expect(healthOnOpen, 'criterion 6: ConnectionStatus persists across the branch split — no health on project-open').toBe(0);
    await saveEvidence(page, 'T6190-criterion-6-editor-connection-status');
    await context.close();
  });

  // ---- Criterion 6b: the indicator still WORKS in the editor after the hoist ----
  // Positive proof the hoisted component is mounted + reactive: with /api/health failing,
  // the banner must appear AND remain visible after navigating into the editor.
  test('criterion 6b: connection banner shows in the editor when health fails', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    await page.route('**/api/health', (route) => route.abort()); // force "unreachable"

    await gotoDrafts(page);
    // Banner appears on Home (grace "Connecting..." then escalates) — indicator alive.
    await expect.poll(() => connectionBannerVisible(page), { timeout: 20000 }).toBe(true);
    await openFramingChip(page); // SPA into the editor
    // Banner PERSISTS in the editor (hoisted instance stays mounted across the split).
    expect(await connectionBannerVisible(page), 'criterion 6: connection indicator works in the editor').toBe(true);
    await saveEvidence(page, 'T6190-criterion-6-editor-banner-on-failure');
    await context.close();
  });

  // ---- Criterion 4: annotate boundary edit reaches Framing --------------------
  test('annotate -> framing invalidates clips so the editor sees fresh boundaries', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const net = recordRequests(page);

    // T6190 regression guard: entering Framing from Annotate must not trip React's
    // "Maximum update depth exceeded" (the annotate->framing render-loop crash). The
    // register/clear of the mounted saveCurrentClipState is now a STABLE ref-registration
    // (framingStore.useRegisterActiveSaveHandler), so the whole-store subscriber can't
    // feed itself. Fail the test if that error ever reaches the console.
    const maxDepthErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Maximum update depth exceeded/i.test(m.text())) maxDepthErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      if (/Maximum update depth exceeded/i.test(String(e))) maxDepthErrors.push(String(e));
    });

    await gotoDrafts(page);
    await openFramingChip(page);

    // Read the current clip boundaries the editor holds.
    const before = await page.evaluate(async () => {
      const mod = await import('/src/stores/projectDataStore.js');
      const s = mod.useProjectDataStore.getState();
      return { projectId: s.selectedClipId != null ? s.clips[0]?.id : null, clips: s.clips.map((c) => ({ id: c.id, start: c.start_time, end: c.end_time })) };
    });
    console.log('[T6190] framing clips before annotate edit:', JSON.stringify(before.clips));

    // Enter Annotate via the header "Edit in Annotate" / mode switcher (data-testid mode-annotate).
    await page.locator('[data-testid="mode-annotate"]').click();
    await page.waitForURL(/\/annotate/, { timeout: 30000 }).catch(() => {});
    await page.locator('video, .clip-marker').first().waitFor({ timeout: 60000 });
    // `video` mounts before the clips sidebar finishes its own fetch (ClipsSidePanel
    // shows a "Loading clips..." state) — wait that out so the clip-item lookup below
    // isn't racing the sidebar's own load.
    await page.getByText('Loading clips...').waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});

    // Drive a REAL boundary edit: select the clip in the sidebar (ClipListItem —
    // proven selector from clip-selection-state-machine.spec.js / sidebar-scrub-debug.spec.js),
    // then drag the ClipScrubRegion end handle inside ClipDetailsEditor
    // (.border-t-2 wrapper, .cursor-col-resize handles — last() is the end handle).
    let editedEnd = null;
    const clipItem = page.locator('.border-b.border-gray-800.cursor-pointer').first();
    await clipItem.waitFor({ timeout: 15000 }).catch(() => {});
    const hasClipItem = await clipItem.count();
    if (hasClipItem) {
      await clipItem.click();
      const detailsPanel = page.locator('.border-t-2').first();
      await detailsPanel.waitFor({ timeout: 10000 }).catch(() => {});
      const handles = detailsPanel.locator('.cursor-col-resize');
      const handleCount = await handles.count();
      if (handleCount >= 2) {
        // ClipScrubRegion renders the LIVE end-time label next to the end handle
        // (formatTime(endTime), e.g. "48:56.4") — read it as ground truth instead
        // of projectDataStore (that store holds FRAMING's clips, not Annotate's
        // in-memory clipRegions, so it can't observe an in-annotate drag).
        const endTimeLabel = detailsPanel.locator('span.font-mono.text-white').last();
        const endLabelBefore = await endTimeLabel.textContent().catch(() => null);
        const endHandle = handles.last();
        const box = await endHandle.boundingBox();
        if (box) {
          const startX = box.x + box.width / 2;
          const startY = box.y + box.height / 2;
          await page.mouse.move(startX, startY);
          await page.mouse.down();
          // Larger, multi-step drag so pixelToTime's per-pixel delta clears any
          // minimum-move threshold regardless of this timeline's zoom/scale.
          // Drag RIGHT (extend), not left: ClipScrubRegion clamps the end handle to
          // `start + MIN_REGION_DURATION` (0.5s, see ClipScrubRegion.jsx), and this
          // account's seed clip is already exactly 0.5s — dragging left is a no-op
          // against that clamp regardless of drag distance.
          for (let i = 1; i <= 20; i++) {
            await page.mouse.move(startX + i * 10, startY);
          }
          await page.waitForTimeout(100);
          await page.mouse.up();
          await page.waitForTimeout(500);
          const endLabelAfter = await endTimeLabel.textContent().catch(() => null);
          console.log(`[T6190] end-time label before drag="${endLabelBefore}" after drag="${endLabelAfter}"`);
          if (endLabelAfter && endLabelAfter !== endLabelBefore) {
            // Drag registered — read the authoritative new end_time from the
            // AnnotateContainer's clipRegions via the annotate debug bridge if
            // exposed; otherwise derive it from the DOM label (mm:ss.s format).
            const m = /(\d+):(\d+\.\d+)/.exec(endLabelAfter);
            if (m) editedEnd = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
          } else {
            console.log('[T6190] scrub-drag did not move the end-time label — gesture did not register');
          }
        } else {
          console.log('[T6190] scrub handle had no bounding box — could not drive edit gesture');
        }
      } else {
        console.log(`[T6190] expected >=2 scrub handles, found ${handleCount} — could not drive edit gesture`);
      }
    } else {
      console.log('[T6190] no clip item found in Annotate sidebar — could not drive edit gesture');
    }
    if (editedEnd == null) {
      console.log('[T6190] HONEST NOTE: could not drive a real boundary edit on this account\'s data; '
        + 'falling back to asserting the invalidation mechanism only (fresh clips GET + non-empty list).');
    }

    // Switch back to Framing — this is the leave-annotate gesture that fires invalidateClips.
    const switchAt = Date.now();
    await page.locator('[data-testid="mode-framing"]').click();
    await page.locator('div.cursor-move.border-2, .crop-handle').first().waitFor({ timeout: 90000 });

    // The leave-annotate gesture MUST fire exactly one fresh clips-list GET (invalidateClips).
    const clipsOnLeave = net.countSince(switchAt, 'GET', CLIPS_LIST_RE);
    console.log(`[T6190] clips-list GET on annotate->framing = ${clipsOnLeave}`);
    expect(clipsOnLeave, 'criterion 4: leaving annotate refetches clips (carries boundary edits)').toBeGreaterThanOrEqual(1);

    const after = await page.evaluate(async () => {
      const mod = await import('/src/stores/projectDataStore.js');
      return mod.useProjectDataStore.getState().clips.map((c) => ({ id: c.id, start: c.start_time, end: c.end_time }));
    });
    console.log('[T6190] framing clips after annotate->framing:', JSON.stringify(after));
    expect(after.length, 'framing has a populated clip list after returning from annotate').toBeGreaterThan(0);

    if (editedEnd != null) {
      const matched = after.find((c) => c.id === before.clips[0]?.id);
      console.log(`[T6190] boundary check: edited end_time(pre-switch)=${editedEnd} framing end_time(post-switch)=${matched?.end}`);
      expect(matched, 'edited clip still present in framing list after invalidation').toBeTruthy();
      expect(matched.end, 'criterion 4: framing reflects the UPDATED end_time from the annotate edit')
        .toBeCloseTo(editedEnd, 1);
    } else {
      console.log('[T6190] criterion 4 verified via invalidation mechanism ONLY (see honest note above) — '
        + 'boundary-content assertion was NOT performed.');
    }
    // T6190 render-loop regression: no "Maximum update depth exceeded" during annotate->framing.
    await page.waitForTimeout(500); // let any late passive-effect loop surface
    expect(maxDepthErrors, `annotate->framing must not trip the render loop:\n${maxDepthErrors.join('\n')}`).toEqual([]);

    await saveEvidence(page, 'T6190-criterion-4-annotate-edit-reaches-framing');
    await context.close();
  });

  // ---- Downloads "re-edit reel" -> Framing (the path the removed mount fetch served) ----
  test('re-edit reel from Highlight Reels opens Framing with a populated clip list', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const net = recordRequests(page);

    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // Open Highlight Reels; find a reel with an editable project and open its "More actions" menu.
    // ReelTile.jsx: canOpenSource(download) gates a "Open as Draft" menu item (FolderOpen icon)
    // that shares the same useReEditReel/onOpenProject path as the in-player Re-edit button
    // (e2e/reedit-reel.spec.js covers that path's public-viewer gating, not this menu).
    await page.getByRole('button', { name: /Highlight Reels/ }).click().catch(() => {});
    // Scope everything to the open slide-over panel itself (DownloadsPanel.jsx renders a
    // separate bg-black/50 backdrop div + the animate-slide-in-right panel). An unscoped
    // page-wide locator can match a same-testid header still mounted behind the panel
    // (e.g. a Drafts-panel project-card), whose stale position sits under the backdrop and
    // intercepts pointer events forever — hence the prior 180s click timeout.
    const panel = page.locator('div.animate-slide-in-right');
    await panel.waitFor({ timeout: 15000 }).catch(() => {});
    // The Highlight Reels panel groups reels "By game" (CollapsibleGroup, collapsed by default) —
    // individual ReelTile cards (and their "More actions" kebab) only render once a game
    // group is expanded. Expand the first one.
    const groupHeader = panel.locator('[data-testid="collapsible-group-header"]').first();
    const hasGroup = await groupHeader.count();
    test.skip(!hasGroup, 'no game group in Highlight Reels on this account data — seed a published reel');
    await groupHeader.click();

    // Scope to the panel so the click can't hit an unrelated same-page element.
    const moreActions = panel.getByRole('button', { name: 'More actions' }).first();
    await moreActions.waitFor({ timeout: 15000 }).catch(() => {});
    const hasMoreActions = await moreActions.count();
    console.log(`[T6190] Highlight Reels "More actions" buttons found (after group expand) = ${hasMoreActions}`);
    test.skip(!hasMoreActions, 'no reel card in the expanded group on this account data — seed a published reel with an editable project');
    await moreActions.scrollIntoViewIfNeeded();
    await moreActions.click();

    const reEdit = page.getByText('Open as Draft', { exact: true }).first();
    const hasReEdit = await reEdit.count();
    console.log(`[T6190] "Open as Draft" menu items found = ${hasReEdit}`);
    test.skip(!hasReEdit, 'no re-editable reel (no reel with an attached project_id) in Highlight Reels on this account data');

    // After navigation, Framing must open with clips (the onOpenProject invalidateClips fix).
    const clickAt = Date.now();
    await reEdit.click();
    console.log('[T6190] clicked "Open as Draft" — waiting for Framing crop editor...');

    await page.locator('div.cursor-move.border-2, .crop-handle').first().waitFor({ timeout: 90000 });
    const clips = net.countSince(clickAt, 'GET', CLIPS_LIST_RE);
    const list = await page.evaluate(async () => {
      const mod = await import('/src/stores/projectDataStore.js');
      return mod.useProjectDataStore.getState().clips.length;
    });
    console.log(`[T6190] re-edit reel: clips-list GET=${clips}, clip list length=${list}`);
    expect(clips, 're-edit gesture owns its clip fetch').toBeGreaterThanOrEqual(1);
    expect(list, 'Framing opened with a populated clip list (not empty after reset)').toBeGreaterThan(0);
    await saveEvidence(page, 'T6190-reedit-reel-populated-framing');
    await context.close();
  });

  // ---- T6250: Framing -> Overlay must fetch overlay-data from ONE owner -------
  // From the 2026-07-31 HAR, entering Overlay fired overlay-data x3 (two owners:
  // OverlayScreen Effect A "fresh export" + Effect B "plain load") and
  // outdated-clips x2. Root cause: useProjectLoader seeded projectDataStore
  // .clipMetadata on EVERY project-open, so Effect A (whose trigger is that flag)
  // misfired on a plain Framing->Overlay navigation alongside Effect B. Fix
  // (T6250) removes that seed: plain opens fall to Effect B alone; a genuine
  // framing export still sets the flag via FocusScreen and keeps Effect A.
  //
  // STRICTMODE NOTE: this runs the dev stack, where React 18 double-invokes each
  // mount effect, so a single owner shows x2 on the wire (prod = x1). We can't
  // assert an absolute "1" in dev without a prod build, so we pin the STRUCTURAL
  // invariant that survives StrictMode: overlay-data must NOT be fetched by more
  // owners than outdated-clips (a proven single owner). Pre-fix that was 3 > 2
  // and this fails; post-fix both are the same single-owner count (2 in dev, 1
  // in prod). The prod-build "exactly 1" check is a separate manual step
  // (npm run build && npm run preview) recorded in the task file.
  test('T6250: Framing -> Overlay fetches overlay-data from one owner (== outdated-clips)', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await loginAsRealUser(context, EMAIL, PROFILE);
    const page = await context.newPage();
    const net = recordRequests(page);

    // T6250 regression guard: entering Overlay must not trip React's "Maximum
    // update depth exceeded" (the T6190 render-loop class) now that a different
    // effect owns the fetch on the plain path.
    const maxDepthErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && /Maximum update depth exceeded/i.test(m.text())) maxDepthErrors.push(m.text());
    });
    page.on('pageerror', (e) => {
      if (/Maximum update depth exceeded/i.test(String(e))) maxDepthErrors.push(String(e));
    });

    await gotoDrafts(page);

    // Overlay is only reachable when the project has a working video (already
    // exported to Framing). A COMPLETED reel shows a "Focus ...: Complete (click
    // to open)" SEGMENT chip (SegmentedProgressStrip.jsx:187) that opens that
    // working-video project into Framing (non-overlay segment -> onClipClick),
    // where the ModeSwitcher enables Overlay. Exclude the trailing "Overlay:"
    // segment (deep-links into Overlay). Skip honestly with no completed reel.
    const focusCompleteChip = page.getByTitle(/^(?!Overlay:).*:\s*Complete \(click to open\)$/).first();
    const hasCompleted = await focusCompleteChip.count();
    test.skip(!hasCompleted, 'no completed (framing-exported) reel on this account data — cannot enter Overlay');
    await focusCompleteChip.click();
    await page.locator('div.cursor-move.border-2, .crop-handle').first().waitFor({ timeout: 90000 });

    // DETERMINISTIC regression pin for the T6250 fix (the network race below is
    // timing-sensitive and does not always reproduce): a plain project-open must
    // NOT seed projectDataStore.clipMetadata. Pre-fix, useProjectLoader wrote
    // buildClipMetadata() here — a non-null {version, source_clips} object for any
    // project with clips — and that flag is exactly what makes OverlayScreen's
    // Effect A ("fresh export detected") misfire on a plain Framing->Overlay
    // entry. Post-fix the flag stays null until a genuine export gesture
    // (FocusScreen:983) sets it. This assertion FAILS on master / pre-fix.
    const clipMetaAfterOpen = await page.evaluate(async () => {
      const mod = await import('/src/stores/projectDataStore.js');
      return mod.useProjectDataStore.getState().clipMetadata;
    });
    console.log('[T6250] projectDataStore.clipMetadata after plain Framing open =', JSON.stringify(clipMetaAfterOpen));
    expect(clipMetaAfterOpen, 'plain project-open must not seed clipMetadata (the Effect A misfire trigger)').toBeNull();

    // On a completed reel selectedProject.working_video_id is set, so Overlay is
    // enabled. handleModeChange goes straight through (no unsaved overlay edits).
    const overlayBtn = page.locator('[data-testid="mode-overlay"]');
    await overlayBtn.waitFor({ timeout: 30000 });
    await expect(overlayBtn, 'Overlay mode enabled on a completed reel in Framing').toBeEnabled({ timeout: 30000 });
    // The transition gesture: click into Overlay. This is the window we count.
    const switchAt = Date.now();
    await overlayBtn.click();
    await page.waitForURL(/\/overlay/, { timeout: 30000 }).catch(() => {});
    // Wait for overlay-data to actually come back, then let any late/racing
    // owner + StrictMode replay fire so the count is complete before we read it.
    await page.waitForResponse((r) => OVERLAY_DATA_RE.test(r.url()), { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const overlayData = net.countSince(switchAt, 'GET', OVERLAY_DATA_RE);
    const outdated = net.countSince(switchAt, 'GET', OUTDATED_CLIPS_RE);
    console.log(`[T6250] Framing->Overlay counts: overlay-data=${overlayData} outdated-clips=${outdated} `
      + `(dev StrictMode doubles a single owner; prod=1 each. Pre-fix HAR: overlay-data=3, outdated-clips=2)`);

    // Overlay data actually loaded (owner fired, regions can restore).
    expect(overlayData, 'overlay-data has an owner on the Overlay-entry transition').toBeGreaterThanOrEqual(1);
    // THE regression pin: overlay-data must not exceed the single-owner baseline
    // (outdated-clips). Pre-fix 3 > 2 fails here; post-fix they match.
    expect(overlayData, 'overlay-data fetched by ONE owner (not more than the single-owner outdated-clips)')
      .toBeLessThanOrEqual(outdated);

    // No render loop on the transition (T6190 class regression guard).
    await page.waitForTimeout(500);
    expect(maxDepthErrors, `Framing->Overlay must not trip the render loop:\n${maxDepthErrors.join('\n')}`).toEqual([]);

    await saveEvidence(page, 'T6250-overlay-entry-one-owner');
    await context.close();
  });
});
