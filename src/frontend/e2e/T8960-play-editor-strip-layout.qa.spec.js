import { test, expect } from '@playwright/test';
import { loginAsRealUser, openGameInAnnotate } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

/**
 * T8960 QA — live-drive verification of the Add/Edit Play strip layout rework
 * (9 items) against a real account's real data.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8960-play-editor-strip-layout.qa.spec.js --reporter=line
 *
 * Item 8 (click-in-span seek) is a real-browser pointer gesture — the T5380 /
 * T8900 jsdom-pointer landmine means this MUST be proven live, which is what
 * this spec does (jsdom unit test alone is not sufficient evidence).
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE;
const API_BASE = process.env.E2E_API_BASE || '/api';

const SKIP_TITLES = ['Back 5 seconds', 'Step backward (one frame)', 'Restart', 'Step forward (one frame)'];

test.use({ viewport: { width: 1440, height: 900 } });

test.describe('T8960 — play editor strip layout: live QA', () => {
  test.beforeEach(async ({ context, page }) => {
    test.setTimeout(120000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE);

    const res = await context.request.get(
      `${API_BASE}/games`,
      PROFILE ? { headers: { 'X-Profile-ID': PROFILE } } : undefined,
    );
    expect(res.ok(), `GET ${API_BASE}/games (${res.status()})`).toBeTruthy();
    const games = (await res.json()).games || [];
    const target = games.find((g) => g.storage_status === 'active');
    test.skip(!target, '[T8960] no active game available');
    console.log(`[T8960] driving active game id=${target.id} (${target.opponent_name})`);

    await openGameInAnnotate(page, target.id);
    // The video must be ready before we can Add Play.
    await expect(page.locator('video').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(1500);
  });

  test('items 2-6,8,9 — Add Play (create mode) @gate-a', async ({ page }) => {
    // Open the strip in CREATE mode via the real "Add Play" CTA.
    const addPlay = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(addPlay).toBeVisible({ timeout: 10000 });
    await expect(addPlay).toHaveText(/Add Play/);
    await addPlay.click();

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });

    // --- Item 2: name-first, default + pencil, no standalone name input ---
    const rename = strip.locator('button[title="Rename this play"]');
    await expect(rename).toBeVisible();
    expect(await strip.locator('input[aria-label="Clip name"]:visible').count()).toBe(0);
    await rename.click();
    await expect(strip.locator('input[aria-label="Clip name"]:visible')).toBeVisible();
    await saveEvidence(page, 'T8960-2-name-pencil-inline');
    await page.keyboard.press('Escape'); // closes inline edit only

    // --- Item 3: centered "+ Adding new play" title row ---
    await expect(strip.getByText('Adding new play')).toBeVisible();

    // --- Item 5: My Athlete | Team layer control on the top line (header) ---
    await expect(strip.getByRole('radio', { name: /My Athlete layer/ })).toBeVisible();
    await expect(strip.getByRole('radio', { name: /Team layer/ })).toBeVisible();
    await saveEvidence(page, 'T8960-3-5-title-and-layer-in-header');

    // --- Item 4: "Clip" toggle-button with stateful copy ---
    const toggleOff = strip.getByText("Don't Clip Play");
    const toggleOn = strip.getByText('Clip Play to focus on your player');
    // Whichever state it starts in, both copies must be reachable.
    if (await toggleOff.count()) {
      await toggleOff.click();
      await expect(toggleOn).toBeVisible();
      await toggleOn.click();
      await expect(strip.getByText("Don't Clip Play")).toBeVisible();
    } else {
      await expect(toggleOn).toBeVisible();
    }
    await saveEvidence(page, 'T8960-4-clip-toggle-copy');

    // --- Item 9: skip/step/restart transport buttons hidden while editor open ---
    for (const title of SKIP_TITLES) {
      await expect(page.locator(`button[title="${title}"]`)).toHaveCount(0);
    }
    // Play/pause remains the single transport control.
    expect(await page.locator('button[title="Play"]:visible, button[title="Pause"]:visible').count()).toBe(1);
    await saveEvidence(page, 'T8960-9-skip-buttons-hidden');

    // --- Item 8: click INSIDE the green span seeks the playhead there ---
    const playhead = strip.locator('[data-testid="scrub-playhead"]').first();
    await expect(playhead).toBeVisible({ timeout: 10000 });
    const before = parseFloat(await playhead.getAttribute('data-playhead-time'));
    const region = await strip.locator('[data-testid="scrub-track"]').evaluate((track) => {
      const el = track.querySelector('div[class*="bg-green-500/20"]');
      const r = el.getBoundingClientRect();
      return { left: r.left, width: r.width, top: r.top, height: r.height };
    });
    // 0.7 into the span, clear of both edge handles.
    const clickX = region.left + region.width * 0.7;
    const clickY = region.top + region.height / 2;
    await page.mouse.click(clickX, clickY);
    await page.waitForTimeout(400);
    const after = parseFloat(await playhead.getAttribute('data-playhead-time'));
    console.log(`[T8960] item8 playhead time before=${before} after=${after}`);
    expect(Math.abs(after - before), 'click inside the span should move the playhead').toBeGreaterThan(0.3);
    await saveEvidence(page, 'T8960-8-click-in-span-seeks');

    // --- Item 1: play -> loops back to start (create mode) ---
    // Seed leaves the playhead at the clip start; play and watch the raw video
    // time wrap back down (a real loop), never running away past the span.
    const start0 = await page.locator('video').first().evaluate((v) => v.currentTime);
    const playBtn = page.locator('button[title="Play"]:visible').first();
    await playBtn.click();
    const raw = [];
    let sawLoop = false;
    for (let i = 0; i < 26 && !sawLoop; i++) {
      await page.waitForTimeout(700);
      const t = await page.locator('video').first().evaluate((v) => v.currentTime);
      raw.push(t);
      if (raw.length > 1 && t < raw[raw.length - 2] - 1) sawLoop = true;
    }
    console.log(`[T8960] item1 raw video times: ${raw.map((t) => t.toFixed(2)).join(', ')}`);
    expect(sawLoop, `expected the playhead to loop back to the clip start (start~${start0.toFixed(2)}), samples: ${raw.join(', ')}`).toBeTruthy();
    await saveEvidence(page, 'T8960-1-create-mode-loop');
    const pauseBtn = page.locator('button[title="Pause"]:visible').first();
    if (await pauseBtn.count()) await pauseBtn.click();

    // --- Item 6: details expand in place with NO inner scroll ---
    await strip.getByText(/Add details|Details/).first().click();
    await expect(strip.getByLabel('Notes (optional)')).toBeVisible();
    const scrollBoxes = await strip.locator('.overflow-y-auto, .max-h-64').count();
    expect(scrollBoxes, 'details panel must not reintroduce an inner scroll').toBe(0);
    await saveEvidence(page, 'T8960-6-details-no-scroll');
  });

  test('items 7,9 — Edit Play (edit mode) button + hidden skips @gate-a', async ({ page }) => {
    const marker = page.locator('.clip-marker').first();
    test.skip(!(await marker.count()), '[T8960] no clip markers to edit');
    await marker.click();
    await page.waitForTimeout(300);
    const editPlay = page.locator('[data-testid="annotate-primary-cta"]');
    await expect(editPlay).toHaveText(/Edit Play/, { timeout: 5000 });
    await editPlay.click();

    const strip = page.locator('[data-testid="annotate-editor-strip"]');
    await expect(strip).toBeVisible({ timeout: 10000 });

    // --- Item 7: edit-mode button reads "Clip Play", never "Clip Out Play" ---
    await expect(strip.getByText('Clip Out Play')).toHaveCount(0);
    const clipPlay = strip.getByRole('button', { name: 'Clip Play' });
    const reeled = await strip.getByText('Reel created').count();
    if (reeled) {
      console.log('[T8960] item7: clip already reeled ("Reel created") — button not shown, expected');
    } else {
      await expect(clipPlay).toBeVisible();
    }
    await saveEvidence(page, 'T8960-7-clip-play-button');

    // --- Item 9: skips hidden in edit mode too ---
    for (const title of SKIP_TITLES) {
      await expect(page.locator(`button[title="${title}"]`)).toHaveCount(0);
    }
    expect(await page.locator('button[title="Play"]:visible, button[title="Pause"]:visible').count()).toBe(1);
    await saveEvidence(page, 'T8960-9-edit-mode-skips-hidden');
  });
});
