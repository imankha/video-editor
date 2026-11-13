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
 * Covered live, both viewports: Annotate's time-label buttons (TrimTimeField), the
 * mobile Plays list's View details / Jump to play (ClipListItem) and Hide plays
 * (drawer close), the play-count "Show plays" chip, Spotlight's Delete spotlight
 * (RegionLayer), and the shared Toast's action + Dismiss buttons (via a real failed-save
 * toast: overlayActionStore's "Your edits aren't saving" path, triggered by aborting the
 * real overlay-actions POST a confirmed region delete makes -- not a synthetic toast()
 * call -- while staying on the same Overlay screen the Delete-spotlight check above
 * already reached).
 *
 * Not reached here, confirmed already correctly sized by reading the code (not this
 * task's fix): the fullscreen "Mark play" icon button (routes through the shared
 * Button.jsx, already floored), Frame's Portrait/Landscape chip (AspectRatioSelector.jsx
 * already carries the coarse-pointer classes), and the share page's mute/unmute button
 * (VideoControls.jsx IS_COARSE path: `p-2.5` + a 26px icon = 46px, already above the
 * floor). Spotlight's "number chips" from the 2026-11-09 QA pass no longer exist as a
 * rendered control: `RegionLayer.jsx`'s `renderRegionBadge` only draws a visible chip
 * for `segment` mode (the speed badge); `SPOTLIGHT_COPY.numbered()` is used ONLY as a
 * `title` tooltip on the region background (line ~436), never mounted as its own
 * element, confirmed by grepping every `numbered(` call site in src/.
 *
 * NOT reached live and NOT otherwise provable here: the share page's "Open ReelBallers"
 * link in both SharedGameView and SharedAnnotationView (one-line coarse-pointer fix in
 * each, same pattern as every other control above) -- every game in the `full` dev
 * preset has `team_clip_count: 0` (POST .../share-link 409s `empty_team_layer` for all
 * of them; `my_athlete` is set at clip creation/import, not user-editable in this UI,
 * so no in-test gesture can produce a team-tagged clip to share), and SharedAnnotationView
 * separately needs a teammate-tag email flow this check does not set up either. Also NOT
 * reached: Gallery's "Published" tab (CollectionsTab.jsx grouping-toggle pills, now
 * floored with `coarse-pointer:min-h-11`, best-identified candidate for the 2026-11-09
 * QA pass's "Gallery header 32x28" -- unconfirmed, since the Home screen's websocket
 * stats never resolved in this sandbox across 4 dispatch attempts, a pre-existing infra
 * issue unrelated to this task's fix). Both gaps are flagged for staging confirmation.
 *
 * Run: bash scripts/dev-verify.sh e2e/checks/T16210.check.spec.js --reporter=line
 */
import { test, expect } from '@playwright/test';
import { loginForCheck, checkApi } from '../helpers/checkAuth';

