import { test, expect } from '@playwright/test';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { saveEvidence, assertNoHorizontalOverflow, responsiveSweep } from './helpers/qa.js';

/**
 * T7922 — First mobile clip: the no_sport Tags block is an ACTIONABLE inline
 * sport picker, not a dead-feeling "go to the top bar" prompt.
 *
 * Since T7850 every fresh profile is `sport = 'no_sport'`, so a first-time mobile
 * user reaching the Add Clip form saw only an amber instruction to tap a sport
 * icon in the top bar — a control that isn't even mounted on the annotate
 * surface (the dead-end T7920 surfaced). T7922 replaces the full (portrait)
 * variant with an inline `InlineSportSelect` so the user sets their sport and
 * gets tags WITHOUT leaving the form; the open form re-renders in place (no
 * remount) so the in-progress clip survives. The compact landscape variant is
 * deferred (still the instructional prose) — asserted unchanged here.
 *
 * Self-contained (disposable guest via X-User-ID / test-login), mirroring the
 * T7920 drive. Acceptance criteria mapped to evidence:
 *   AC1 — a first-time mobile no_sport user reaches a tag set from Add Clip with
 *         no dead detour, verified at 320px + 375px with screenshots:
 *           1a inline picker renders in the Tags block (not dead prose)
 *           1b picking a sport swaps the TagSelector in (tags reachable)
 *           1c the in-progress clip survives the swap (rating preserved = no remount)
 *           1d Save round-trips to a real raw_clips row
 *   AC2 — T7850's instructional-only decision is revisited in the design doc
 *         (docs/plans/tasks/T7922-design.md §5) — doc-level, not e2e.
 *
 * Real browser required (jsdom lies on pointer/viewport). Runs on chromium at
 * real iPhone viewport sizes; the true iOS soft-keyboard is not emulated.
 *
 * Run (inside a /dotask container, stack already up):
 *   T7922_USER_ID=e2e_t7922_<stamp> npx playwright test e2e/T7922-mobile-inline-sport-picker.qa.spec.js \
 *     --project=chromium --reporter=line
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = process.env.T7922_VIDEO || path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_USER_ID = process.env.T7922_USER_ID || `e2e_t7922_${Date.now()}`;
const apiBase = process.env.E2E_API_BASE || '/api';

// The task's exact reported matrix (both portrait iPhone-class).
const PORTRAIT_VIEWPORTS = [
  { name: '320x568', width: 320, height: 568 }, // iPhone SE (1st gen) class
  { name: '375x667', width: 375, height: 667 }, // iPhone 6/7/8/SE2 class
];
const SEEK_BY_VIEWPORT = { '320x568': 78, '375x667': 62 };

test.describe.configure({ mode: 'serial', timeout: 480_000 });

const step = (m) => console.log(`[T7922:step] ${m}`);

/** Isolate a disposable authenticated guest (headers + test-login + auth gate). */
async function setupAuthedGuest(page) {
  await page.setExtraHTTPHeaders({ 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    await route.continue({ headers });
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 't7922@e2e.local', showAuthModal: false });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('button:has-text("Add Game")').first()).toBeVisible({ timeout: 20000 });
}

/** Force the current profile's sport to no_sport so each viewport hits the picker branch. */
async function resetProfileToNoSport(page) {
  await page.evaluate(async () => {
    const { useProfileStore } = await import('/src/stores/profileStore.js');
    const s = useProfileStore.getState();
    if (s.currentProfileId && s.currentProfile()?.sport !== 'no_sport') {
      await s.updateProfile(s.currentProfileId, { sport: 'no_sport' });
    }
  });
  await page.waitForTimeout(300);
}

/** Upload the short test video via the Add Game modal, land in Annotate. */
async function uploadGameAndEnterAnnotate(page) {
  await page.locator('button:has-text("Games")').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  step('click Add Game');
  await page.locator('button:has-text("Add Game")').first().click();
  await openGameDetailsDisclosure(page);
  await expect(page.getByPlaceholder('e.g., Carlsbad SC')).toBeVisible({ timeout: 8000 });

  await page.getByPlaceholder('e.g., Carlsbad SC').fill('T7922 Audit');
  const today = new Date().toISOString().split('T')[0];
  await page.locator('input[type="date"]').fill(today);
  await page.getByRole('button', { name: 'Home' }).click({ force: true });

  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  step('setInputFiles video');
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(500);
  // Neutralize the client-side upload paywall for the isolated guest (harness-only).
  await page.evaluate(async () => {
    const { useCreditStore } = await import('/src/stores/creditStore.js');
    useCreditStore.setState({ balance: 1_000_000, loaded: true });
  });
  const createButton = page.locator('form button:has-text("Add Game")').last();
  await expect(createButton).toBeEnabled({ timeout: 8000 });
  step('click Create (submit Add Game)');
  const clicked = await createButton.click({ timeout: 12000 }).then(() => true).catch(() => false);
  if (!clicked) {
    await createButton.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.getByPlaceholder('e.g., Carlsbad SC').press('Enter').catch(() => {});
  }
  step('submitted; waiting for annotate video to mount');

  await expect(async () => {
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    expect(await video.evaluate((v) => !!v.src)).toBeTruthy();
  }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });

  const uploadingButton = page.locator('button:has-text("Uploading video")');
  await page.waitForTimeout(2000);
  await uploadingButton.isVisible().then((v) => v && expect(uploadingButton).toBeHidden({ timeout: 30000 }).catch(() => {})).catch(() => {});

  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 2 && v.seekable.length > 0 && v.duration > 0;
  }, undefined, { timeout: 120000 });
  step('video seekable — annotate ready');
}

