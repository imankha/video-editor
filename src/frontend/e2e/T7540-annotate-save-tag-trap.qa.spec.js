import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';
import { openAddClipForm, deleteClip } from './helpers/annotateClips.js';

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
 * T7810 (staging-gate phase 2): DISCOVERS an ACTIVE game with clips instead of
 * the old hardcoded game 6 / profile 9fa7378c, so it runs against ANY seeded
 * lane-B account (per-process E2E_REAL_EMAIL / E2E_REAL_PROFILE — see
 * scripts/staging-gate.sh). Tagged @gate-b: it does a real write (POST
 * /api/clips/raw/save) but SELF-CLEANS the created clip in afterEach (a failed
 * cleanup THROWS, so a stray test clip never lingers), which is why lane B —
 * which owns light writes — is safe for it.
 *
 * Proves, against the running app:
 *   - typed-but-not-Entered teammate name + click Save -> the save request FIRES
 *     (the old code never sent it) with the tag included in the payload, and no
 *     "Tag not submitted" dialog appears.
 *
 * Run: bash scripts/dev-verify.sh e2e/T7540-annotate-save-tag-trap.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE; // omit -> account's default profile
const API_BASE = process.env.E2E_API_BASE || '/api';
const PENDING_TAG = 'QA T7540 NoEnter';

test.use({ viewport: { width: 1280, height: 800 } });

test.describe('T7540 — Save auto-commits an uncommitted teammate tag (no dead-end)', () => {
  let clipId;

  test.beforeEach(async ({ context, page }) => {
    // openAddClipForm waits up to 120s for the (large) game-source MP4 to become
    // seekable before it can seek to a clip-free gap; the deployed 60s per-test
    // default would spuriously fail that legitimate cold load, and trimming the
    // gap-candidate scan would trade away gap-finding reliability on a densely
    // clipped game — so budget the seek+save cost explicitly rather than blindly.
    test.setTimeout(120000);

    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    // Discover an ACTIVE game WITH clips (mirror annotate-game-clock): a hardcoded
    // id could land on an EXPIRED/absent game on an alias lane-B account and hang
    // the whole per-test timeout. Skip LOUDLY if the account has none — never a
    // silent pass (CLAUDE.md: no silent fallback for a missing fixture).
    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
    if (!target) {
      console.log('[T7540][SKIP] account has no ACTIVE game with clips to add a clip into; seed one per FIXTURE-CONTRACT');
    }
    test.skip(!target, '[T7540] no active game with clips available to drive Add Clip');
    console.log(`[T7540] driving active game id=${target.id} (${target.opponent_name})`);

    await openGameInAnnotate(page, target.id);
    // Clips loaded before we can find a gap to add into.
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
    clipId = undefined;
  });

  test('type a teammate name, do NOT press Enter, click Save -> clip saves with the tag, no dialog @staging-gate @gate-b', async ({ page }) => {
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
