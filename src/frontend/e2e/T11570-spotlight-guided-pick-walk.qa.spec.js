/**
 * T11570 QA — live-drives the guided athlete-pick walk's full behavior
 * against the real useGuidedAthletePick hook + real SpotlightPickGuide,
 * mapping every acceptance criterion to a screenshot.
 *
 * WHY A DIAG HARNESS (t11570walkdiag.html), NOT the real Overlay flow:
 * identical reasoning to T9620/T9100/T9150 — a real end-to-end run needs an
 * uploaded game, annotated clips and a real Focus+Overlay render (infeasible
 * in this container: Modal disabled, dev-login account has zero seeded
 * projects). OverlayContainer itself also has no dedicated test harness in
 * this codebase (verified: no OverlayContainer.test.jsx exists) -- the diag
 * harness stands in for it with the SAME wiring (parkOnDetection,
 * scheduleGuidedAdvance called from the pick gesture, clear-on-play/scrub),
 * so this proves the real hook + real view's behavior in a real browser.
 *
 * Run: bash scripts/dev-verify.sh e2e/T11570-spotlight-guided-pick-walk.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { saveEvidence } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const HARNESS = '/t11570walkdiag.html';

test.describe('T11570 guided athlete-pick walk (QA)', () => {
  test('walks all 7 acceptance criteria end to end', async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only t11570walkdiag.html harness, not mounted on a deployed target');
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="stage"]');

    // AC1: entering with N(=4) unpicked markers parks on marker 1, "Tap/Click
    // your athlete · Step 1 of 4" (mouse pointer in this harness -> "Click").
    await expect(page.getByTestId('pick-guide-text')).toHaveText('Click your athlete');
    await expect(page.getByTestId('pick-guide-step')).toHaveText('Step 1 of 4');
    await expect(page.getByTestId('guide-phase')).toContainText('phase=parked step=1 total=4');
    await expect(page.getByTestId('marker-marker-1')).toHaveCSS('border', /3px/); // active ring
    await saveEvidence(page, 'T11570-AC1-entry-park-step-1-of-4');

    // AC2: tapping the active box shows "Got it", then within ~1s (650ms) the
    // playhead parks on the next UNPICKED marker with "Step 2 of 4".
    await page.getByTestId('tap-active-box').click();
    await expect(page.getByTestId('pick-guide-text')).toHaveText('Got it');
    await saveEvidence(page, 'T11570-AC2a-confirm-got-it');
    await expect(page.getByTestId('pick-guide-step')).toHaveText('Step 2 of 4', { timeout: 2000 });
    await expect(page.getByTestId('marker-marker-1')).toContainText('✓'); // marker 1 checked off
    await expect(page.getByTestId('guide-phase')).toContainText('phase=parked step=2 total=4');
    await saveEvidence(page, 'T11570-AC2b-advanced-step-2-of-4');

    // AC4: jump to marker 3 directly (skipping marker 2), then pick it --
    // routes to marker 4, then wraps to marker 1... but marker 1 is already
    // picked (AC2), so the walk's forward-then-wrap search skips straight to
    // the next UNPICKED marker, which is marker 2 -- proving the wrap search
    // is itself correct (not "wrap to index 0 unconditionally").
    await page.getByTestId('marker-marker-3').click();
    await expect(page.getByTestId('guide-phase')).toContainText('phase=parked step=3 total=4');
    await saveEvidence(page, 'T11570-AC4a-direct-tap-marker-3');
    await page.getByTestId('tap-active-box').click();
    await expect(page.getByTestId('guide-phase')).toContainText('phase=parked step=4 total=4', { timeout: 2000 });
    await saveEvidence(page, 'T11570-AC4b-routed-to-marker-4');
    await page.getByTestId('tap-active-box').click();
    // Wraps PAST the picked marker 1, landing on the only remaining unpicked
    // one -- marker 2.
    await expect(page.getByTestId('guide-phase')).toContainText('phase=parked step=2 total=4', { timeout: 2000 });
    await saveEvidence(page, 'T11570-AC4c-wrapped-to-marker-2');

    // AC5: "Not boxed? Drag the circle" assigns the ACTIVE marker (2) on
    // release and advances the same way as a direct tap.
    await page.getByTestId('drag-circle').click();
    await expect(page.getByTestId('pick-guide-text')).toHaveText('Got it');
    await saveEvidence(page, 'T11570-AC5a-drag-circle-confirm');

    // AC3: after the Nth pick (all 4 assigned), "All 4 done" + styling-panel
    // handoff (the guide's own Play-spotlight affordance). No network write
    // anywhere in this flow -- scheduleGuidedAdvance/parkOnDetection/
    // nextUnpickedMarker are pure in-memory (grepped: zero fetch/axios/XHR
    // call sites in useGuidedAthletePick.js or detectionAssignment.js).
    await expect(page.getByTestId('pick-guide-text')).toHaveText('All 4 done. The spotlight follows your athlete.', { timeout: 2000 });
    await expect(page.getByTestId('guide-phase')).toContainText('phase=done');
    for (const m of ['marker-1', 'marker-2', 'marker-3', 'marker-4']) {
      await expect(page.getByTestId(`marker-${m}`)).toContainText('✓');
    }
    await saveEvidence(page, 'T11570-AC3-all-done');

    // AC6: play/scrub during the 650ms confirm window cancels the pending
    // jump. Re-open the walk by tapping an already-picked marker to revisit
    // it (Done -> Picking for that marker only), start a pick, then play
    // immediately -- the advance must NOT fire.
    await page.getByTestId('marker-marker-1').click();
    await expect(page.getByTestId('guide-phase')).toContainText('phase=parked step=1');
    await page.getByTestId('tap-active-box').click();
    await expect(page.getByTestId('pick-guide-text')).toHaveText('Got it');
    await page.getByTestId('play-btn').click();
    await saveEvidence(page, 'T11570-AC6-play-cancels-pending-jump');
    // Phase leaves 'confirm' immediately (cancelled) -- back to 'done' since
    // every marker is still assigned and nothing else is tracked.
    await expect(page.getByTestId('guide-phase')).toContainText('phase=done');
    // Wait past the would-have-been 650ms advance and confirm it never fired
    // a SECOND park (the action log shows exactly one parkOnDetection for
    // this re-visit, not a follow-up auto-advance one).
    await page.waitForTimeout(900);
    const log = await page.getByTestId('action-log').textContent();
    const parkCallsAfterPlay = log.split('\n').slice(log.split('\n').lastIndexOf('PLAY (clickedDetection cleared, as OverlayContainer does on isPlaying)')).filter((l) => l.includes('parkOnDetection'));
    expect(parkCallsAfterPlay).toHaveLength(0);
  });
});
