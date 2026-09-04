import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8760 QA — live-drive verification of the single-play-control + clip-scoped
 * looping playhead + rename changes, against a real account's real data.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8760-annotate-clip-editor-qa.spec.js --reporter=line
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('T8760 — clip editor single-playhead + rename: live QA', () => {
  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active' && (g.clip_count || 0) > 0);
    test.skip(!target, '[T8760] no active game with clips available');
    console.log(`[T8760] driving active game id=${target.id} (${target.opponent_name})`);

    await openGameInAnnotate(page, target.id);
    await expect(page.locator('.clip-marker').first()).toBeVisible({ timeout: 30000 });
  });

  test('item 8: selecting a clip WITHOUT opening the editor must not trigger loop/zoom/seed @gate-a', async ({ page }) => {
    // Baseline: capture the transport readout format BEFORE any clip selection.
    const readoutBefore = await page.locator('.controls-container .font-mono').first().textContent();
    console.log(`[T8760] readout before select: ${readoutBefore}`);

    // Select a clip marker WITHOUT opening the editor overlay.
    await page.locator('.clip-marker').first().click();
    await page.waitForTimeout(500);

    // The editor strip must NOT have opened.
    await expect(page.locator('[data-testid="annotate-editor-strip"]')).toHaveCount(0);
    // No clip-relative readout must appear — merely-selected state stays whole-game.
    await expect(page.locator('[data-testid="clip-relative-time"]')).toHaveCount(0);
    await saveEvidence(page, 'T8760-8-selected-not-editing-no-strip');

    // Play from this merely-selected state: it must NOT loop at the clip bounds
    // (whole-game playback). We just confirm the transport plays and the
    // clip-relative readout still never appears while playing.
    const playBtn = page.locator('button[title="Play"]:visible').first();
    await playBtn.click();
    await page.waitForTimeout(800);
    await expect(page.locator('[data-testid="clip-relative-time"]')).toHaveCount(0);
    await saveEvidence(page, 'T8760-8-selected-not-editing-playing-whole-game');
    const pauseBtn = page.locator('button[title="Pause"]:visible').first();
    if (await pauseBtn.count()) await pauseBtn.click();
  });

  test('items 1-7: single play control, clip-scoped loop, playhead, spacebar parity, readout, rename @gate-a', async ({ page }) => {
    // Open the desktop under-canvas editor via the real "Edit Play" gesture
    // after selecting a clip (Non-FS: onAddClip becomes "Edit Play" once a
    // clip is selected — AnnotateControls.jsx).
    await page.locator('.clip-marker').first().click();
    await page.waitForTimeout(300);
    const editPlayBtn = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(editPlayBtn).toBeVisible({ timeout: 5000 });
    await expect(editPlayBtn).toHaveText(/Edit Play/);
    await editPlayBtn.click();

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });

    // --- Item 6: header/name field checks ---
    await expect(strip.getByText(/^Editing:/i)).toHaveCount(0);
    // Only one visible "Clip name" input should exist now (create-mode-only field
    // is hidden in edit mode) — the standalone duplicate name field is gone.
    const nameInputs = strip.locator('input[aria-label="Clip name"]:visible');
    expect(await nameInputs.count()).toBe(0); // input only appears once pencil clicked
    const pencilRenameBtn = strip.locator('button[title="Rename this play"]');
    await expect(pencilRenameBtn).toBeVisible();
    await saveEvidence(page, 'T8760-6-header-pencil-no-editing-prefix');
    await pencilRenameBtn.click();
    await expect(strip.locator('input[aria-label="Clip name"]:visible')).toBeVisible();
    await saveEvidence(page, 'T8760-6-inline-name-edit-open');
    await page.keyboard.press('Escape'); // closes inline edit only (per onKeyDown handler)

    // --- Item 1: single play control -- only ONE Play/Pause toggle in the editor view ---
    const playButtons = page.locator('button[title="Play"]:visible, button[title="Pause"]:visible');
    expect(await playButtons.count()).toBe(1);
    await saveEvidence(page, 'T8760-1-single-play-control');

    // --- Item 3: playhead visible, defaults to clip start on open ---
    const playhead = strip.locator('[data-testid="scrub-playhead"]');
    await expect(playhead.first()).toBeVisible({ timeout: 10000 });
    const leftAtOpen = await playhead.first().evaluate((el) => parseFloat(el.style.left));
    console.log(`[T8760] playhead left% at open: ${leftAtOpen}`);
    await saveEvidence(page, 'T8760-3-playhead-visible-at-open');

    // --- Item 5: clip-relative time readout while editing ---
    const relTime = page.locator('[data-testid="clip-relative-time"]');
    await expect(relTime).toBeVisible({ timeout: 5000 });
    const relTextAtOpen = await relTime.textContent();
    console.log(`[T8760] clip-relative readout at open: ${relTextAtOpen}`);
    // Elapsed should start near 0s (playhead seeded to clip start).
    expect(parseFloat(relTextAtOpen)).toBeLessThan(1.5);
    await saveEvidence(page, 'T8760-5-clip-relative-readout');
    const clipLength = parseFloat(relTextAtOpen.split('/')[1]);
    const clipAbsStart = await page.locator('video').first().evaluate((v) => v.currentTime);
    console.log(`[T8760] clip abs start=${clipAbsStart.toFixed(2)}s length=${clipLength}s`);

    // --- Item 4 + 2: transport button play -> loop past clip end. The
    // readout itself clamps elapsed to clipLength (AnnotateControls.jsx),
    // so a frozen-at-max reading is NOT proof of a loop -- it could equally
    // mean playback stalled past the boundary into the rest of the game
    // while the display just clamps. Poll repeatedly and require the elapsed
    // value to actually DROP back down (a real wrap), not merely stay bounded,
    // AND cross-check the raw <video> currentTime never runs away past the
    // clip's own [start, end] window into the rest of the game.
    const playBtn = page.locator('button[title="Play"]:visible').first();
    await playBtn.click();
    const samples = [];
    const rawVideoTimes = [];
    let sawLoop = false;
    for (let i = 0; i < 16 && !sawLoop; i++) {
      await page.waitForTimeout(600);
      const text = await relTime.textContent();
      const elapsed = parseFloat(text.split('/')[0]);
      samples.push(elapsed);
      const videoTime = await page.locator('video').first().evaluate((v) => v.currentTime);
      rawVideoTimes.push(videoTime);
      if (samples.length > 1 && elapsed < samples[samples.length - 2] - 1) sawLoop = true;
    }
    console.log(`[T8760] clip-relative elapsed samples over ~9.6s of playback: ${samples.join(', ')}`);
    console.log(`[T8760] raw <video> currentTime samples: ${rawVideoTimes.map((t) => t.toFixed(2)).join(', ')}`);
    expect(sawLoop, `expected elapsed to wrap back down (looped within the clip), samples: ${samples.join(', ')}`).toBeTruthy();
    for (const t of rawVideoTimes) {
      expect(t, `raw video time ${t} ran past the clip's [${clipAbsStart}, ${clipAbsStart + clipLength}] window into the rest of the game`)
        .toBeLessThanOrEqual(clipAbsStart + clipLength + 1);
    }
    await saveEvidence(page, 'T8760-2-looping-clip-bounded-readout');

    const pauseBtn = page.locator('button[title="Pause"]:visible').first();
    await expect(pauseBtn).toBeVisible();
    await pauseBtn.click();
    await page.waitForTimeout(200);

    // --- Item 4: spacebar parity -- toggles the SAME single control ---
    await page.keyboard.press('Space'); // play
    await page.waitForTimeout(500);
    await expect(page.locator('button[title="Pause"]:visible')).toBeVisible();
    await saveEvidence(page, 'T8760-4-spacebar-play-matches-button');
    await page.keyboard.press('Space'); // pause
    await page.waitForTimeout(300);
    await expect(page.locator('button[title="Play"]:visible')).toBeVisible();
    await saveEvidence(page, 'T8760-4-spacebar-pause-matches-button');

    // --- Item 7: rename to "Clip Out Play" (only if not already reeled) ---
    const clipOutBtn = strip.getByRole('button', { name: 'Clip Out Play' });
    const alreadyReeled = await strip.getByText('Reel created').count();
    if (await clipOutBtn.count()) {
      await expect(clipOutBtn).toBeVisible();
      await saveEvidence(page, 'T8760-7-clip-out-play-button');
    } else {
      console.log(`[T8760] item 7: clip already has a reel (alreadyReeled=${alreadyReeled}) - button replaced by "Reel created", which is expected; skipping click`);
      await saveEvidence(page, 'T8760-7-clip-already-reeled');
    }

    // --- Item 5 (continued): close editor, readout reverts to absolute time ---
    await strip.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('[data-testid="annotate-editor-strip"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="clip-relative-time"]')).toHaveCount(0);
    const absTime = await page.locator('.controls-container .font-mono').first().textContent();
    console.log(`[T8760] readout after close (should be absolute): ${absTime}`);
    await saveEvidence(page, 'T8760-5-readout-reverts-absolute-on-close');
  });
});
