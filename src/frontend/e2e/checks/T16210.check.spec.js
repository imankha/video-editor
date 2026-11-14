/**
 * T16210 - per-criterion acceptance check (group checks protocol).
 *
 * C1: each of the controls T15600's QA pass measured under 44px, and that T15600's own
 * check could not reach, now measures at least 44x44 on iPhone 14 (390x844) and iPad
 * (810x1080), via the same `coarse-pointer:min-w-11 coarse-pointer:min-h-11` Tailwind
 * pattern Button.jsx already used (tailwind.config.js: `coarse-pointer` = `@media
 * (hover:none) and (pointer:coarse)`). Measuring a real coarse-pointer target requires
 * Playwright's touch emulation (`hasTouch`/`isMobile`) -- without it `pointer:coarse`
 * never matches and every coarse-pointer-floored control reads as its bare (desktop)
 * size, which looks like a false failure.
 *
 * Every one of the eleven controls from T15600's 2026-11-09 QA list is measured live, at
 * both viewports (fix round 1: the first version reached only six and argued the rest
 * from reading code):
 *   1. Annotate play-count chip ("Show plays")             -- annotate test
 *   2. Annotate time labels (TrimTimeField start/end)      -- annotate test
 *   3. Annotate fullscreen Mark play                       -- annotate test
 *   4. Plays list View details + Jump to play              -- annotate test
 *   5. Plays list Hide plays (drawer close)                -- annotate test
 *   6. Frame's Portrait/Landscape chip (focus-shape-chip)  -- frame test
 *   7. Spotlight number chips (DetectionMarkerLayer markers, the 24x24 boxes with the
 *      athlete-count badge: their hit pad is what a finger lands on) -- spotlight test
 *   8. Spotlight Delete spotlight                          -- spotlight test
 *   9. Spotlight toast action + Dismiss (shared Toast; the save-failed toast's action)
 *  10. Gallery header (Highlights tab: game group headers + grouping pills) -- gallery test
 *  11. Share page: Open ReelBallers (SharedGameView + SharedAnnotationView link) and
 *      Tap to unmute (SharedVideoOverlay's VideoControls mute toggle) -- share test
 *
 * Data the dev stack cannot produce is supplied at the network edge, never by calling
 * internal code: player detections (YOLO runs on Modal, off in dev) are added to the real
 * overlay-data response so the real marker layer renders, and the public share pages get
 * a route-mocked share payload (same technique as T15600's share-page check). A failed
 * save for the toast is a real overlay-actions POST aborted at the network.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16210.check.spec.js --reporter=line
 */
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi, disableGuidanceForCheck } from '../helpers/checkAuth';

// The dev stack cold-loads slowly (SLOW FETCH on most requests, see T15760's check).
test.setTimeout(480000);

const VIEWPORTS = [
  { name: 'iphone14', width: 390, height: 844 },
  { name: 'ipad', width: 810, height: 1080 },
];

async function assertAtLeast44(locator, label) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} has a bounding box`).not.toBeNull();
  expect(box.width, `${label} width (${box.width}) >= 44`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height (${box.height}) >= 44`).toBeGreaterThanOrEqual(44);
}

/** A hit pad (an absolutely positioned child that extends a small visual) must also
 *  route taps to the control it belongs to: at its centre and at both side edges, i.e.
 *  across its full 44px width. (Its top/bottom edges are not probed: timeline rows are
 *  32px tall, so neighbouring rows' 44px pads -- e.g. KeyframeMarker's -- legitimately
 *  overlap there by a few pixels.) */
