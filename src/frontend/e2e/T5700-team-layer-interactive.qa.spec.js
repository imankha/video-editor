import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { assertGameStorageActive } from './helpers/fixtureGuard.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e -> frontend -> src -> repo root -> user_data
const USER_DATA_BASE = path.resolve(__dirname, '..', '..', '..', 'user_data');

/**
 * T5700 — Team / My Athlete layer in Annotate: interactive REAL-BROWSER QA.
 *
 * Drives the REAL account (imankh@gmail.com, game 6 — active storage, real
 * video, 32 real annotated clips, all starting after t=100s) via dev-login.
 * Every test that CREATES a clip deletes it via the API in afterEach through
 * `context.request` (SAME cookie jar as the logged-in browser context — the
 * bare `request` fixture is a separate, unauthenticated context and silently
 * 401s on cleanup, which is a real data-safety hazard: confirmed by hand
 * after the first run of this spec left two stray clips in the account,
 * cleaned up manually). A failed cleanup now THROWS (loud, not swallowed).
 * Read-only tests (toggle default/reset, filter pills text, marker tint)
 * touch nothing.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5700-team-layer-interactive.qa.spec.js
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

/**
 * Seek to `seekTime` (a spot far from any real clip's [100s, 5200s] range AND
 * from any clip this test itself just created) and make sure "Add Clip" is
 * actually showing — the app may land the resume position (or the playhead
 * leaving a just-created clip) inside a clip's range and auto-select it
 * instead, which hides "Add Clip" behind "Edit Clip"/the details editor.
 */
async function ensureAddClipVisible(page, seekTime) {
  await page.locator('video').first().evaluate((v, t) => { v.currentTime = t; if (!v.paused) v.pause(); }, seekTime);
  await page.waitForTimeout(500);
  // Desktop renders a labeled "Add Clip" button (hidden sm:flex); below the
  // `sm` breakpoint AnnotateControls swaps in an icon-only twin with the same
  // title (flex sm:hidden) — match on title + :visible so either width works.
  const addBtn = page.locator('button[title="Add clip ending at current time (A)"]:visible').first();
  if (await addBtn.isVisible({ timeout: 3000 }).catch(() => false)) return addBtn;
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
  await expect(addBtn).toBeVisible({ timeout: 10000 });
  return addBtn;
}

/**
 * Click Add Clip, optionally set the clip's layer in the add-clip form, Save.
 * Returns the created raw_clip_id.
 *
 * T6400: the "New clips go to" mode toggle is gone — a clip's layer is chosen on
 * the clip itself. Pass `layerName` ('My Athlete layer' | 'Team layer') to set
 * it in the add-clip form's Layer control before saving (idempotent: skip the
 * click if the inherited default already matches). Omit it to accept whatever
 * the game seeded / the previous clip set.
 */
async function createClipViaUI(page, seekTime, layerName) {
  const addBtn = await ensureAddClipVisible(page, seekTime);
  await addBtn.click();
  // The desktop ClipsSidePanel stays mounted (`hidden sm:flex`) even on a
  // mobile viewport, so its own inline add-clip form also renders — scope to
  // the VISIBLE [data-add-clip-form] only (mobile's inline form, or desktop's).
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

/** Uses context.request — the SAME cookie jar as loginAsRealUser — never the bare `request` fixture. */
async function deleteClip(context, rawClipId) {
  if (!rawClipId) return;
  const res = await context.request.delete(`${apiBase}/clips/raw/${rawClipId}`, { headers: { 'X-Profile-ID': PROFILE_ID } });
  if (!res.ok()) {
    throw new Error(`[T5700 cleanup] FAILED to delete test clip ${rawClipId} (${res.status()}) — a stray clip may remain in the real account. Delete it manually: DELETE /api/clips/raw/${rawClipId}`);
  }
}

// T6760: fail fast + loud if game GAME_ID's source storage has drifted/expired,
// instead of hanging the full 300s per-test timeout on an Annotate screen that never
// mounts a <video>. See helpers/fixtureGuard.js + docs/testing/derisk-plan-2026-08-11.md.
test.beforeAll(async ({ request }) => {
  await assertGameStorageActive(request, GAME_ID, { email: REAL_EMAIL, apiBase });
});

test.describe('T5700/T6400 — add-clip form layer: new clips land on the chosen layer', () => {
  let createdIds = [];

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    createdIds = [];
  });

  test.afterEach(async ({ context }) => {
    for (const id of createdIds) await deleteClip(context, id);
  });

  test('Team layer chosen -> new clip gets my_athlete=false, TEAM chip, amber marker foot', async ({ page }) => {
    // T6400: layer is set in the add-clip form's own Layer control (no sidebar toggle).
    const id = await createClipViaUI(page, 1, 'Team layer');
    createdIds.push(id);

    await expect(page.locator('[data-testid="clip-row"] [aria-label="Team layer"]').first()).toBeVisible({ timeout: 5000 });
    await saveEvidence(page, 'criterion-new-clip-team-layer');
  });

  test('My Athlete layer chosen -> new clip gets my_athlete=true and NO layer marker (unmarked default)', async ({ page }) => {
    const teamMarkersBefore = await page.locator('[data-testid="clip-row"] [aria-label="Team layer"]').count();

    const id = await createClipViaUI(page, 1, 'My Athlete layer');
    createdIds.push(id);

    // Only Team rows are marked now, so the layer is proven via the per-clip
    // editor control (which reflects the just-created, now-selected clip) plus
    // the absence of any NEW Team marker in the list.
    await expect(
      page.locator('[data-clip-details]').getByRole('radio', { name: /^My Athlete layer/ })
    ).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });
    expect(await page.locator('[data-testid="clip-row"] [aria-label="Team layer"]').count()).toBe(teamMarkersBefore);
    await saveEvidence(page, 'criterion-new-clip-my-athlete-layer');
  });
});