/** Open the mobile inline Add Clip form (NONE-selection state → "Add Clip" button). */
async function openMobileAddClipForm(page, preferredSeek) {
  const candidates = [preferredSeek, 78, 70, 62, 33, 15, 85, 8];
  const addBtn = page.locator('button[title="Add clip ending at current time (A)"]:visible').first();
  for (const t of candidates) {
    const landed = await page.locator('video').first().evaluate((v, tt) => {
      if (!v.paused) v.pause();
      v.currentTime = tt;
      return v.currentTime;
    }, t);
    if (Math.abs(landed - t) > 2) { await page.waitForTimeout(400); continue; }
    await page.waitForTimeout(700);
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      const form = page.locator('[data-add-clip-form]:visible');
      await expect(form).toBeVisible({ timeout: 5000 });
      return form;
    }
  }
  throw new Error('[T7922] no clip-free gap found to open the mobile Add Clip form');
}

test.beforeAll(() => {
  if (!fs.existsSync(TEST_VIDEO)) throw new Error(`Test video not found: ${TEST_VIDEO}`);
  console.log(`[T7922] guest user id: ${TEST_USER_ID}`);
});

// T8140 SUPERSEDES T7922 on the annotate mobile path: the in-form inline sport
// picker was REMOVED from the mobile Add Clip form (kept on desktop + in
// UploadClipModal/ClipDetailsEditor). The mobile first-clip form is now a clean
// one-tap surface with NO amber wall; the sport question moved to a single
// full-screen "What sport is this?" step fired at first save. This test asserts
// the new mobile flow. (Not runnable inside the /dotask container — no browser;
// run in a stack-up container per the header.)
test('T8140 mobile first clip: clean one-tap form + full-screen sport question at save (320 + 375)', async ({ page }) => {
  await setupAuthedGuest(page);
  await page.setViewportSize({ width: 375, height: 667 });
  await uploadGameAndEnterAnnotate(page);

  const savedClipIds = [];
  let gameId;
  let askedOnce = false;

  for (const vp of PORTRAIT_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.waitForTimeout(300);
    // Precondition: a fresh no_sport profile (reset after the prior viewport picked a sport).
    await resetProfileToNoSport(page);

    const form = await openMobileAddClipForm(page, SEEK_BY_VIEWPORT[vp.name]);

    // --- AC: the mobile no_sport form is CLEAN — no in-form picker, no amber wall ---
    await assertNoHorizontalOverflow(page);
    await expect(form.getByRole('combobox', { name: /change sport/i })).toHaveCount(0);
    await expect(form.getByText('Pick your sport to tag this clip')).toHaveCount(0);
    // Reassurance line present; Save reachable without scrolling (sticky footer).
    await expect(form.getByText('You can change all of this later.')).toBeVisible();
    const saveBtn = form.locator('button.bg-green-600:has-text("Save")');
    await expect(saveBtn, `Save visible without scroll at ${vp.name}`).toBeInViewport();
    await saveEvidence(page, `t8140-clean-form-${vp.name}`);

    // --- AC: one-tap Save creates a real raw_clips row with defaults ---
    const [saveResp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/clips/raw/save') && r.request().method() === 'POST',
        { timeout: 15000 },
      ),
      saveBtn.click(),
    ]);
    expect(saveResp.ok(), `save POST ok at ${vp.name}`).toBeTruthy();
    const body = await saveResp.json();
    expect(body.raw_clip_id, `raw_clip_id returned at ${vp.name}`).toBeTruthy();
    savedClipIds.push(body.raw_clip_id);
    const sent = saveResp.request().postDataJSON();
    if (gameId === undefined) gameId = sent.game_id;
    expect(sent.rating, `default rating persisted at ${vp.name}`).toBe(4);
    expect(String(sent.name || ''), `Play-N default name at ${vp.name}`).toMatch(/^Play \d+$/);

    // --- AC: the full-screen sport question fires ONCE at the first save ---
    const question = page.getByRole('dialog', { name: 'What sport is this?' });
    if (!askedOnce) {
      await expect(question, `full-screen sport question at ${vp.name}`).toBeVisible({ timeout: 8000 });
      await saveEvidence(page, `t8140-sport-question-${vp.name}`);
      // Answer persists via the existing profile-sport gesture.
      await question.getByRole('button', { name: /Soccer/ }).click();
      await expect(question).toBeHidden({ timeout: 8000 });
      askedOnce = true;
    } else {
      // Once asked (and skipped/answered) it does not re-ask this session.
      await expect(question).toHaveCount(0);
    }
  }

  // --- durable proof: the raw_clips rows really exist ----------------------
  const loadRes = await page.request.get(`${apiBase}/games/${gameId}/load`);
  expect(loadRes.ok()).toBeTruthy();
  const loaded = await loadRes.json();
  const annotations = loaded.game?.annotations || loaded.annotations || [];
  const rawIds = new Set(annotations.map((a) => a.rawClipId ?? a.raw_clip_id ?? a.id));
  for (const id of savedClipIds) {
    expect([...rawIds].map(String), 'saved clip present in /load annotations').toContain(String(id));
  }
  console.log(`[T8140] saved raw_clip ids: ${savedClipIds.join(', ')}; /load annotations: ${annotations.length}`);

  // --- Changed-screen responsive sweep (375 + desktop): no horizontal overflow ---
  await responsiveSweep(page);
});
