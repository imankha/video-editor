import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence, assertNoHorizontalOverflow } from './helpers/qa.js';
import { gotoGame, createClipViaUI, deleteClip } from './helpers/annotateClips.js';

/**
 * T5725 — Teammate tagging is Team-layer only: interactive REAL-BROWSER QA.
 *
 * Drives the REAL account (imankh@gmail.com, game 6) via dev-login. Every test
 * that CREATES a clip deletes it via context.request (SAME cookie jar as the
 * logged-in context) in afterEach; a failed cleanup THROWS (loud, not swallowed)
 * so a stray test clip never lingers in the real account.
 *
 * Proves, against the running app:
 *   - the Teammates control is ABSENT on a My Athlete clip and PRESENT on a Team
 *     clip (desktop AND mobile);
 *   - tagging a teammate works on a Team clip;
 *   - switching a tagged clip TO My Athlete clears the tags in the SAME surgical
 *     write (PUT {my_athlete:true, tagged_teammates:[]}) and the control (with
 *     its chips) visibly disappears — the clear-on-switch decision.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5725-teammates-team-only.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const apiBase = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } });

const teammatesLabel = (scope) => scope.getByText('Teammates', { exact: true });

// T6760: fail fast + loud if game GAME_ID's source storage has drifted/expired,
// instead of hanging the full 300s per-test timeout on an Annotate screen that never
// mounts a <video>. See helpers/fixtureGuard.js + docs/testing/derisk-plan-2026-08-11.md.
test.beforeAll(async ({ request }) => {
  await assertGameStorageActive(request, GAME_ID, { email: REAL_EMAIL, apiBase });
});

test.describe('T5725 — desktop: Teammates control gating + clear-on-switch', () => {
  let clipId;

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    clipId = await createClipViaUI(page); // My Athlete default
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
  });

  test('absent on My Athlete, present on Team, tagging works, and switching to My Athlete clears tags', async ({ page }) => {
    const editor = page.locator('[data-clip-details]');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor.getByRole('radio', { name: 'My Athlete layer' })).toHaveAttribute('aria-checked', 'true');

    // (1) Absent on a My Athlete clip.
    await expect(teammatesLabel(editor)).toHaveCount(0);
    await saveEvidence(page, 'criterion-teammates-absent-my-athlete-desktop');

    // (2) Switch to Team -> control appears.
    await editor.getByRole('radio', { name: 'Team layer' }).click();
    await expect(teammatesLabel(editor)).toBeVisible();
    await saveEvidence(page, 'criterion-teammates-present-team-desktop');

    // (3) Tag a teammate -> surgical PUT persists it.
    const tagInput = editor.getByPlaceholder('Tag a teammate...');
    await tagInput.fill('QA Teammate');
    const [tagPut] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      tagInput.press('Enter'),
    ]);
    expect(tagPut.postDataJSON()).toEqual({ tagged_teammates: ['QA Teammate'] });
    await expect(editor.getByText('QA Teammate')).toBeVisible();

    // (4) Switch back to My Athlete -> tags cleared in the SAME write, control gone.
    const [clearPut] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      editor.getByRole('radio', { name: 'My Athlete layer' }).click(),
    ]);
    expect(clearPut.postDataJSON()).toEqual({ my_athlete: true, tagged_teammates: [] });
    await expect(teammatesLabel(editor)).toHaveCount(0);
    await expect(editor.getByText('QA Teammate')).toHaveCount(0);
    await saveEvidence(page, 'criterion-clear-on-switch-desktop');
    // Persistence (not just a hidden control) is proven by the clearPut payload
    // asserted above — the tag clear rides the same surgical PUT as the layer
    // switch, so there is no separate reactive write to reload-verify.
  });
});

test.describe('T5725 — mobile (390px): Teammates control gating', () => {
  let clipId;

  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    clipId = await createClipViaUI(page); // My Athlete default
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
  });

  test('mobile detail editor: teammates absent on My Athlete, present on Team', async ({ page }) => {
    // Open the mobile clips drawer and view the just-created clip's details.
    // On mobile a clip row's own onClick is disabled; details open via the
    // per-row "View details" button (ClipListItem, isMobile branch).
    await page.locator('button[title="Show clips"]').click();
    await page.locator('button[title="View details"]:visible').first().click();

    // The CSS-hidden desktop ClipsSidePanel (`hidden sm:flex`) stays mounted at
    // 390px, so [data-clip-details] matches twice — scope to the visible one.
    const editor = page.locator('[data-clip-details]:visible');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Absent on My Athlete (mobile).
    await expect(teammatesLabel(editor)).toHaveCount(0);
    await saveEvidence(page, 'criterion-teammates-absent-my-athlete-mobile');

    // Present on Team (mobile) — the !isMobile gate is gone.
    await editor.getByRole('radio', { name: 'Team layer' }).click();
    await expect(teammatesLabel(editor)).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-teammates-present-team-mobile');

    // Back to My Athlete hides it again.
    await editor.getByRole('radio', { name: 'My Athlete layer' }).click();
    await expect(teammatesLabel(editor)).toHaveCount(0);
  });
});
