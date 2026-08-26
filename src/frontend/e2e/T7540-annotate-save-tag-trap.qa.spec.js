import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence } from './helpers/qa.js';
import { gotoGame, openAddClipForm, deleteClip } from './helpers/annotateClips.js';

/**
 * T7540 — Add Clip Save no longer dead-ends on an uncommitted teammate tag:
 * interactive REAL-BROWSER QA.
 *
 * The bug: typing a teammate name in the Add/Edit overlay and clicking Save
 * WITHOUT pressing Enter first used to show an OK-only "Tag not submitted"
 * dialog and return without saving — clicking Save again re-triggered it, a
 * genuine dead-end. The fix auto-commits the pending text (same as Enter) and
 * saves.
 *
 * Drives the REAL account (imankh@gmail.com, game 6) via dev-login. The created
 * clip is deleted via context.request (SAME cookie jar) in afterEach; a failed
 * cleanup THROWS so a stray test clip never lingers in the real account.
 *
 * Proves, against the running app:
 *   - typed-but-not-Entered teammate name + click Save -> the save request FIRES
 *     (the old code never sent it) with the tag included in the payload, and no
 *     "Tag not submitted" dialog appears.
 *
 * Run: bash scripts/dev-verify.sh e2e/T7540-annotate-save-tag-trap.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const apiBase = process.env.E2E_API_BASE || '/api';
const PENDING_TAG = 'QA T7540 NoEnter';

test.use({ viewport: { width: 1280, height: 800 } });

// Fail fast + loud if game GAME_ID's source storage has drifted/expired, instead
// of hanging the full per-test timeout on an Annotate screen that never mounts a
// <video>. Same guard the T5725 spec uses.
test.beforeAll(async ({ request }) => {
  await assertGameStorageActive(request, GAME_ID, { email: REAL_EMAIL, apiBase });
});

test.describe('T7540 — Save auto-commits an uncommitted teammate tag (no dead-end)', () => {
  let clipId;

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    // openAddClipForm (shared helper) waits for the <video> to be seekable itself.
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
    clipId = undefined;
  });

  test('type a teammate name, do NOT press Enter, click Save -> clip saves with the tag, no dialog', async ({ page }) => {
    const form = await openAddClipForm(page);

    // Ensure the clip is on the Team layer so the Teammates field renders.
    await form.getByRole('radio', { name: 'Team layer' }).click();
    const tagInput = form.getByPlaceholder('Tag a teammate...');
    await expect(tagInput).toBeVisible({ timeout: 5000 });

    // Type WITHOUT pressing Enter — this is the trap condition.
    await tagInput.fill(PENDING_TAG);
    await saveEvidence(page, 'criterion-pending-tag-typed-not-entered');

    // Click Save: the old code would show "Tag not submitted" and send nothing.
    const [saveResp] = await Promise.all([
      page.waitForResponse((res) => res.url().includes('/api/clips/raw/save') && res.request().method() === 'POST', { timeout: 10000 }),
      form.locator('button.bg-green-600:has-text("Save")').click(),
    ]);

    // The save actually fired and succeeded — no dead-end.
    expect(saveResp.ok()).toBeTruthy();
    clipId = (await saveResp.json()).raw_clip_id;
    expect(clipId).toBeTruthy();

    // The pending tag was auto-committed into the saved payload.
    const sentBody = saveResp.request().postDataJSON();
    expect(sentBody.tagged_teammates).toContain(PENDING_TAG);

    // The old OK-only dead-end dialog must never appear.
    await expect(page.getByText('Tag not submitted')).toHaveCount(0);
    await saveEvidence(page, 'criterion-saved-with-tag-no-dialog');
  });
});
