import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T6400 — Drop the "New clips go to" toggle; a new clip inherits the LAST layer
 * the user assigned. REAL-BROWSER QA (jsdom gives false confidence on this kind
 * of create -> select -> re-open-form interaction, T5380).
 *
 * Drives the REAL account (imankh@gmail.com) via dev-login. Needs a game whose
 * source video is STILL ACTIVE (not storage-expired — an expired game shows the
 * "Source video expired" panel with no <video>, so clip creation can't run).
 * Override E2E_GAME_ID to point at an active game with an empty stretch before
 * its first real clip (the seek spots 30 / 90 must fall outside any real clip).
 * Every created clip is deleted in afterEach through `context.request` (SAME
 * cookie jar as the logged-in context — the bare `request` fixture 401s on
 * cleanup, a real data-safety hazard). A failed cleanup THROWS (loud, not swallowed).
 *
 * Run: E2E_GAME_ID=<active game> bash scripts/dev-verify.sh e2e/T6400-inherit-last-clip-layer.qa.spec.js
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';
const GAME_ID = Number(process.env.E2E_GAME_ID || 6);
const apiBase = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1280, height: 800 } });

async function gotoGame(page) {
  await openGameInAnnotate(page, GAME_ID);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
}

/** Seek to a spot outside any real clip so "Add Clip" (not "Edit Clip") shows. */
// T7730: resolve a clip-FREE seek time before opening the add-clip affordance.
// The "Add clip" button is intentionally hidden while the playhead sits inside
// an existing clip, so a hardcoded seekTime that happens to land on a clip (e.g.
// a leaked/stray clip left by an earlier run) makes this helper hang on the full
// actionability timeout. Query the game's REAL clip ranges and nudge past any
// that cover the requested time, rather than trusting the fixed offset.
async function resolveClipFreeSeekTime(page, desiredTime) {
  let clips = [];
  try {
    const res = await page.request.get(`${apiBase}/clips/raw?game_id=${GAME_ID}`, { headers: { 'X-Profile-ID': PROFILE_ID } });
    if (res.ok()) clips = await res.json();
  } catch { /* query failed -- fall back to the requested time */ }
  const ranges = clips
    .filter((c) => c.start_time != null && c.end_time != null)
    .map((c) => [Number(c.start_time), Number(c.end_time)])
    .sort((a, b) => a[0] - b[0]);
  const PAD = 1; // stay clear of clip edges so the playhead is unambiguously free
  const covered = (t) => ranges.some(([s, e]) => t >= s - PAD && t <= e + PAD);
  if (!covered(desiredTime)) return desiredTime;
  for (let t = desiredTime; t < desiredTime + 120; t += 0.5) {
    const r = Math.round(t * 10) / 10;
    if (!covered(r)) return r;
  }
  return desiredTime; // give up gracefully; the Escape fallback below still applies
}

async function ensureAddClipVisible(page, seekTime) {
  const freeTime = await resolveClipFreeSeekTime(page, seekTime);
  await page.locator('video').first().evaluate((v, t) => { v.currentTime = t; if (!v.paused) v.pause(); }, freeTime);
  await page.waitForTimeout(500);
  const addBtn = page.locator('button[title="Add clip ending at current time (A)"]:visible').first();
  if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) return addBtn;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await expect(addBtn).toBeVisible({ timeout: 10000 });
  return addBtn;
}

/** Open the add-clip form (does NOT touch the Layer control — we inspect it). */
async function openAddClipForm(page, seekTime) {
  const addBtn = await ensureAddClipVisible(page, seekTime);
  await addBtn.click();
  const form = page.locator('[data-add-clip-form]:visible');
  await expect(form).toBeVisible({ timeout: 5000 });
  return form;
}

/** Save the open add-clip form; returns the created raw_clip_id. */
async function saveClipForm(page, form) {
  const [saveResp] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/clips/raw/save') && res.request().method() === 'POST'),
    form.locator('button.bg-green-600:has-text("Save")').click(),
  ]);
  return (await saveResp.json()).raw_clip_id;
}

