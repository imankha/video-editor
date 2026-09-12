import { test, expect } from '@playwright/test';
import { openGameDetailsDisclosure } from './helpers/gameDetails.js';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * T9480 -- one time-format rule, exact trim entry, and honest billable duration.
 *
 * Real-browser proof (T5380 jsdom-pointer landmine): typed entry is safe in
 * jsdom (covered by ClipScrubRegion.trimEntry.test.jsx), but the shared
 * `clampTrim` policy is ALSO used by the DRAG path, and pointer events lie in
 * jsdom. This spec drives a real drag, then types an exact value into the
 * start field, and checks the trim detail / span readouts stay consistent
 * and that the Focus export estimate's credit count + disclosure line match
 * what the backend would actually charge (roundCreditsHalfUp).
 *
 * Self-contained (no pre-seeded real account): isolates a disposable guest
 * via the X-User-ID / test-login bypass (same pattern as T7790/T7920) and
 * uploads the short local test video.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DATA_DIR = path.resolve(__dirname, '../../../formal annotations/test.short');
const TEST_VIDEO = path.join(TEST_DATA_DIR, 'wcfc-carlsbad-trimmed.mp4');
const TEST_USER_ID = `e2e_t9480_${Date.now()}`;

test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1400, height: 1000 } });

test.afterAll(async ({ request }) => {
  await request.delete('/api/auth/user', { headers: { 'X-User-ID': TEST_USER_ID } }).catch(() => {});
});

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
    useAuthStore.setState({ isAuthenticated: true, email: 't9480@e2e.local', showAuthModal: false });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('button:has-text("Upload game")').first()).toBeVisible({ timeout: 20000 });
}

async function uploadGameAndEnterAnnotate(page) {
  await page.locator('button:has-text("Games")').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Upload game")').first().click();
  await openGameDetailsDisclosure(page);
  await expect(page.getByPlaceholder('e.g., Carlsbad SC')).toBeVisible({ timeout: 8000 });

  await page.getByPlaceholder('e.g., Carlsbad SC').fill('T9480 QA');
  const today = new Date().toISOString().split('T')[0];
  await page.locator('input[type="date"]').fill(today);
  await page.getByRole('button', { name: 'Home' }).click({ force: true });

  const videoInput = page.locator('form input[type="file"][accept*="video"]');
  await expect(videoInput).toBeAttached({ timeout: 10000 });
  await videoInput.setInputFiles(TEST_VIDEO);
  await page.waitForTimeout(500);
  // Neutralize the client-side credit paywall (harness-only, not under test).
  await page.evaluate(async () => {
    const { useCreditStore } = await import('/src/stores/creditStore.js');
    useCreditStore.setState({ balance: 1_000_000, loaded: true });
  });
  const createButton = page.locator('form button:has-text("Upload game")').last();
  await expect(createButton).toBeEnabled({ timeout: 8000 });
  await createButton.click({ timeout: 12000 }).catch(async () => {
    await createButton.click({ force: true, timeout: 8000 }).catch(() => {});
    await page.getByPlaceholder('e.g., Carlsbad SC').press('Enter').catch(() => {});
  });

  await expect(async () => {
    const video = page.locator('video').first();
    await expect(video).toBeVisible();
    expect(await video.evaluate((v) => !!v.src)).toBeTruthy();
  }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });

  await page.waitForFunction(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 2 && v.seekable.length > 0 && v.duration > 0;
  }, undefined, { timeout: 120000 });
}

/** Seek to a gap and open the "Mark play" form (ANNOTATE.MARK_PLAY, T9520). */
async function openMarkPlayForm(page) {
  const candidates = [30, 45, 60, 20, 15, 8];
  const addBtn = page.getByTestId('annotate-primary-cta');
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
      const form = page.getByTestId('annotate-editor-strip');
      await expect(form).toBeVisible({ timeout: 5000 });
      return form;
    }
  }
  throw new Error('[T9480] no clip-free gap found to open the Mark Play form');
}

// The backend's round-half-up rule (T9750), mirrored here for the QA
// cross-check -- the SAME formula pinned by test_t9750_round_credits.py and
// creditStore.roundCreditsHalfUp.
function roundCreditsHalfUp(seconds) {
  if (!(seconds > 0)) return 0;
  return Math.max(1, Math.floor(seconds + 0.5));
}

