/**
 * T5790 QA — live-drive proof that the Framing Export button shows an estimated
 * credit cost that (a) ticks live as speed/trim edits change the output length,
 * (b) equals Math.ceil(output seconds) — the SAME number the click-time
 * insufficient-credits modal reports for the same edit state, and (c) turns into
 * an amber warning when it exceeds the balance, while the click still runs the
 * authoritative backend check.
 *
 * T7770: also folds in the distinct T5780 assertions on the sibling "output length"
 * CHIP that moves in lockstep with the credit estimate (chip-seconds and ceil()
 * credit cost are the same output-length datum, floored vs ceiled). The two specs
 * drove a byte-identical open->split->0.5x->trim flow; this drive now asserts BOTH
 * indicators in one pass (deleted T5780.qa.spec.js):
 *   - the chip == floor(output seconds), de-emphasized when un-edited and
 *     emphasized once output differs from source;
 *   - the Framing playback timeline (source-duration readout / fps / resolution)
 *     is UNCHANGED by output edits — the output indicators are the ONLY things that
 *     move (Framing playback stays on the source timeline).
 *
 * The pure math (6s + 3s@0.5x -> 9 credits / 0:09 chip, trim reduces it, multi-clip
 * sum, fail-closed hide, Math.ceil/floor) is proven deterministically in
 * src/containers/ExportButtonContainer.test.js, src/components/ExportButtonView.test.jsx,
 * and src/utils/effectiveDuration.test.js. This spec proves the WIRING in the real
 * app against the account's real clip, asserting both indicators against the segment
 * track's OWN reported visual durations (self-consistent, clip-duration-agnostic)
 * and the estimate against the modal's own "required" number — never a hard-coded
 * value.
 *
 * The insufficient-credits path is driven WITHOUT a real render by stubbing
 * /api/credits to a zero balance: handleExport refreshes the balance (-> 0),
 * the optimistic check fails, and the modal opens and returns before any render
 * POST — so we read the modal's "required" number safely.
 *
 * Run: bash scripts/dev-verify.sh e2e/T5790-export-credit-cost-estimate.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence, responsiveSweep, assertNoHorizontalOverflow } from './helpers/qa.js';
import { skipOnDeployedTarget } from './helpers/targetEnv.js';

const CHIP = '[data-testid="output-length-chip"]';
const PROJ_CHIP = '[data-testid="project-output-length-chip"]';
const ESTIMATE = '[data-testid="export-credit-estimate"]';

/** "~9 credits · balance 42" -> 9 (the estimated credit count). */
function parseEstimateCredits(text) {
  const m = /~\s*(\d+)\s*credit/.exec(text || '');
  return m ? parseInt(m[1], 10) : null;
}