/**
 * Flip the currently-selected clip's layer via its per-clip control. Idempotent:
 * if it's already on `layerName` (the inherited default may already match) we do
 * nothing rather than wait for a PUT that never fires.
 */
async function setSelectedClipLayer(page, layerName) {
  const editor = page.locator('[data-clip-details]:visible');
  await expect(editor).toBeVisible({ timeout: 5000 });
  const radio = editor.getByRole('radio', { name: layerName });
  if ((await radio.getAttribute('aria-checked')) === 'true') return;
  await Promise.all([
    page.waitForRequest((req) => /\/api\/clips\/raw\/\d+/.test(req.url()) && req.method() === 'PUT'),
    radio.click(),
  ]);
  await expect(radio).toHaveAttribute('aria-checked', 'true');
}

async function deleteClip(context, rawClipId) {
  if (!rawClipId) return;
  const res = await context.request.delete(`${apiBase}/clips/raw/${rawClipId}`, { headers: { 'X-Profile-ID': PROFILE_ID } });
  if (!res.ok()) {
    throw new Error(`[T6400 cleanup] FAILED to delete test clip ${rawClipId} (${res.status()}) — a stray clip may remain in the real account. Delete it manually: DELETE /api/clips/raw/${rawClipId}`);
  }
}

// T6760: fail fast + loud if game GAME_ID's source storage has drifted/expired,
// instead of hanging the full 300s per-test timeout on an Annotate screen that never
// mounts a <video>. This spec's own header already warns it needs an ACTIVE game.
// See helpers/fixtureGuard.js + docs/testing/derisk-plan-2026-08-11.md.
test.beforeAll(async ({ request }) => {
  await assertGameStorageActive(request, GAME_ID, { email: REAL_EMAIL, apiBase });
});

test.describe('T6400 — new clip inherits the last assigned layer (no mode toggle)', () => {
  let createdIds = [];

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    createdIds = [];
  });

  test.afterEach(async ({ context }) => {
    for (const id of createdIds) await deleteClip(context, id);
  });

  test('the "New clips go to" toggle is GONE from the sidebar', async ({ page }) => {
    await expect(page.getByText('New clips go to:')).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'New clips go to' })).toHaveCount(0);
    await saveEvidence(page, 'criterion-no-mode-toggle');
  });

  test('assign a clip to Team, then a NEW clip inherits Team (the "set to" case)', async ({ page }) => {
    // Clip A — save with whatever the game seeds; then assign it to Team.
    const formA = await openAddClipForm(page, 30);
    createdIds.push(await saveClipForm(page, formA));
    await setSelectedClipLayer(page, 'Team layer');

    // Clip B — the add-clip form must already show Team as the inherited default.
    const formB = await openAddClipForm(page, 90);
    await expect(formB.getByRole('radio', { name: 'Team layer' })).toHaveAttribute('aria-checked', 'true');
    createdIds.push(await saveClipForm(page, formB));

    // And B actually lands on Team: its per-clip editor + an amber Team marker.
    await expect(page.locator('[data-clip-details]:visible').getByRole('radio', { name: 'Team layer' }))
      .toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
    await expect(page.locator('[data-testid="clip-row"] [aria-label="Team layer"]').first()).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'criterion-inherit-team');
  });

  test('assign a clip to My Athlete, then a NEW clip inherits My Athlete', async ({ page }) => {
    const formA = await openAddClipForm(page, 30);
    createdIds.push(await saveClipForm(page, formA));
    // Prove inheritance both ways: first push it to Team, then to My Athlete, so
    // the final default is unambiguously the LAST assignment, not a stale seed.
    await setSelectedClipLayer(page, 'Team layer');
    await setSelectedClipLayer(page, 'My Athlete layer');

    const formB = await openAddClipForm(page, 90);
    await expect(formB.getByRole('radio', { name: 'My Athlete layer' })).toHaveAttribute('aria-checked', 'true');
    createdIds.push(await saveClipForm(page, formB));

    await expect(page.locator('[data-clip-details]:visible').getByRole('radio', { name: 'My Athlete layer' }))
      .toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
    await saveEvidence(page, 'criterion-inherit-my-athlete');
  });
});