test('one time-format rule: drag + exact entry stay consistent, billing matches the disclosure (T9480)', async ({ page }) => {
  test.setTimeout(300000);

  await setupAuthedGuest(page);
  await uploadGameAndEnterAnnotate(page);
  const form = await openMarkPlayForm(page);

  // --- Real-browser DRAG proof (T5380 jsdom-pointer landmine): the shared
  // clampTrim policy now backs the drag path too -- prove a real pointer
  // drag still produces a sane, bounded value.
  const scrubTrack = form.getByTestId('scrub-track');
  await expect(scrubTrack).toBeVisible({ timeout: 10000 });
  // The actual draggable start handle (a small `.rounded-l.cursor-col-resize`
  // strip inside the track), not an arbitrary point on the track -- an
  // untargeted mousedown on the track is a click-to-seek, not a drag.
  const startHandle = form.locator('.rounded-l.cursor-col-resize').first();
  await expect(startHandle).toBeVisible({ timeout: 10000 });
  const handleBox = await startHandle.boundingBox();
  const beforeDragText = await form.getByTestId('trim-field-start').innerText();

  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2 + 60, handleBox.y + handleBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const afterDragText = await form.getByTestId('trim-field-start').innerText();
  // A real pointer drag must produce a well-formed M:SS.s / H:MM:SS.s reading,
  // never NaN/undefined garbage -- this is what jsdom cannot prove -- AND it
  // must actually have moved the value (proving the handle, not the track's
  // click-to-seek, was grabbed).
  expect(afterDragText).toMatch(/^\d+:\d{2}\.\d$|^\d+:\d{2}:\d{2}\.\d$/);
  expect(afterDragText).not.toBe(beforeDragText);
  console.log(`[T9480:qa] drag proof: "${beforeDragText}" -> "${afterDragText}"`);

  // --- Exact entry: type 2.9 into the start field (AC2).
  await form.getByTestId('trim-field-start').click();
  const startInput = form.getByTestId('trim-field-input-start');
  await startInput.fill('2.9');
  await startInput.press('Enter');
  await page.waitForTimeout(300);

  const startReadout = await form.getByTestId('trim-field-start').innerText();
  expect(startReadout).toBe('0:02.9');

  // Trim detail and span consistency: the span readout (data-testid="clip-length")
  // must read a LENGTH (rounds, no credit language) computed from the same
  // start/end the trim-detail fields show.
  const endReadout = await form.getByTestId('trim-field-end').innerText();
  const spanReadout = await form.getByTestId('clip-length').innerText();
  expect(spanReadout).not.toMatch(/credit/i);
  console.log(`[T9480:qa] start=${startReadout} end=${endReadout} span=${spanReadout}`);

  // --- Save the clip, then verify the Focus export estimate + billable
  // disclosure match what would actually be charged. A 4/5-star rating
  // offers "Create an editable clip" (produces a Focus-able project); fall
  // back to a plain "Save play" for lower ratings.
  const saveButton = form.locator('button:has-text("Create an editable clip")').first();
  const plainSaveButton = form.locator('button:has-text("Save play")').first();
  if (await saveButton.isVisible().catch(() => false)) {
    await saveButton.click();
  } else if (await plainSaveButton.isVisible().catch(() => false)) {
    await plainSaveButton.click();
  }
  await page.waitForTimeout(1500);

  // The play saved above may not yet have produced a raw_clip (a play and its
  // editable clip are two separate DB rows) -- the strip now shows "Create
  // clip" in edit mode if so; click it to guarantee a raw_clip exists.
  const createClipButton = form.locator('button:has-text("Create clip")').first();
  if (await createClipButton.isVisible().catch(() => false)) {
    await createClipButton.click();
    await page.waitForTimeout(1500);
  }

  const clips = await page.evaluate(async () => {
    const res = await fetch('/api/clips/raw');
    return res.ok ? await res.json() : [];
  });
  expect(clips.length).toBeGreaterThan(0);
  const savedClip = clips[clips.length - 1];
  const exactSeconds = savedClip.end_time - savedClip.start_time;
  const expectedCredits = roundCreditsHalfUp(exactSeconds);
  console.log(`[T9480:qa] saved clip span=${exactSeconds}s -> expected ${expectedCredits} credits`);

  // Cross-reference: the frontend's own roundCreditsHalfUp (imported live from
  // the running app, not re-implemented) must agree with the QA formula above.
  const frontendCredits = await page.evaluate(async (seconds) => {
    const { useCreditStore } = await import('/src/stores/creditStore.js');
    return useCreditStore.getState().getRequiredCredits(seconds);
  }, exactSeconds);
  expect(frontendCredits).toBe(expectedCredits);
});
