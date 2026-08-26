import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence } from './helpers/qa.js';
import { gotoGame } from './helpers/annotateClips.js';

/**
 * T6400 — Drop the "New clips go to" toggle; a new clip inherits the LAST layer
 * the user assigned. REAL-BROWSER QA.
 *
 * T7770: the two inherit-from-previous tests that used to live here (assign Team
 * then a new clip inherits Team; assign My Athlete then inherit My Athlete) were
 * MERGED into T5700-team-layer-interactive.qa.spec.js's "add-clip form layer"
 * describe block, alongside the explicit-set tests they overlap with — both drive
 * the SAME add-clip-form Layer control + landing lane, differing only in how the
 * layer is decided. Only the unique "toggle is gone" absence assertion remains
 * here; it creates no clips, so this spec no longer needs the clip helpers.
 *
 * Drives the REAL account (imankh@gmail.com) via dev-login. Needs a game whose
 * source video is STILL ACTIVE (an expired game shows the "Source video expired"
 * panel with no <video>).
 *
 * Run: E2E_GAME_ID=<active game> bash scripts/dev-verify.sh e2e/T6400-inherit-last-clip-layer.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const apiBase = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } });

// T6760: fail fast + loud if game GAME_ID's source storage has drifted/expired,
// instead of hanging the full 300s per-test timeout on an Annotate screen that never
// mounts a <video>. This spec's own header already warns it needs an ACTIVE game.
// See helpers/fixtureGuard.js + docs/testing/derisk-plan-2026-08-11.md.
test.beforeAll(async ({ request }) => {
  await assertGameStorageActive(request, GAME_ID, { email: REAL_EMAIL, apiBase });
});

test.describe('T6400 — new clip inherits the last assigned layer (no mode toggle)', () => {
  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
  });

  test('the "New clips go to" toggle is GONE from the sidebar', async ({ page }) => {
    await expect(page.getByText('New clips go to:')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'New clips go to' })).toHaveCount(0);
    await saveEvidence(page, 'criterion-no-mode-toggle');
  });
});
