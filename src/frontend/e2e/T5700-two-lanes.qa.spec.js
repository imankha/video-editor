import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

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

async function gotoGame(page) {
  await openGameInAnnotate(page, GAME_ID);
  await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
}

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

// T6400: the "New clips go to" mode toggle is gone — a clip's layer is chosen on
// the clip itself. Set it directly in the add-clip form's Layer control before
// saving (idempotent: skip the click if the inherited default already matches).
async function createClipViaUI(page, seekTime, layerName) {
  const addBtn = await ensureAddClipVisible(page, seekTime);
  await addBtn.click();
  const form = page.locator('[data-add-clip-form]:visible');
  await expect(form).toBeVisible({ timeout: 5000 });
  if (layerName) {
    const radio = form.getByRole('radio', { name: layerName });
    if ((await radio.getAttribute('aria-checked')) !== 'true') await radio.click();
    await expect(radio).toHaveAttribute('aria-checked', 'true');
  }
  const [saveResp] = await Promise.all([
    page.waitForResponse((res) => res.url().includes('/api/clips/raw/save') && res.request().method() === 'POST'),
    form.locator('button.bg-green-600:has-text("Save")').click(),
  ]);
  const body = await saveResp.json();
  return body.raw_clip_id;
}

async function deleteClip(context, rawClipId) {
  if (!rawClipId) return;
  const res = await context.request.delete(`${apiBase}/clips/raw/${rawClipId}`, { headers: { 'X-Profile-ID': PROFILE_ID } });
  if (!res.ok()) {
    throw new Error(`[T5700 two-lanes cleanup] FAILED to delete test clip ${rawClipId} (${res.status()}) — a stray clip may remain in the real account. Delete it manually: DELETE /api/clips/raw/${rawClipId}`);
  }
}

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
    mineId = await createClipViaUI(page, 1, 'My Athlete layer');
    teamId = await createClipViaUI(page, 60, 'Team layer'); // spaced apart so it's a distinct marker
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

test.describe('T5700 follow-up — phone collapses to single track', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
  });

  test('QA2: 390px shows the single tinted Clips track, not two lanes', async ({ page }) => {
    await expect(page.getByTestId('clip-track-mobile')).toBeVisible();
    await expect(page.getByTestId('clip-lane-mine')).toHaveCount(0);
    await expect(page.getByTestId('clip-lane-team')).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-single-track-390');
  });
});

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