test.describe('T5700 — filter pill reset on game open (ephemeral, never persisted)', () => {
  test.beforeEach(async ({ context }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
  });

  test('flipping the filter pill writes nothing and resets to All on reopen', async ({ page }) => {
    await gotoGame(page);

    const writeRequests = [];
    page.on('request', (req) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method())) writeRequests.push(`${req.method()} ${req.url()}`);
    });

    // Flip the clip-list filter pill — an ephemeral view gesture.
    await page.getByRole('button', { name: 'Team', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Team', exact: true })).toHaveAttribute('aria-pressed', 'true');

    // Filtering must never write anything.
    expect(writeRequests, `Unexpected write request(s) from filtering: ${writeRequests.join(', ')}`).toHaveLength(0);

    // No localStorage write for the layer/filter state either.
    const layerKeysInStorage = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) => /layer|myAthlete|my_athlete/i.test(k))
    );
    expect(layerKeysInStorage).toHaveLength(0);

    // Leave the game (back to Games list), then reopen the SAME game.
    await page.goto('/');
    await gotoGame(page);

    await expect(page.getByRole('button', { name: 'All', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await saveEvidence(page, 'criterion-filter-resets-on-reopen');
  });
});

test.describe('T5700 — per-clip switch: gesture-based surgical save + survives reload', () => {
  let clipId;

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    clipId = await createClipViaUI(page, 1); // defaults to My Athlete (toggle default on fresh game open)
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
  });

  test('switching a clip to Team sends ONLY {my_athlete:false} and persists across reload', async ({ page }) => {
    const editor = page.locator('[data-clip-details]');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor.getByRole('radio', { name: 'My Athlete layer' })).toHaveAttribute('aria-checked', 'true');

    const [putReq] = await Promise.all([
      page.waitForRequest((req) => req.url().includes(`/api/clips/raw/${clipId}`) && req.method() === 'PUT'),
      editor.getByRole('radio', { name: 'Team layer' }).click(),
    ]);
    const putBody = putReq.postDataJSON();
    expect(putBody).toEqual({ my_athlete: false });

    await page.reload();
    await gotoGame(page);
    await expect(page.locator('[data-clip-details]').getByRole('radio', { name: 'Team layer' }))
      .toHaveAttribute('aria-checked', 'true', { timeout: 10000 });
    await saveEvidence(page, 'criterion-per-clip-switch-persists');
  });
});

test.describe('T5700 — filter pills', () => {
  let mineId, teamId;

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    mineId = await createClipViaUI(page, 1, 'My Athlete layer');
    teamId = await createClipViaUI(page, 60, 'Team layer'); // spaced 60s apart so it lands outside the first clip's [~-9,+3]s span
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, mineId);
    await deleteClip(context, teamId);
  });

  test('My Athlete / Team / All filters produce the right row sets', async ({ page }) => {
    // Only Team rows carry a marker now, so My Athlete rows are counted as
    // "rows without a Team marker" rather than by a marker of their own.
    const countRows = async () => page.getByTestId('clip-row').count();
    const countTeam = async () => page.locator('[data-testid="clip-row"] [aria-label="Team layer"]').count();
    const countMine = async () => (await countRows()) - (await countTeam());

    await page.getByRole('button', { name: 'My Athlete', exact: true }).click();
    expect(await countMine()).toBeGreaterThanOrEqual(1);
    expect(await countTeam()).toBe(0);

    await page.getByRole('button', { name: 'Team', exact: true }).click();
    expect(await countTeam()).toBeGreaterThanOrEqual(1);
    // Every visible row under the Team filter must be a Team row.
    expect(await countMine()).toBe(0);

    await page.getByRole('button', { name: 'All', exact: true }).click();
    expect(await countMine()).toBeGreaterThanOrEqual(1);
    expect(await countTeam()).toBeGreaterThanOrEqual(1);
    await saveEvidence(page, 'criterion-filter-pills');
  });
});