async function assertHitPadTargets(pad, control, label) {
  await assertAtLeast44(pad, label);
  // Centre it: the sticky bottom action band covers the lower viewport edge, and a
  // parent scrolls a control clear of it before tapping. Re-scroll and re-probe until
  // the layout settles: on a slow load the video's stage grows after the first scroll
  // and pushes the timeline back under the band (T16450, staging iPad).
  await expect.poll(async () => {
    await control.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = await pad.boundingBox();
    const inset = 2;
    const cy = box.y + box.height / 2;
    const points = [
      [box.x + box.width / 2, cy],
      [box.x + inset, cy],
      [box.x + box.width - inset, cy],
    ];
    return control.evaluate((el, pts) => pts.map(([px, py]) => {
      // The playhead lever moves with playback and sits over whichever marker it is
      // parked on; it is not part of the layout this criterion is about, so look past it.
      const top = document.elementsFromPoint(px, py).find((e) => !e.closest('.lever-handle'));
      const hit = !!top && el.contains(top) ? 'control' : (top ? `${top.tagName}.${top.className}`.slice(0, 120) : 'nothing');
      return `(${Math.round(px)},${Math.round(py)}) ${hit}`;
    }), points);
  }, { message: `${label}: a tap at its centre and both side edges reaches the control`, timeout: 30000 })
    .toEqual([expect.stringMatching(/ control$/), expect.stringMatching(/ control$/), expect.stringMatching(/ control$/)]);
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

async function findFramedProject(page) {
  const projectsRes = await page.request.get(checkApi('/projects'));
  expect(projectsRes.ok(), `GET /projects -> ${projectsRes.status()}`).toBeTruthy();
  const body = await projectsRes.json();
  const projects = Array.isArray(body) ? body : body.projects || [];
  // has_working_video is the Overlay-mode gate (same one UnifiedHeader's
  // hasOverlayVideo prop checks), and a framed project has saved box positions.
  return projects.find((p) => p.clip_count > 0 && p.has_working_video) || null;
}

/** A project Frame can edit: its game video still exists. A clip whose source game was
 *  reclaimed after expiry gets 410 from playback-url and Frame shows "Game video
 *  expired" with no box to drag (T16450: the staging account's framed projects are all
 *  on its expired game). Projects with a saved box are tried first. */
async function findFrameableProject(page) {
  const projectsRes = await page.request.get(checkApi('/projects'));
  expect(projectsRes.ok(), `GET /projects -> ${projectsRes.status()}`).toBeTruthy();
  const body = await projectsRes.json();
  const projects = (Array.isArray(body) ? body : body.projects || []).filter((p) => p.clip_count > 0);
  projects.sort((a, b) => Number(b.has_crop_keyframes) - Number(a.has_crop_keyframes));
  for (const p of projects) {
    // The project's own (working) clip ids; /projects lists the raw clip ids.
    const clipsRes = await page.request.get(checkApi(`/clips/projects/${p.id}/clips`));
    if (!clipsRes.ok()) continue;
    const [clip] = await clipsRes.json();
    if (!clip) continue;
    const res = await page.request.get(checkApi(`/clips/projects/${p.id}/clips/${clip.id}/playback-url`));
    if (res.ok()) return p;
  }
  return null;
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test(`T16210:C1 - Annotate: Show plays, fullscreen Mark play, Plays list and time labels are >=44x44 on ${vp.name}`, async ({ context, page }) => {
      await loginForCheck(context);
      const gameId = await findGameWithPlays(page);
      expect(gameId, 'a game with at least one play').toBeTruthy();

      await page.goto(`/annotate/g/${gameId}`);

      // Show plays / play-count chip (mobile-only "extraControls" button in the header).
      // On this viewport the clip list lives ONLY inside the off-canvas drawer this
      // button opens (useMobileClipPanel = isMobile && !isLandscape in AnnotateScreen.jsx).
      const showPlays = page.getByTitle('Show plays');
      await showPlays.waitFor({ timeout: 180000 });
      await disableGuidanceForCheck(page);
      await assertAtLeast44(showPlays, 'Annotate "Show plays" chip');

      // Fullscreen Mark play: Annotate's toolbar Mark play renders ONLY in fullscreen
      // (AnnotateControls.jsx: icon-only below sm, labelled from sm up -- one of the two
      // is visible at each viewport). With the playhead inside a play the same button
      // reads "Edit selected play" (T16450: the staging account resumes inside one).
      await page.getByTitle('Fullscreen', { exact: true }).click({ timeout: 60000 });
      const fsMarkPlay = page.getByTitle(/^(Mark play ending at current time|Edit selected play) \(A\)$/).locator('visible=true');
      await fsMarkPlay.first().waitFor({ timeout: 30000 });
      await assertAtLeast44(fsMarkPlay.first(), 'Annotate fullscreen "Mark play"');
      await page.getByTitle('Exit fullscreen', { exact: true }).locator('visible=true').first().click();
      await expect(fsMarkPlay).toHaveCount(0, { timeout: 30000 });

      await showPlays.click();
      const drawer = page.getByTestId('annotate-plays-drawer');
      await drawer.waitFor({ timeout: 30000 });
      const firstRow = drawer.getByTestId('clip-row').first();
      await firstRow.waitFor({ timeout: 30000 });

      // Plays list: View details + Jump to play (mobile-only row actions). Both are
      // required: a missing View details is a failure, not a skip.
      const viewDetails = firstRow.getByTitle('View details');
      await assertAtLeast44(viewDetails, 'Plays list "View details"');
      const jumpToClip = firstRow.getByTitle('Jump to play');
      await assertAtLeast44(jumpToClip, 'Plays list "Jump to play"');

      // Hide plays (drawer close X).
      await assertAtLeast44(page.getByTestId('annotate-plays-drawer-close'), 'Plays drawer "Hide plays"');

      // Annotate's time-label buttons, in the clip editor View details opens.
      await viewDetails.click();
      const startField = page.getByTestId('trim-field-start');
      await startField.waitFor({ timeout: 30000 });
      await assertAtLeast44(startField, 'Annotate time label (start)');
      await assertAtLeast44(page.getByTestId('trim-field-end'), 'Annotate time label (end)');
    });

    test(`T16210:C1 - Frame: the Portrait/Landscape chip is >=44x44 on ${vp.name}`, async ({ context, page }) => {
      await loginForCheck(context);
      const project = await findFrameableProject(page);
      expect(project, 'a project whose game video Frame can play').toBeTruthy();

      // The chip replaces the "Where will you share it?" picker once the highlight has a
      // saved box position when Frame opens (FrameShapeChoice hasPositions = FocusModeView's
      // mount-time boxPrePlaced). If this draft has none yet, place one the way a parent
      // does -- drag the box -- then come back to Frame.
      const cropHandles = page.locator('.crop-handle');
      const chip = page.getByTestId('focus-shape-chip');
      const picker = page.getByTestId('focus-shape-option-portrait');
      await page.goto(`/focus/p/${project.id}`);
      await cropHandles.first().waitFor({ timeout: 180000 });
      await chip.or(picker).first().waitFor({ timeout: 60000 });
      if (!(await chip.isVisible())) {
        await disableGuidanceForCheck(page);
        const boxes = await cropHandles.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON()));
        const left = Math.min(...boxes.map((b) => b.x + b.width / 2));
        const right = Math.max(...boxes.map((b) => b.x + b.width / 2));
        const top = Math.min(...boxes.map((b) => b.y + b.height / 2));
        const bottom = Math.max(...boxes.map((b) => b.y + b.height / 2));
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const saved = page.waitForResponse((r) => r.request().method() === 'POST' && /\/actions/.test(r.url()), { timeout: 60000 });
        await page.mouse.move(cx, cy);
        await page.mouse.down();
        await page.mouse.move(cx - 15, cy, { steps: 5 });
        await page.mouse.move(cx - 30, cy, { steps: 5 });
        await page.mouse.up();
        expect((await saved).ok(), 'the box drag saved a position').toBeTruthy();
        // Leave Frame and come back in-app (Spotlight tab, then Frame tab), the way a
        // parent returns to it; Frame re-mounts with the saved position.
        await page.getByTestId('mode-overlay').click();
        await page.locator('.region-track').first().waitFor({ timeout: 180000 });
        await page.getByTestId('mode-framing').click();
        await cropHandles.first().waitFor({ timeout: 180000 });
      }
      await chip.waitFor({ timeout: 60000 });
      await assertAtLeast44(chip, 'Frame Portrait/Landscape chip');
    });

    test(`T16210:C1 - Spotlight: number chips, Delete spotlight and the toast are >=44x44 on ${vp.name}`, async ({ context, page }) => {
      await loginForCheck(context);
      const project = await findFramedProject(page);
      expect(project, 'a project with a working video to spotlight').toBeTruthy();

      // Player detection runs on Modal (off in dev), so add detections to the REAL
      // overlay-data response; the app slices them into the region a tap creates
      // (useHighlightRegions.sliceDetections) and the real DetectionMarkerLayer renders.
      await page.route(`**/api/export/projects/${project.id}/overlay-data`, async (route) => {
        const response = await route.fetch();
        const data = await response.json();
        const duration = data.video_duration
          || Math.max(...(data.highlights_data || []).map((r) => r.end_time || 0), 0) || 4;
        const box = { x: 640, y: 360, width: 80, height: 160, confidence: 0.9 };
        const detections = [0.25, 0.5, 0.75].map((f) => {
          const timestamp = +(duration * f).toFixed(3);
          return { timestamp, frame: Math.round(timestamp * 30), boxes: [box, { ...box, x: 900 }] };
        });
        data.detections_data = { videoWidth: 1280, videoHeight: 720, fps: 30, detections };
        // A restored region carries its own detections (OverlayScreen restores
        // highlights_data as-is); give each one the detections inside its span.
        for (const region of data.highlights_data || []) {
          const own = detections.filter((d) => d.timestamp >= (region.start_time ?? 0) && d.timestamp <= (region.end_time ?? duration));
          const mid = +(((region.start_time ?? 0) + (region.end_time ?? duration)) / 2).toFixed(3);
          region.detections = own.length ? own : [{ ...detections[0], timestamp: mid, frame: Math.round(mid * 30) }];
          region.videoWidth = region.videoWidth || 1280;
          region.videoHeight = region.videoHeight || 720;
          region.fps = region.fps || 30;
        }
        await route.fulfill({ response, json: data });
      });

      await page.goto(`/overlay/p/${project.id}`);
      const track = page.locator('.region-track').first();
      await track.waitFor({ timeout: 180000 });
      await disableGuidanceForCheck(page);
      // The mobile settings panel can (re)open over the timeline on these viewports (e.g.
      // after a region is added); close it before each timeline step so it can't cover
      // the controls under test.
      const drawerClose = page.getByTestId('drawer-close');
      const closeSettingsPanel = async () => {
        if (await drawerClose.isVisible().catch(() => false)) {
          await drawerClose.click();
          await expect(drawerClose).toBeHidden({ timeout: 15000 });
        }
      };
      await closeSettingsPanel();

      // A spotlight region over the whole track: tap the empty track (as a parent does)
      // unless the restored project already has one.
      const deleteSpotlight = page.getByTitle('Delete spotlight');
      if (!(await deleteSpotlight.count())) {
        const trackBox = await track.boundingBox();
        await page.mouse.click(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height / 2);
      }

      // Spotlight number chips: each marker is a 24px box with an athlete-count badge;
      // its coarse-pointer hit pad is the tap target.
      const markers = page.locator('button:has(.detection-marker-touch)');
      await markers.first().waitFor({ timeout: 60000 });
      await closeSettingsPanel();
      // Every marker the timeline shows, not just one.
      const markerCount = await markers.count();
      for (let i = 0; i < markerCount; i += 1) {
        const m = markers.nth(i);
        await assertHitPadTargets(m.locator('.detection-marker-touch'), m, `Spotlight number chip #${i + 1}`);
      }

      await closeSettingsPanel();
      // The red trash chip stays small on purpose; its coarse-pointer hit pad (T15600,
      // RegionLayer.jsx) is the tap target, measured like the number chips' pads.
      await assertHitPadTargets(deleteSpotlight.locator('span[aria-hidden="true"]'), deleteSpotlight, 'Spotlight "Delete spotlight"');

      // Toast action + Dismiss: overlayActionStore's "Your edits aren't saving" toast
      // (shared Toast component) from a REAL overlay-actions POST that fails at the
      // network, made by confirm-deleting the spotlight region.
      await page.route('**/api/export/projects/*/overlay/actions', (route) => route.abort('failed'));
      await deleteSpotlight.click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      // Scope to the toast's own alert region: ConnectionStatus renders an unrelated
      // "Retry" banner button on connectivity hiccups.
      const toastAlert = page.getByRole('alert').filter({ hasText: 'Retry' }).filter({ has: page.getByLabel('Dismiss', { exact: true }) });
      await toastAlert.first().waitFor({ timeout: 30000 });
      await assertAtLeast44(toastAlert.first().getByText('Retry', { exact: true }), 'Toast action (Retry)');
      await assertAtLeast44(toastAlert.first().getByLabel('Dismiss', { exact: true }), 'Toast Dismiss');
    });

    test(`T16210:C1 - Gallery header controls are >=44x44 on ${vp.name}`, async ({ context, page }) => {
      await loginForCheck(context);
      // Open Home explicitly: '/' restores the account's resume point (T15340).
      await page.goto('/home');
      const highlightsTab = page.getByTestId('home-tab-published');
      await highlightsTab.waitFor({ timeout: 180000 });
      await highlightsTab.click();
      const panel = page.getByTestId('published-tab-panel');
      await panel.waitFor({ timeout: 30000 });

      // The Gallery's header row(s): each game group's collapsible header, plus the
      // "Group highlights by" pills when the account's metadata offers more than one axis.
      const groupHeaders = panel.getByTestId('collapsible-group-header');
      await groupHeaders.first().waitFor({ timeout: 120000 });
      const headerCount = await groupHeaders.count();
      for (let i = 0; i < headerCount; i += 1) {
        await assertAtLeast44(groupHeaders.nth(i), `Gallery group header #${i + 1}`);
      }
      const pills = panel.getByRole('group', { name: 'Group highlights by' }).getByRole('button');
      const pillCount = await pills.count();
      for (let i = 0; i < pillCount; i += 1) {
        await assertAtLeast44(pills.nth(i), `Gallery grouping pill #${i + 1}`);
      }
    });

    test(`T16210:C1 - share page: Open ReelBallers and Tap to unmute are >=44x44 on ${vp.name}`, async ({ page }) => {
      // Public pages: no login. Route-mocked share payloads (T15600's share-page technique).
      // SharedGameView: the header's "REEL BALLERS" link to reelballers.com.
      await page.route('**/api/shared/game/deadbeef0000', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ game_name: 'U10 vs Rivals', game_date: '2026-01-01', clips: [] }),
      }));
      await page.goto('/shared/game/deadbeef0000');
      const gameLink = page.getByRole('link', { name: 'REEL BALLERS' });
      await gameLink.waitFor({ timeout: 120000 });
      await assertAtLeast44(gameLink, 'SharedGameView "Open ReelBallers" link');

      // SharedAnnotationView: every state renders the same Shell with the logo link.
      await page.goto('/shared/teammate/deadbeef0001');
      const annotationLink = page.getByRole('link').filter({ hasText: 'ReelBallers' });
      await annotationLink.first().waitFor({ timeout: 120000 });
      await assertAtLeast44(annotationLink.first(), 'SharedAnnotationView "Open ReelBallers" link');

      // SharedVideoOverlay (/shared/:token): the player's mute toggle ("Tap to unmute").
      const VIDEO_URL = 'https://media.example.test/t16210-shared.mp4';
      await page.route('**/api/shared/deadbeef0002', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ video_name: 'Goal vs Carlsbad', video_url: VIDEO_URL }),
      }));
      await page.route(VIDEO_URL, (route) => route.fulfill({
        status: 200,
        contentType: 'video/mp4',
        path: fileURLToPath(new URL('../../../../formal annotations/test.short/game2-test.mp4', import.meta.url)),
      }));
      await page.goto('/shared/deadbeef0002');
      const muteToggle = page.getByTitle(/^(Unmute|Mute) \(M\)$/);
      await muteToggle.first().waitFor({ timeout: 120000 });
      await assertAtLeast44(muteToggle.first(), 'Share page "Tap to unmute"');
    });
  });
}
