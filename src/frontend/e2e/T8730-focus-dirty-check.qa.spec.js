import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8730 — Focus button dirty-check: interactive REAL-BROWSER QA.
 *
 * The fix: the strip's Focus button (desktop, `layout="strip"`, edit mode with
 * existingClip.autoProjectId set) used to ALWAYS show "Save this play first?"
 * regardless of whether anything changed. `hasUnsavedEdits()` now compares the
 * values Save would persist against the loaded clip so the dialog only fires on
 * a REAL change.
 *
 * This spec stress-tests for the failure mode that matters most: a FALSE
 * NEGATIVE (a real edit that the dirty-check fails to detect), which would let
 * Focus navigate away and silently discard the edit. It drives every field
 * named in the task file — rating, name, notes, teammates — one at a time
 * against a REAL clip that already has a reel (auto_project_id set, required
 * for the Focus button to render), plus the no-edit false-positive path.
 *
 * SAFE BY CONSTRUCTION: every dirty-path case clicks "Cancel" on the confirm
 * dialog, never "Save & open Focus" / "Update" — so the target clip's real
 * data in Postgres/SQLite is never mutated. The no-edit case clicks Focus
 * with a completely untouched form, which also sends no write.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8730-focus-dirty-check.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } }); // desktop width -> strip layout renders

const DIALOG_TITLE = 'Save this play first?';

