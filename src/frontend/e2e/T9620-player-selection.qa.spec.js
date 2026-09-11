/**
 * T9620 QA — the spotlight editor leads with picking a player.
 *
 * WHY A DIAG HARNESS (t9620diag.html), NOT the real Focus->Overlay flow:
 * identical reasoning to T9100/T9150/T5676 — a real end-to-end run needs an
 * uploaded game, annotated clips and a real Focus+Overlay render, infeasible in
 * this container (Modal disabled; the dev-login account has zero seeded
 * projects). The harness mounts the REAL OverlaySpotlightPanel + REAL
 * DetectionMarkerLayer + the exact stage prompt markup, with real Tailwind, so
 * the visual acceptance criteria are proven in a real browser.
 *
 * Run: bash scripts/dev-verify.sh e2e/T9620-player-selection.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { QA_DIR } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const HARNESS = '/t9620diag.html';

async function shot(locator, name) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await locator.screenshot({ path: path.join(QA_DIR, name) });
}

test.describe('T9620 player-selection-first (QA)', () => {
  test('renders and screenshots each acceptance criterion', async ({ page }) => {
    skipOnDeployedTarget(test, 'drives the dev-only t9620diag.html harness, not mounted on a deployed target');
    await page.goto(HARNESS);
    await page.waitForSelector('[data-testid="panel-awaiting"]');

    // 1. Primary task stated on screen (not a tooltip).
    const stage = page.getByTestId('stage');
    await expect(stage.getByText('Click your player to add a spotlight')).toBeVisible();
    await shot(stage, 'T9620-1-primary-task.png');

    // 2. Before selection: guidance shown, styling controls absent.
    const awaiting = page.getByTestId('panel-awaiting');
    await expect(awaiting.getByText('Pick your player')).toBeVisible();
    await expect(awaiting.getByText('Outline thickness')).toHaveCount(0);
    await shot(awaiting, 'T9620-2-panel-before-selection.png');

    // 3. After first pick: styling revealed + remaining-players progress.
    const partial = page.getByTestId('panel-partial');
    await expect(partial.getByText('Outline thickness')).toBeVisible();
    await expect(partial.getByTestId('assignment-progress')).toContainText('1 of 3 players selected');
    await shot(partial, 'T9620-3-panel-after-selection.png');

    // 4. Detection markers: a Users glyph accompanies each count.
    const markers = page.getByTestId('markers-unassigned');
    expect(await markers.locator('svg.lucide-users').count()).toBe(3);
    await shot(markers, 'T9620-4-detection-counts.png');

    // 5. Assigned frame shows a check instead of a count.
    const markersPartial = page.getByTestId('markers-partial');
    expect(await markersPartial.locator('svg.lucide-check').count()).toBeGreaterThan(0);
    await shot(markersPartial, 'T9620-5-assigned-check.png');
  });
});
