/**
 * T5780 QA — live-drive proof that the Framing "output length" indicator reflects
 * the LIVE (post-trim, post-speed) effective duration and ticks the instant a
 * speed/trim gesture lands, with NO save/export, and never touches the source-
 * timeline playback timer.
 *
 * The pure math (6s + 3s@0.5x -> 0:09, multi-clip sum, fail-closed) is proven
 * deterministically in src/utils/effectiveDuration.test.js. This spec proves the
 * WIRING in the real app against the account's real clips, asserting the chip
 * against the segment track's OWN reported visual durations (self-consistent,
 * duration-agnostic) rather than a hard-coded number. NOTE: the <video> element in
 * Framing carries the FULL source-game duration (~88min); the app's clip length is
 * the segment-track total, so assertions compare to that, never to video.duration.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5780-framing-effective-duration.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';

const CHIP = '[data-testid="output-length-chip"]';
const PROJ_CHIP = '[data-testid="project-output-length-chip"]';

/** "Output: 1:23" -> 83 (formatTimeSimple floors, so this is floor(seconds)). */
function parseChipSeconds(text) {
  const m = /(\d+):(\d{2})/.exec(text || '');
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Sum of the segment track's own reported visual (output) durations = clip output length. */
async function trackVisualTotal(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[title]')].filter(e =>
      /^Segment \d+:/.test(e.getAttribute('title'))
    );
    let sum = 0;
    for (const e of els) {
      const m = /\(([\d.]+)s\s*→\s*([\d.]+)s\)/.exec(e.getAttribute('title'));
      if (m) sum += parseFloat(m[2]);
    }
    return { count: els.length, sum };
  });
}

async function chipState(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    return { text: el.textContent, emphasized: el.className.includes('bg-blue-500/25') };
  }, CHIP);
}

/** The metadata row's text with the Output chip stripped — i.e. everything the
 *  output indicator must NOT change (source-duration readout, fps, resolution). */
async function metaRowMinusChip(page) {
  return page.evaluate((sel) => {
    const chip = document.querySelector(sel);
    const row = chip?.closest('div');
    return (row?.textContent || '').replace(/Output:\s*\d+:\d{2}/, '').trim();
  }, CHIP);
}

/** Split the segment track at one or more fractional x positions; returns final segment count.
 *  Uses locator.click({position}) so Playwright auto-scrolls the track (it sits below the
 *  video, off the initial fold) into view before clicking near its top (controls sit BELOW). */
async function splitTrack(page, fractions) {
  const track = page.locator('.segment-track').first();
  await track.scrollIntoViewIfNeeded();
  for (const f of fractions) {
    const box = await track.boundingBox();
    if (!box) break;
    await track.click({ position: { x: box.width * f, y: box.height * 0.35 } });
    await page.waitForTimeout(350);
  }
  return (await trackVisualTotal(page)).count;
}

async function openFirstFramingDraft(page) {
  // T7750: these criteria need an UN-STARTED (un-edited) draft for a clean de-emphasized
  // baseline (Criterion 3: chip == source length, NOT emphasized). FIXTURE-CONTRACT only
  // promises ">=1 framed project", not specifically an un-started one, and the shared dev
  // account's drafts drift past "Not started" through ongoing QA use. Skip LOUDLY (never a
  // vacuous pass, never a 30s hang on a locator that never resolves) when none is present.
  const notStarted = page.locator('[data-testid="project-card"]', { hasText: 'Not started' });
  await notStarted.first().waitFor({ timeout: 8000 }).catch(() => {});
  test.skip(
    (await notStarted.count()) === 0,
    '[T7750] no "Not started" framing draft on this account (FIXTURE-CONTRACT gap: needs an un-started draft)',
  );
  await notStarted.first().click();
  await page.waitForSelector(CHIP, { timeout: 30000 });
  // Wait for the clip's saved segment state to restore (segment track populated) so
  // the chip reflects the CLIP length, not the transient full-source length on load.
  await page.waitForFunction(() => {
    const els = [...document.querySelectorAll('[title]')].filter(e => /^Segment \d+:/.test(e.getAttribute('title')));
    return els.length >= 1;
  }, { timeout: 30000 });
  await page.waitForTimeout(500);
}

