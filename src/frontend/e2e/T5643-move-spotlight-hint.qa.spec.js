import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

/**
 * T5643 — REAL BROWSER (chromium) proof that the "Tap the spotlight" hint (T5610) now:
 *   1. renders directly under the "N players detected" badge, and
 *   2. hides while a tracking/spotlight keyframe is selected, reappearing on deselect.
 *
 * Driven through a dev-only harness (/overlaydiag-t5643.html) that mounts the REAL
 * PlayerDetectionOverlay (source of the badge) + REAL OverrideHint, nested exactly like
 * OverlayModeView.jsx (outer relative wrapper -> video-player-container ->
 * video-container -> badge; OverrideHint as a sibling of video-player-container) so the
 * measured pixel geometry here matches production. See src/overlaydiag-t5643/main.jsx
 * for the full nesting rationale.
 *
 * A full `loginAsRealUser` live-drive against the real app (per the task's QA section)
 * was NOT possible in this sandbox: no Postgres/docker/backend stack is reachable here
 * (no CLAUDE.local.md, `localhost:5432` and `host.docker.internal:5432` both refused,
 * no `.venv` for the backend). This harness is the closest available substitute per the
 * codebase's own precedent (T5610/T5450/T5380b/T4550 all use the same dev-harness
 * pattern for backend-independent overlay verification) and exercises the REAL
 * components with REAL Tailwind classes, not a jsdom mock.
 *
 * Acceptance-criterion map (task doc T5643):
 *   AC1 hint renders immediately below "N players detected"        -> test 1
 *   AC2 visible when tracking ON + region + not overridden + no frame selected -> test 2
 *   AC3 selecting a frame hides it; deselecting shows it again      -> test 2
 *   AC4 no regression to T5610 gating (tracking off / overrideUsed) -> test 3
 *
 * Run: cd src/frontend && npx playwright test e2e/T5643-move-spotlight-hint.qa.spec.js
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLE = path.resolve(__dirname, '..', 'public', 'overlaydiag-sample.mp4');
const HARNESS = 'http://localhost:5173/overlaydiag-t5643.html';

const HINT = '[data-testid="override-hint"]';
const BADGE_TEXT = 'players detected';
const TRACKING_TOGGLE = '[data-testid="toggle-player-boxes"]';
const FRAME_TOGGLE = '[data-testid="toggle-frame-selected"]';
const MARK_USED = '[data-testid="mark-override-used"]';
const CONTAINER = '[data-testid="video-container"]';

test.beforeAll(() => {
  if (!existsSync(SAMPLE)) {
    execSync(
      `ffmpeg -y -f lavfi -i testsrc=duration=3:size=640x360:rate=30 -pix_fmt yuv420p -movflags +faststart "${SAMPLE}"`,
      { stdio: 'ignore' }
    );
  }
});

test.afterAll(() => {
  if (existsSync(SAMPLE)) unlinkSync(SAMPLE);
});

// AC1 — placement directly under the "N players detected" badge.
test('1) hint renders directly below the "N players detected" badge', async ({ page }) => {
  await page.goto(HARNESS);
  const badge = page.getByText(BADGE_TEXT);
  await expect(badge).toBeVisible();
  await expect(page.locator(HINT)).toBeVisible();

  const badgeBox = await badge.boundingBox();
  const hintBox = await page.locator(HINT).boundingBox();

  // "Directly below": hint's top edge is below the badge's bottom edge, close enough
  // that nothing else could plausibly sit between them, and roughly the same
  // right-edge alignment (both anchored to the video area's top-right corner).
  expect(hintBox.y, 'hint sits below the badge').toBeGreaterThan(badgeBox.y + badgeBox.height - 1);
  expect(hintBox.y - (badgeBox.y + badgeBox.height), 'gap is small (immediately below)').toBeLessThan(40);
  expect(Math.abs((hintBox.x + hintBox.width) - (badgeBox.x + badgeBox.width)), 'right edges roughly aligned')
    .toBeLessThan(20);
  await saveEvidence(page, 'criterion-1-hint-under-players-detected');
});

// AC2 + AC3 — visible with no frame selected; hides on select; reappears on deselect.
test('2) hint hides when a tracking frame is selected, reappears on deselect', async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator(HINT)).toBeVisible();
  await saveEvidence(page, 'criterion-2-hint-visible-no-frame-selected');

  await page.locator(FRAME_TOGGLE).click(); // select a tracking frame
  await expect(page.locator(FRAME_TOGGLE)).toHaveText('Frame: selected');
  await expect(page.locator(HINT)).toHaveCount(0, { timeout: 2000 });
  await saveEvidence(page, 'criterion-3-hint-hidden-frame-selected');

  await page.locator(FRAME_TOGGLE).click(); // deselect
  await expect(page.locator(FRAME_TOGGLE)).toHaveText('Frame: not selected');
  await expect(page.locator(HINT)).toBeVisible();
  await saveEvidence(page, 'criterion-3-hint-reappears-on-deselect');
});

// AC4 — no regression to T5610 gating (tracking off, or already-used override).
test('3) no regression to T5610 gating (tracking off / override already used)', async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator(HINT)).toBeVisible();

  await page.locator(TRACKING_TOGGLE).click(); // tracking OFF
  await expect(page.locator(TRACKING_TOGGLE)).toHaveText('Tracking: OFF');
  await expect(page.locator(HINT)).toHaveCount(0, { timeout: 2000 });
  await saveEvidence(page, 'criterion-4-hint-hidden-tracking-off');

  await page.locator(TRACKING_TOGGLE).click(); // tracking back ON
  await expect(page.locator(HINT)).toBeVisible();

  await page.locator(MARK_USED).click(); // override already used this session
  await expect(page.locator(HINT)).toHaveCount(0, { timeout: 2000 });
  await saveEvidence(page, 'criterion-4-hint-hidden-override-used');
});

// Responsive check on the changed surface.
test('4) responsive: no horizontal overflow at 375px and desktop', async ({ page }) => {
  await page.goto(HARNESS);
  await expect(page.locator(CONTAINER)).toBeVisible();
  await responsiveSweep(page);
});