/** "Output: 1:23" -> 83 (formatTimeSimple floors, so this is floor(seconds)). */
function parseChipSeconds(text) {
  const m = /(\d+):(\d{2})/.exec(text || '');
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/** Read the output-length chip's text + whether it is emphasized (output != source). */
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

/** Sum of the segment track's own reported visual (output) durations = clip output length. */
async function trackVisualTotal(page) {
  return page.evaluate(() => {
    const els = [...document.querySelectorAll('[title]')].filter((e) =>
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

/** Scroll the export section into view and read the estimate line's state. */
async function estimateState(page) {
  const line = page.locator(ESTIMATE);
  if ((await line.count()) === 0) return null;
  await line.first().scrollIntoViewIfNeeded();
  return line.first().evaluate((el) => ({
    text: el.textContent,
    warning: el.className.includes('text-amber-400'),
  }));
}

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
  // T7750: needs an UN-STARTED (un-edited) draft (see T5780). FIXTURE-CONTRACT only promises
  // ">=1 framed project", not an un-started one, and the shared dev account's drafts drift
  // past "Not started" through ongoing QA use. Skip LOUDLY rather than hang on a locator that
  // never resolves when none is present.
  const notStarted = page.locator('[data-testid="project-card"]', { hasText: 'Not started' });
  await notStarted.first().waitFor({ timeout: 8000 }).catch(() => {});
  test.skip(
    (await notStarted.count()) === 0,
    '[T7750] no "Not started" framing draft on this account (FIXTURE-CONTRACT gap: needs an un-started draft)',
  );
  await notStarted.first().click();
  await page.waitForSelector(CHIP, { timeout: 30000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('[title]')].filter((e) => /^Segment \d+:/.test(e.getAttribute('title'))).length >= 1,
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
}

test('T5790: credit estimate is live, equals ceil(output), and matches the modal', async ({ context, page }) => {
  skipOnDeployedTarget(test, 'forces a zero-balance amber state by import()ing /src/stores/creditStore.js in-page; that Vite-dev path 404s on a deployed BUILD');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);
  await openFirstFramingDraft(page);

  // ---- Criterion 1 (baseline) + "estimate == ceil(output seconds)" ----
  await page.locator('.segment-track').first().scrollIntoViewIfNeeded();
  const est0 = await estimateState(page);
  expect(est0, 'credit estimate line renders on a real Framing clip').not.toBeNull();
  const credits0 = parseEstimateCredits(est0.text);
  expect(credits0, 'estimate parses to a positive credit count').toBeGreaterThan(0);
  const track0 = await trackVisualTotal(page);
  expect(credits0, 'estimate == Math.ceil(output seconds) — same rule as the charge')
    .toBe(Math.ceil(track0.sum));
  await saveEvidence(page, 'criterion-1-estimate-on-button');

  // ---- (T5780-fold) the sibling output-length CHIP == floor(output), de-emphasized when un-edited ----
  const chip0 = await chipState(page);
  expect(chip0, 'output-length chip renders on a real clip').not.toBeNull();
  const chipSecs0 = parseChipSeconds(chip0.text);
  expect(Math.abs(chipSecs0 - Math.floor(track0.sum)), 'chip == floor(output length) when un-edited')
    .toBeLessThanOrEqual(1);
  expect(chip0.emphasized, 'un-edited clip is de-emphasized (output == source)').toBe(false);
  // Capture the source-timeline readout (everything BUT the chip) to prove edits don't move it.
  const metaBefore = await metaRowMinusChip(page);
  await saveEvidence(page, 'T5780-chip-equals-source-when-unedited');

  // ---- Criterion 1: applying slow-mo ticks the estimate UP live, with NO save/export ----
  let segCount = await splitTrack(page, [0.5]);
  if (segCount < 2) segCount = await splitTrack(page, [0.33, 0.66]);
  expect(segCount, 'segment split produced >= 2 segments').toBeGreaterThanOrEqual(2);
  await page.locator('button[title="Set speed to 0.5x"]').first().click();
  await page.waitForTimeout(400);

  const estSpeed = await estimateState(page);
  const creditsSpeed = parseEstimateCredits(estSpeed.text);
  const trackSpeed = await trackVisualTotal(page);
  expect(creditsSpeed, 'estimate tracks ceil(output) after 0.5x').toBe(Math.ceil(trackSpeed.sum));
  expect(creditsSpeed, 'slow-mo raises the estimated credit cost live').toBeGreaterThan(credits0);
  await saveEvidence(page, 'criterion-1-estimate-live-tick-speed');

  // ---- (T5780-fold) the chip ticks live too: == floor(output), now emphasized, and grew ----
  const chipSpeed = await chipState(page);
  const chipSecsSpeed = parseChipSeconds(chipSpeed.text);
  expect(Math.abs(chipSecsSpeed - Math.floor(trackSpeed.sum)),
    'chip matches summed segment visual durations after 0.5x').toBeLessThanOrEqual(1);
  expect(chipSecsSpeed, 'chip output grows when slow-mo is applied').toBeGreaterThan(chipSecs0);
  expect(chipSpeed.emphasized, 'chip is emphasized once output differs from source').toBe(true);
  // Framing playback stays on the SOURCE timeline: the source-duration readout / fps must NOT move.
  const metaAfter = await metaRowMinusChip(page);
  expect(metaAfter, 'source-duration readout / fps unchanged by output edits (playback stays source-timeline)')
    .toBe(metaBefore);
  await saveEvidence(page, 'T5780-chip-live-tick-and-source-timeline-safe');

  // ---- Criterion (live update): trimming reduces the estimate immediately ----
  const trimBtn = page.locator('button[title="Trim segment"]').first();
  if (await trimBtn.count()) {
    await trimBtn.click();
    await page.waitForTimeout(400);
    const trackTrim = await trackVisualTotal(page);
    const estTrim = parseEstimateCredits((await estimateState(page)).text);
    expect(estTrim, 'estimate tracks ceil(output) after trim').toBe(Math.ceil(trackTrim.sum));
    expect(estTrim, 'trimming lowers the estimated credit cost').toBeLessThan(creditsSpeed);
    // The chip drops in lockstep: == floor(output) and lower than the post-speed value.
    const chipSecsTrim = parseChipSeconds((await chipState(page)).text);
    expect(Math.abs(chipSecsTrim - Math.floor(trackTrim.sum)), 'chip matches track after trim')
      .toBeLessThanOrEqual(1);
    expect(chipSecsTrim, 'trimming a segment reduces the output length chip').toBeLessThan(chipSecsSpeed);
    await saveEvidence(page, 'criterion-trim-lowers-estimate');
  }

  // Snapshot the current (live) estimate for the modal-match assertion.
  const estBeforeWarn = parseEstimateCredits((await estimateState(page)).text);

  // ---- Criterion 3: estimate > balance -> amber warning; click still hits the backend check ----
  // Stub /api/credits to a zero balance so both the live line AND the click-time
  // refresh see 0 — the optimistic check then opens the modal and returns before
  // any render POST (safe: no real export is started).
  await page.route('**/api/credits', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balance: 0 }) })
  );
  await page.evaluate(async () => {
    const { useCreditStore } = await import('/src/stores/creditStore.js');
    await useCreditStore.getState().fetchCredits();
  });
  await page.waitForTimeout(300);

  const estWarn = await estimateState(page);
  expect(estWarn.warning, 'estimate renders amber when it exceeds the balance').toBe(true);
  expect(estWarn.text, 'warning copy invites the user to add credits before clicking').toMatch(/add credits/i);
  await saveEvidence(page, 'criterion-3-estimate-warning');

  // Click Export -> authoritative flow -> insufficient-credits modal with the SAME number.
  await page.locator('button', { hasText: /^Export/ }).first().scrollIntoViewIfNeeded();
  await page.locator('button', { hasText: /^Export/ }).first().click();
  const modal = page.locator('text=/This export requires/');
  await expect(modal, 'clicking Export runs the authoritative check and opens the modal').toBeVisible({ timeout: 15000 });
  const modalRequired = parseInt(/requires\s+(\d+)\s*credits/.exec(await modal.textContent())[1], 10);
  expect(modalRequired, 'the modal "required" == the number shown on the button (never disagree)')
    .toBe(estBeforeWarn);
  await saveEvidence(page, 'criterion-2-modal-matches-button');

  await page.unroute('**/api/credits');
  expect(errors, 'no page errors during the drive').toEqual([]);
});

test('T5790: estimate line is present and non-overflowing on mobile + desktop (criterion 6)', async ({ context, page }) => {
  await loginAsRealUser(context, 'imankh@gmail.com', '9fa7378c');
  await page.goto('/');
  await page.waitForTimeout(1500);
  await openFirstFramingDraft(page);

  await responsiveSweep(page, async () => {
    const line = page.locator(ESTIMATE).first();
    await line.scrollIntoViewIfNeeded().catch(() => {});
    await expect(line, 'credit estimate visible at this viewport').toBeVisible({ timeout: 10000 });
  });
});

// T7770: folded from T5780 (multi-clip criterion 4). The PROJECT total output-length
// chip is a distinct indicator (hidden for single-clip projects — redundant with the
// per-clip chip); its summed-total wiring is not exercised by the single-clip drive above.
test('T5790/T5780: multi-clip project shows a correct live output total (criterion 4)', async ({ context, page }) => {
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