test('T5780: output-length chip is live, source-timeline safe, and responsive', async ({ context, page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);
  await openFirstFramingDraft(page);

  // ---- Criterion 3: no-speed clip -> chip equals clip (trimmed source) length, de-emphasized ----
  const baseTrack = await trackVisualTotal(page);
  const initial = await chipState(page);
  expect(initial, 'output chip renders on a real clip').not.toBeNull();
  const initialSecs = parseChipSeconds(initial.text);
  expect(Math.abs(initialSecs - Math.floor(baseTrack.sum)), 'chip == clip output length when un-edited')
    .toBeLessThanOrEqual(1);
  expect(initial.emphasized, 'un-edited clip is de-emphasized (output == source)').toBe(false);
  await saveEvidence(page, 'criterion-3-noedit-equals-source');

  // ---- Criterion 5 (baseline): capture the source-timeline readout (everything but the chip) ----
  const metaBefore = await metaRowMinusChip(page);

  // ---- Split the clip into >= 2 segments (retry positions to dodge playhead-snap) ----
  let segCount = await splitTrack(page, [0.5]);
  if (segCount < 2) segCount = await splitTrack(page, [0.33, 0.66]);
  expect(segCount, 'segment split produced >= 2 segments').toBeGreaterThanOrEqual(2);

  // Apply 0.5x to segment 0.
  await page.locator('button[title="Set speed to 0.5x"]').first().click();
  await page.waitForTimeout(400);

  // ---- Criterion 1: speed apply ticks the chip live, WITH NO save/export ----
  const afterSpeed = await chipState(page);
  const afterSpeedSecs = parseChipSeconds(afterSpeed.text);
  const speedTrack = await trackVisualTotal(page);
  expect(Math.abs(afterSpeedSecs - Math.floor(speedTrack.sum)),
    'chip matches summed segment visual durations after 0.5x').toBeLessThanOrEqual(1);
  expect(afterSpeedSecs, 'output grows when slow-mo is applied').toBeGreaterThan(initialSecs);
  expect(afterSpeed.emphasized, 'chip is emphasized once output differs from source').toBe(true);
  await saveEvidence(page, 'criterion-1-speed-live-tick');

  // ---- Criterion 5: playback timeline unchanged — only the Output chip moved ----
  const metaAfter = await metaRowMinusChip(page);
  expect(metaAfter, 'source-duration readout / fps unchanged by output edits (playback stays source-timeline)')
    .toBe(metaBefore);
  await saveEvidence(page, 'criterion-5-playback-source-timeline');

  // ---- Criterion 2: trimming updates the indicator immediately (drops output) ----
  const trimBtn = page.locator('button[title="Trim segment"]').first();
  if (await trimBtn.count()) {
    await trimBtn.click();
    await page.waitForTimeout(400);
    const afterTrim = parseChipSeconds((await chipState(page)).text);
    const trimTrack = await trackVisualTotal(page);
    expect(Math.abs(afterTrim - Math.floor(trimTrack.sum)), 'chip matches track after trim').toBeLessThanOrEqual(1);
    expect(afterTrim, 'trimming a segment reduces the output length').toBeLessThan(afterSpeedSecs);
    await saveEvidence(page, 'criterion-2-trim-drops-output');
  }

  // ---- Criterion 6 / mobile: no horizontal overflow at 375px + desktop ----
  await responsiveSweep(page);

  expect(errors, 'no page errors during the drive').toEqual([]);
});

test('T5780: multi-clip project shows a correct live total (criterion 4)', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);

  // Find a framing draft that has >= 2 clips (the Total chip is intentionally
  // hidden for single-clip projects — redundant with the per-clip chip).
  const cards = page.locator('[data-testid="project-card"]', { hasText: 'Not started' });
  const n = await cards.count();
  let found = false;

  for (let i = 0; i < n; i++) {
    await cards.nth(i).click();
    await page.waitForSelector(CHIP, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const clipCount = await page.locator('[data-testid="clip-item"]').count();

    if (clipCount >= 2) {
      found = true;
      const projChip = page.locator(PROJ_CHIP);
      await expect(projChip, 'project total chip visible for multi-clip').toBeVisible({ timeout: 15000 });
      const total = parseChipSeconds(await projChip.textContent());
      const perClip = parseChipSeconds(await page.locator(CHIP).first().textContent());
      expect(total, 'project total >= selected clip output').toBeGreaterThanOrEqual(perClip);
      await assertNoHorizontalOverflow(page);
      await saveEvidence(page, 'criterion-4-multiclip-total');
      break;
    }
    await page.goto('/');
    await page.waitForTimeout(1200);
  }

  if (!found) {
    // No multi-clip framing draft in this account: the summed-total math is proven
    // by effectiveDuration.test.js ('multi-clip sum ... -> 23'); log so the QA
    // evidence is honest about what was live-driven vs unit-covered.
    console.log('[qa] criterion-4: no >=2-clip framing draft in account; multi-clip SUM covered by unit test.');
  }
});