test.setTimeout(240000);

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

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ hasTouch: true, isMobile: true, viewport: { width: vp.width, height: vp.height } });

    test(`T16210:C1 - the remaining touch targets are >=44x44 on ${vp.name}`, async ({ context, page }) => {
      await loginForCheck(context);

      // --- Annotate: find a game with at least one play -------------------------
      const gamesRes = await page.request.get(checkApi('/games'));
      expect(gamesRes.ok(), `GET /games -> ${gamesRes.status()}`).toBeTruthy();
      const games = (await gamesRes.json()).games || (await gamesRes.json());
      let gameId = null;
      for (const g of games.filter((g) => g.clip_count > 0)) {
        const loadRes = await page.request.get(checkApi(`/games/${g.id}/load`));
        if (!loadRes.ok()) continue;
        const loaded = await loadRes.json();
        if ((loaded.game?.annotations || []).length > 0) { gameId = g.id; break; }
      }
      expect(gameId, 'a game with at least one play').toBeTruthy();

      await page.goto(`/annotate/g/${gameId}`);

      // Show plays / play-count chip (mobile-only "extraControls" button in the header).
      // On this viewport the clip list lives ONLY inside the off-canvas drawer this
      // button opens (useMobileClipPanel = isMobile && !isLandscape in AnnotateScreen.jsx) --
      // never wait on a top-level clip-row here, it doesn't render until the drawer opens.
      const showPlays = page.getByTitle('Show plays');
      await showPlays.waitFor({ timeout: 60000 });
      await assertAtLeast44(showPlays, 'Annotate "Show plays" chip');
      await showPlays.click();

      const drawer = page.getByTestId('annotate-plays-drawer');
      await drawer.waitFor({ timeout: 15000 });
      const firstRow = drawer.getByTestId('clip-row').first();
      await firstRow.waitFor({ timeout: 15000 });

      // Plays list: View details + Jump to play (mobile-only row actions).
      const viewDetails = firstRow.getByTitle('View details');
      if (await viewDetails.count()) {
        await assertAtLeast44(viewDetails, 'Plays list "View details"');
      }
      const jumpToClip = firstRow.getByTitle('Jump to play');
      await assertAtLeast44(jumpToClip, 'Plays list "Jump to play"');

      // Hide plays (drawer close X).
      const hidePlays = page.getByTestId('annotate-plays-drawer-close');
      await assertAtLeast44(hidePlays, 'Plays drawer "Hide plays"');

      // Annotate's time-label buttons: open the clip editor via View details (or, if
      // absent for this row -- playback mode omits it -- fall back to Jump to play,
      // which still lands on a clip the scrub region can render for).
      if (await viewDetails.count()) {
        await viewDetails.click();
      } else {
        await jumpToClip.click();
      }
      const startField = page.getByTestId('trim-field-start');
      const endField = page.getByTestId('trim-field-end');
      await startField.waitFor({ timeout: 30000 });
      await assertAtLeast44(startField, 'Annotate time label (start)');
      await assertAtLeast44(endField, 'Annotate time label (end)');

      // --- Spotlight: Delete spotlight -------------------------------------------
      const projectsRes = await page.request.get(checkApi('/projects'));
      expect(projectsRes.ok(), `GET /projects -> ${projectsRes.status()}`).toBeTruthy();
      const projectsBody = await projectsRes.json();
      const projects = Array.isArray(projectsBody) ? projectsBody : projectsBody.projects || [];
      // has_working_video is the Overlay-mode gate (same one UnifiedHeader's
      // hasOverlayVideo prop checks): a project whose source hasn't finished
      // Framing yet never mounts RegionLayer's .region-track.
      const spotlightProject = projects.find((p) => p.clip_count > 0 && p.has_working_video);
      expect(spotlightProject, 'a project with a working video to spotlight').toBeTruthy();

      await page.goto(`/overlay/p/${spotlightProject.id}`);
      const track = page.locator('.region-track').first();
      // The working video streams from R2 before RegionLayer can mount a track;
      // allow generously for that first fetch (dev-verify.sh's own health-wait
      // cap is 120s for the same reason).
      await track.waitFor({ timeout: 120000 });
      const trackBox = await track.boundingBox();
      await page.mouse.click(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height / 2);

      const deleteSpotlight = page.getByTitle('Delete spotlight');
      await assertAtLeast44(deleteSpotlight, 'Spotlight "Delete spotlight"');

      // The mobile settings panel can auto-open over the timeline on this viewport;
      // close it first so it can't intercept the delete click below (a real parent
      // would close it or scroll the same way before tapping the timeline control).
      const drawerClose = page.getByTestId('drawer-close');
      if (await drawerClose.isVisible().catch(() => false)) {
        await drawerClose.click();
      }

      // --- Toast: action (Retry) + Dismiss ---------------------------------------
      // Real production path, staying on this same Overlay screen (a full page.goto('/')
      // to reach ProjectsScreen's own Retry toast proved flaky in this sandbox --
      // sessionInit's /api/auth/me re-check sometimes hangs on a second full reload,
      // unrelated to this task): overlayActionStore's "Your edits aren't saving" toast
      // (SPOTLIGHT_COPY.SAVE_FAILED_TITLE) fires from the SAME shared Toast component
      // when a real overlay-actions POST fails -- forced here by aborting it, the same
      // technique a real dropped connection produces. Confirm-delete the spotlight
      // region the Delete-spotlight check above just measured.
      await page.route('**/api/export/projects/*/overlay/actions', (route) => route.abort('failed'));
      await deleteSpotlight.click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();

      // Scope to the toast's own alert region: ConnectionStatus renders an unrelated
      // "Retry" banner button on connectivity hiccups, and a global getByText('Retry')
      // can match that instead of the toast action this criterion is about.
      const toastAlert = page.getByRole('alert').filter({ hasText: 'Retry' });
      await toastAlert.waitFor({ timeout: 30000 });
      const retryAction = toastAlert.getByText('Retry', { exact: true });
      await assertAtLeast44(retryAction, 'Toast action (Retry)');
      const dismiss = toastAlert.getByLabel('Dismiss', { exact: true });
      await assertAtLeast44(dismiss, 'Toast Dismiss');
    });
  });
}