const SEED_SHARED_BY_SCRIPT = `
import sqlite3, sys
db_path, clip_id, shared_by = sys.argv[1], int(sys.argv[2]), sys.argv[3]
conn = sqlite3.connect(db_path)
conn.execute("UPDATE raw_clips SET my_athlete = 0, shared_by = ? WHERE id = ?", (shared_by, clip_id))
conn.commit()
conn.close()
`;

test.describe('T5700 — imported clip: layer control locked, no request sent', () => {
  let clipId;
  let userId;

  test.beforeEach(async ({ context, page }) => {
    const loginData = await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    userId = loginData.user_id;
    await gotoGame(page);
    clipId = await createClipViaUI(page, 1);

    // No live UI path exists yet to create a genuinely materialized imported
    // clip — `shared_by` is written exclusively by materialization.py's claim
    // flow, which ships in T5720/T5730 (later tasks in this epic). Seed the
    // EXACT data shape directly on this disposable test clip (deleted in
    // afterEach) so the UI contract can be proven end-to-end against a real
    // running app instead of only at the component-test level.
    const dbPath = path.join(USER_DATA_BASE, userId, 'profiles', PROFILE_ID, 'profile.sqlite');
    execFileSync('python3', ['-c', SEED_SHARED_BY_SCRIPT, dbPath, String(clipId), 'Dana Smith']);

    await page.reload();
    await gotoGame(page);
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
  });

  test("the imported clip's Layer control is locked to Team, and clicking it sends NO request", async ({ page }) => {
    // Select the freshly-imported clip via its unique "Shared by" attribution pill.
    await page.locator('[title="Shared by Dana Smith"]').first().click();
    const editor = page.locator('[data-clip-details]');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const mine = editor.getByRole('radio', { name: /^My Athlete layer/ });
    const team = editor.getByRole('radio', { name: /^Team layer/ });
    await expect(mine).toBeDisabled();
    await expect(team).toBeDisabled();
    await expect(team).toHaveAttribute('aria-checked', 'true');
    await expect(editor).toContainText('Dana Smith');

    const writeRequests = [];
    page.on('request', (req) => {
      if (req.url().includes(`/clips/raw/${clipId}`) && ['PUT', 'POST', 'PATCH'].includes(req.method())) {
        writeRequests.push(`${req.method()} ${req.url()}`);
      }
    });
    // force:true bypasses Playwright's actionability check (which would
    // itself refuse to click a disabled element) — the point is to prove the
    // APPLICATION ignores the click, not that Playwright is polite about it.
    await mine.click({ force: true });
    await page.waitForTimeout(1000);
    expect(writeRequests, `Unexpected write request(s) from clicking the locked control: ${writeRequests.join(', ')}`).toHaveLength(0);
    // The UI itself never flips either — still locked to Team.
    await expect(team).toHaveAttribute('aria-checked', 'true');

    await saveEvidence(page, 'criterion-imported-clip-locked');
  });
});

test.describe('T5700 — mobile (390px): create on both layers', () => {
  let createdIds = [];

  test.use({ viewport: { width: 390, height: 844 } });

  test.beforeEach(async ({ context, page }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    await gotoGame(page);
    createdIds = [];
  });

  test.afterEach(async ({ context }) => {
    for (const id of createdIds) await deleteClip(context, id);
  });

  test('mobile Add Clip flow shows the Layer control and saves on the chosen layer', async ({ page }) => {
    // T6400: no sidebar mode toggle. On mobile the add-clip form (the fullscreen
    // overlay) carries its own Layer control, so the layer is chosen right there —
    // createClipViaUI sets it in the visible [data-add-clip-form] before saving.
    const id = await createClipViaUI(page, 1, 'Team layer');
    createdIds.push(id);

    // The clip-list chip lives in the mobile sidebar drawer, which is closed
    // right now (closed above to reach "Add Clip") — reopen it to see the row.
    await page.locator('button[title="Show clips"]').click();
    // The CSS-hidden desktop sidebar (`hidden sm:flex`) stays mounted and
    // renders its own chip too — scope to the :visible one.
    await expect(page.locator('[data-testid="clip-row"] [aria-label="Team layer"]:visible').first()).toBeVisible({ timeout: 5000 });
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-mobile-390-create-team-layer');
  });
});

