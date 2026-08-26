import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';
import { gotoGame, createClipViaUI, deleteClip } from './helpers/annotateClips.js';

/**
 * T5700 follow-up — two clip lanes ("My Athlete" / "Team") on desktop, collapsing
 * to the original single tinted track on phones.
 *
 * Drives the REAL account (imankh@gmail.com, game 6) via dev-login, same pattern
 * as T5700-team-layer-interactive.qa.spec.js. Every test that CREATES a clip
 * deletes it via context.request in afterEach (same cookie jar as the logged-in
 * browser context).
 *
 * Run: bash scripts/dev-verify.sh e2e/T5700-two-lanes.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const apiBase = process.env.E2E_API_BASE || '/api';

// Second-clip gap candidates: far enough from the first clip's gap (~10s) that
// the two created markers are distinct lanes/positions.
const SECOND_CLIP_GAPS = { candidates: [45, 90, 120, 60] };

// T6760: fail fast + loud if game GAME_ID's source storage has drifted/expired,
// instead of hanging the full 300s per-test timeout on an Annotate screen that never
// mounts a <video>. See helpers/fixtureGuard.js + docs/testing/derisk-plan-2026-08-11.md.
test.beforeAll(async ({ request }) => {
  await assertGameStorageActive(request, GAME_ID, { email: REAL_EMAIL, apiBase });
});

test.describe('T5700 follow-up — desktop two-lane split', () => {
  let mineId, teamId;

  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    mineId = await createClipViaUI(page, 'My Athlete layer');
    teamId = await createClipViaUI(page, 'Team layer', SECOND_CLIP_GAPS); // distinct gap so it's a separate marker
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, mineId);
    await deleteClip(context, teamId);
  });

  test('QA1: two labeled lanes render, each clip lands in its own lane', async ({ page }) => {
    const mineLabel = page.getByTestId('clip-lane-label-mine');
    const teamLabel = page.getByTestId('clip-lane-label-team');
    await expect(mineLabel).toBeVisible();
    await expect(teamLabel).toBeVisible();
    await expect(mineLabel).toContainText('My Athlete');
    await expect(teamLabel).toContainText('Team');

    const mineLane = page.getByTestId('clip-lane-mine');
    const teamLane = page.getByTestId('clip-lane-team');
    // The just-created My Athlete clip's marker is in the mine lane, not the team lane.
    expect(await mineLane.locator('.clip-marker').count()).toBeGreaterThanOrEqual(1);
    expect(await teamLane.locator('.clip-marker').count()).toBeGreaterThanOrEqual(1);

    await saveEvidence(page, 'criterion-two-lanes-desktop');
  });

  test('QA4: clicking a marker in EITHER lane selects it and opens its editor', async ({ page }) => {
    const mineLane = page.getByTestId('clip-lane-mine');
    const teamLane = page.getByTestId('clip-lane-team');

    await mineLane.locator('.clip-marker').first().click();
    await expect(page.locator('[data-clip-details]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-clip-details]').getByRole('radio', { name: 'My Athlete layer' }))
      .toHaveAttribute('aria-checked', 'true');

    await teamLane.locator('.clip-marker').first().click();
    await expect(page.locator('[data-clip-details]').getByRole('radio', { name: 'Team layer' }))
      .toHaveAttribute('aria-checked', 'true', { timeout: 5000 });

    await saveEvidence(page, 'criterion-select-both-lanes');
  });
});

// T7770: QA2 (390px portrait single-track) deleted — it was a strict subset of
// QA3 below (landscape single-track, which asserts the same single-track collapse
// AND adds the T4933 delete-button-reachable case). Portrait single-track is also
// covered incidentally by the mobile-390 create tests in T5700-team.
test.describe('T5700 follow-up — landscape phone (T4933 case) stays usable', () => {
  // iPhone 14 landscape: 844x390 — the exact T4933 landmine viewport (width >=640
  // trips the desktop `sm:flex` sidebar, but is still < useIsMobile's 1024px cutoff
  // so the Annotate timeline itself stays single-lane).
  test.use({ viewport: { width: 844, height: 390 } });

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
  });

  test('QA3: single track (not two lanes) and sidebar bottom controls stay reachable', async ({ page }) => {
    await expect(page.getByTestId('clip-track-mobile')).toBeVisible();
    await expect(page.getByTestId('clip-lane-mine')).toHaveCount(0);
    await expect(page.getByTestId('clip-lane-team')).toHaveCount(0);

    // Select a clip so the tall ClipDetailsEditor mounts (T4933 repro needs this —
    // an empty-clip game hides the bug per annotate.md). Select via the clip-list
    // row, not the timeline `.clip-marker` — the marker's `hover:scale-110`
    // transition never settles for Playwright's actionability check against this
    // densely-packed 32-clip landscape timeline (unrelated to this diff; the list
    // row is a plain, stable click target). T6400: My Athlete rows carry no `title`
    // marker by design (only the Team layer does), so `getByTitle('My Athlete
    // layer')` never resolved — use the stable clip-item row testid.
    await page.getByTestId('clip-item').first().click();
    const editor = page.locator('[data-clip-details]');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // T4933 fix is "reachable via the pane's own scroll region", not "on-screen
    // without scrolling" — scroll it into view (as a real user would) and assert
    // it lands in the viewport, rather than asserting zero-scroll visibility.
    const deleteBtn = page.getByRole('button', { name: 'Delete Clip' });
    await deleteBtn.scrollIntoViewIfNeeded();
    await expect(deleteBtn).toBeInViewport();

    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-landscape-phone-not-clipped');
  });
});

test.describe('T5700 follow-up — responsive sweep', () => {
  test.beforeEach(async ({ context }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
  });

  test('Annotate screen: no horizontal overflow at 375px or desktop, with the two-lane layout live', async ({ page }) => {
    await gotoGame(page);
    await responsiveSweep(page, async (vp) => {
      if (vp.name === 'desktop-1280') {
        await expect(page.getByTestId('clip-lane-label-mine')).toBeVisible();
        await expect(page.getByTestId('clip-lane-label-team')).toBeVisible();
      } else {
        await expect(page.getByTestId('clip-track-mobile')).toBeVisible();
      }
    });
  });
});
