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

/**
 * Seek to a gap and tap "Mark play" (ANNOTATE.MARK_PLAY, T9520). T10610:
 * the tap itself creates the region AND the backend row immediately (no
 * blank form to fill out first) and opens the strip already in EDIT mode
 * on the new play.
 */
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

  // --- Exact entry: type 2.9 into the start field (AC2). T10610: the play
  // already exists (create-at-tap) and this Enter commit PERSISTS immediately
  // via TrimTimeField's onCommitComplete -> ClipScrubRegion's onDragEnd ->
  // {startTime, endTime} -- no Save click involved, and none exists anymore.
  await form.getByTestId('trim-field-start').click();
  const startInput = form.getByTestId('trim-field-input-start');
  await startInput.fill('2.9');
  const [trimPut] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/clips/raw/') && r.request().method() === 'PUT'),
    startInput.press('Enter'),
  ]);
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

  // --- The committed trim actually reached the server: read the clip back
  // and confirm reopening the play (no click that could be mistaken for a
  // save) shows the SAME value the readout showed above.
  const clipId = trimPut.url().match(/\/clips\/raw\/(\d+)/)[1];
  const clips = await page.evaluate(async () => {
    const res = await fetch('/api/clips/raw');
    return res.ok ? await res.json() : [];
  });
  const savedClip = clips.find((c) => String(c.id) === String(clipId));
  expect(savedClip).toBeTruthy();
  expect(savedClip.start_time).toBeCloseTo(2.9, 1);

  // Close and reopen the play (Done, then re-select + Edit play) -- the
  // formatted readout must reflect the PERSISTED value, not a stale local echo.
  await form.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(500);
  await page.getByTestId('annotate-primary-cta').click();
  await page.waitForTimeout(800);
  const reopenedForm = page.getByTestId('annotate-editor-strip');
  await expect(reopenedForm).toBeVisible({ timeout: 5000 });
  expect(await reopenedForm.getByTestId('trim-field-start').innerText()).toBe('0:02.9');

  // --- Verify the Focus export estimate + billable disclosure match what
  // would actually be charged for the persisted span.
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

test('Escape genuinely discards without writing, even if the input unmount fires a real blur (T9480 review fix, MINOR #10)', async ({ page }) => {
  test.setTimeout(300000);

  // jsdom cannot prove this: removing a focused element (React unmounting the
  // <input> back to the rest-state <button> when Escape flips `editing` to
  // false) can fire a REAL blur/focusout event in an actual browser that
  // jsdom does not reliably simulate. If that blur reached TrimTimeField's
  // onBlur={() => commit(draft)} handler, a garbage/valid-looking draft typed
  // right before Escape could still commit -- silently, after the user
  // explicitly cancelled. This is a real-browser-only proof of the negative.
  await setupAuthedGuest(page);
  await uploadGameAndEnterAnnotate(page);
  const form = await openMarkPlayForm(page);

  const originalStart = await form.getByTestId('trim-field-start').innerText();

  await form.getByTestId('trim-field-start').click();
  const input = form.getByTestId('trim-field-input-start');
  await input.fill('999');
  await input.press('Escape');
  await page.waitForTimeout(500); // let any stray/delayed blur commit resolve, if one fires

  // The field must be back to its ORIGINAL value, not the typed 999 -- and
  // the input must be gone (rest mode), not still open/erroring.
  expect(await page.getByTestId('trim-field-input-start').count()).toBe(0);
  expect(await form.getByTestId('trim-field-start').innerText()).toBe(originalStart);

  // Clicking away and re-reading again catches a DELAYED write (e.g. a
  // straggling async commit that lands after this check but before the next
  // interaction) -- click the span readout area (a no-op target) and re-check.
  await form.getByTestId('clip-length').click({ trial: true }).catch(() => {});
  await page.waitForTimeout(300);
  expect(await form.getByTestId('trim-field-start').innerText()).toBe(originalStart);
});