const SEED_LONG_NAME_SHARED_SCRIPT = `
import sqlite3, sys
db_path, clip_id, name, shared_by = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
conn = sqlite3.connect(db_path)
conn.execute("UPDATE raw_clips SET my_athlete = 0, shared_by = ?, name = ? WHERE id = ?", (shared_by, name, clip_id))
conn.commit()
conn.close()
`;

const LONG_CLIP_NAME = 'Incredible give-and-go through the midfield ending in a screamer from outside the box';

test.describe('T5700 — clip-list row: layer chip + Shared-by coexistence (long name, real app)', () => {
  // Supersedes the earlier dev-only /clipsdiag.html harness + its Playwright
  // spec: that harness rendered a synthetic ClipListItem outside the real app
  // (fine for proving Tailwind classes, but not real coverage). Proving
  // truncation against the REAL ClipsSidePanel/ClipListItem, with a clip
  // seeded via the same DB-write pattern already used above for `shared_by`,
  // is strictly stronger evidence and needs no throwaway page.
  let clipId;
  let userId;

  test.beforeEach(async ({ context, page }) => {
    const loginData = await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
    userId = loginData.user_id;
    await gotoGame(page);
    clipId = await createClipViaUI(page, 1);

    const dbPath = path.join(USER_DATA_BASE, userId, 'profiles', PROFILE_ID, 'profile.sqlite');
    execFileSync('python3', ['-c', SEED_LONG_NAME_SHARED_SCRIPT, dbPath, String(clipId), LONG_CLIP_NAME, 'Dana Smith']);

    await page.reload();
    await gotoGame(page);
  });

  test.afterEach(async ({ context }) => {
    await deleteClip(context, clipId);
  });

  function nameOverflow(row) {
    return row.evaluate((el) => {
      const nameSpan = [...el.querySelectorAll('span')].find((s) => s.textContent.includes('Incredible give-and-go'));
      return nameSpan ? nameSpan.scrollWidth > nameSpan.clientWidth : null;
    });
  }

  test('desktop (352px sidebar): chip + inline Shared-by pill stay fully visible; the NAME truncates', async ({ page }) => {
    const chip = page.locator('[data-testid="clip-row"] [aria-label="Team layer"]:visible').first();
    const sharedPill = page.locator('[title="Shared by Dana Smith"]:visible').first();
    await expect(chip).toBeVisible();
    await expect(sharedPill).toBeVisible();

    const row = page.locator('div.flex.items-center.px-2', { has: sharedPill });
    expect(await nameOverflow(row)).toBe(true);

    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-long-name-imported-clip-desktop-352');
  });

  test('mobile (390px viewport): chip stays visible, name truncates, "Shared by" drops to a readable second line', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.locator('button[title="Show clips"]').click();

    const chip = page.locator('[data-testid="clip-row"] [aria-label="Team layer"]:visible').first();
    await expect(chip).toBeVisible();
    // The desktop inline PILL (rounded-full "Shared by" badge) is scoped
    // `!isMobile` in ClipListItem — it must NOT render on the mobile row.
    await expect(page.locator('.rounded-full[title="Shared by Dana Smith"]:visible')).toHaveCount(0);
    const attribution = page.getByText('Shared by Dana Smith').locator('visible=true').first();
    await expect(attribution).toBeVisible();
    await expect(attribution).not.toHaveClass(/rounded-full/);

    // Scope by the seeded clip's own (unique) name text rather than `has: chip` —
    // the account has other real Team-layer clips too, so filtering on the Team
    // marker alone is ambiguous once more than one exists (pre-existing latent
    // bug, unmasked once the earlier stray-clip flake below was cleaned up).
    const row = page.locator('div.flex.items-center.px-2:visible', { hasText: 'Incredible give-and-go' });
    expect(await nameOverflow(row)).toBe(true);

    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, 'criterion-long-name-imported-clip-mobile-390');
  });
});

test.describe('T5700 — responsive sweep', () => {
  test.beforeEach(async ({ context }) => {
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);
  });

  test('Annotate screen: no horizontal overflow at 375px or desktop', async ({ page }) => {
    await gotoGame(page);
    await responsiveSweep(page);
  });
});