test.describe('T8730 — Focus button dirty-check: no false negatives, no false positives', () => {
  let targetClip;

  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(90000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    // Discover a clip that already HAS a reel (auto_project_id set) — the Focus
    // button only renders for such clips. Skip loudly if none exist rather than
    // hardcoding an id that could be stale/deleted on a different lane account.
    const res = await context.request.get(`${API_BASE}/clips/raw?game_id=${GAME_ID}`, {
      headers: { 'X-Profile-ID': PROFILE },
    });
    expect(res.ok(), `GET ${API_BASE}/clips/raw?game_id=${GAME_ID} (${res.status()})`).toBeTruthy();
    const clips = await res.json();
    targetClip = clips.find((c) => c.auto_project_id);
    if (!targetClip) {
      console.log(`[T8730][SKIP] game ${GAME_ID} has no clip with a reel (auto_project_id) to drive Focus`);
    }
    test.skip(!targetClip, `[T8730] no reel-backed clip available in game ${GAME_ID}`);
    console.log(`[T8730] driving clip id=${targetClip.id} "${targetClip.name}" (reel ${targetClip.auto_project_id})`);

    await openGameInAnnotate(page, GAME_ID);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });

    // The video autoplays on load. AnnotateContainer auto-DESELECTS a SELECTED
    // (not yet EDITING) clip the instant the playhead drifts outside its
    // start/end range -- so a playing video racing the click below intermittently
    // wiped the selection before "Edit Play" could be clicked. Pause first.
    await page.locator('video').first().evaluate((v) => v.pause());

    // Select the target clip via its sidebar row (desktop: whole row clickable)
    // -- this only moves selection to SELECTED, it does NOT open the editor.
    const row = page.locator('[data-testid="clip-row"]', { hasText: targetClip.name }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    await row.click();

    // The primary CTA flips from "Add Play" to "Edit Play" once a clip is
    // SELECTED (AnnotateModeView.jsx:889); clicking it opens the strip editor
    // (EDITING state -> showAnnotateOverlay=true -> desktopEditorOpen strip).
    const editButton = page.getByRole('button', { name: 'Edit Play' });
    await expect(editButton).toBeVisible({ timeout: 10000 });
    await editButton.click();

    // The strip editor mounts with the Focus button once the clip is being edited.
    await expect(page.getByTestId('annotate-editor-strip')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTitle('Open in Focus mode')).toBeVisible({ timeout: 10000 });
  });

  test('no edits: Focus navigates directly, no confirm dialog @staging-gate @gate-a', async ({ page }) => {
    // Untouched form -> click Focus immediately.
    await page.getByTitle('Open in Focus mode').click();
    await page.waitForTimeout(500); // let a (wrongly shown) dialog have time to mount
    await expect(page.getByText(DIALOG_TITLE)).toHaveCount(0);
    await saveEvidence(page, 'T8730-no-dialog-when-clean');
  });

  test('rating change is detected as dirty @staging-gate @gate-a', async ({ page }) => {
    // Change rating via the strip's star control (title="N stars").
    const currentRating = targetClip.rating || 3;
    const newRating = currentRating === 5 ? 4 : 5;
    await page.getByTitle(`${newRating} star${newRating > 1 ? 's' : ''}`).click();

    await page.getByTitle('Open in Focus mode').click();
    await expect(page.getByText(DIALOG_TITLE)).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T8730-dirty-rating');
    await page.getByText('Opening Focus closes the Annotate editor.').locator('xpath=ancestor::div[contains(@class,"bg-gray-800")]').getByRole('button', { name: 'Cancel' }).click(); // never save
    await expect(page.getByText(DIALOG_TITLE)).toHaveCount(0);
  });

  test('name edit is detected as dirty @staging-gate @gate-a', async ({ page }) => {
    const nameInput = page.getByLabel('Clip name');
    await expect(nameInput).toBeVisible();
    await nameInput.fill(`${targetClip.name} EDITED T8730`);

    await page.getByTitle('Open in Focus mode').click();
    await expect(page.getByText(DIALOG_TITLE)).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T8730-dirty-name');
    await page.getByText('Opening Focus closes the Annotate editor.').locator('xpath=ancestor::div[contains(@class,"bg-gray-800")]').getByRole('button', { name: 'Cancel' }).click();
  });

  test('notes edit is detected as dirty @staging-gate @gate-a', async ({ page }) => {
    // Notes live behind "Add details" / "Details (...)" on the strip.
    await page.getByTestId('add-details-button').click();
    const notesBox = page.getByLabel('Notes (optional)');
    await expect(notesBox).toBeVisible({ timeout: 5000 });
    await notesBox.fill('T8730 QA note - not saved');

    await page.getByTitle('Open in Focus mode').click();
    await expect(page.getByText(DIALOG_TITLE)).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T8730-dirty-notes');
    await page.getByText('Opening Focus closes the Annotate editor.').locator('xpath=ancestor::div[contains(@class,"bg-gray-800")]').getByRole('button', { name: 'Cancel' }).click();
  });

  test('teammate tag (typed AND Enter-committed) is detected as dirty @staging-gate @gate-a', async ({ page }) => {
    // Teammates require the Team layer.
    await page.getByRole('radio', { name: 'Team layer' }).click();
    const tagInput = page.getByPlaceholder('Tag a teammate...');
    await expect(tagInput).toBeVisible({ timeout: 5000 });
    await tagInput.fill('T8730 QA Teammate');
    await tagInput.press('Enter');

    await page.getByTitle('Open in Focus mode').click();
    await expect(page.getByText(DIALOG_TITLE)).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T8730-dirty-teammate-committed');
    await page.getByText('Opening Focus closes the Annotate editor.').locator('xpath=ancestor::div[contains(@class,"bg-gray-800")]').getByRole('button', { name: 'Cancel' }).click();
  });

  test('teammate tag typed but NOT Enter-committed is still detected as dirty @staging-gate @gate-a', async ({ page }) => {
    // Regression guard for the specific false-negative risk called out in
    // review: a pending (un-Entered) teammate must still count as dirty.
    await page.getByRole('radio', { name: 'Team layer' }).click();
    const tagInput = page.getByPlaceholder('Tag a teammate...');
    await expect(tagInput).toBeVisible({ timeout: 5000 });
    await tagInput.fill('T8730 QA Pending NoEnter'); // deliberately no Enter press

    await page.getByTitle('Open in Focus mode').click();
    await expect(page.getByText(DIALOG_TITLE)).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'T8730-dirty-teammate-pending-not-entered');
    await page.getByText('Opening Focus closes the Annotate editor.').locator('xpath=ancestor::div[contains(@class,"bg-gray-800")]').getByRole('button', { name: 'Cancel' }).click();
  });

  test('dialog copy says "Annotate", not "the play editor" @staging-gate @gate-a', async ({ page }) => {
    await page.getByLabel('Clip name').fill(`${targetClip.name} EDITED`);
    await page.getByTitle('Open in Focus mode').click();
    await expect(page.getByText('Opening Focus closes the Annotate editor.')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText(/play editor/i)).toHaveCount(0);
    await page.getByText('Opening Focus closes the Annotate editor.').locator('xpath=ancestor::div[contains(@class,"bg-gray-800")]').getByRole('button', { name: 'Cancel' }).click();
  });
});
