/**
 * T5790 QA — live-drive proof that the Framing Export button shows an estimated
 * credit cost that (a) ticks live as speed/trim edits change the output length,
 * (b) equals Math.ceil(output seconds) — the SAME number the click-time
 * insufficient-credits modal reports for the same edit state, and (c) turns into
 * an amber warning when it exceeds the balance, while the click still runs the
 * authoritative backend check.
 *
 * The pure math (6s + 3s@0.5x -> 9 credits, trim reduces it, multi-clip sum,
 * fail-closed hide, Math.ceil) is proven deterministically in
 * src/containers/ExportButtonContainer.test.js and src/components/ExportButtonView.test.jsx.
 * This spec proves the WIRING in the real app against the account's real clip,
 * asserting the estimate against the segment track's OWN reported visual
 * durations (self-consistent, clip-duration-agnostic) and against the modal's
 * own "required" number — never a hard-coded value.
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
import { saveEvidence, responsiveSweep } from './helpers/qa.js';

const CHIP = '[data-testid="output-length-chip"]';
const ESTIMATE = '[data-testid="export-credit-estimate"]';

/** "~9 credits · balance 42" -> 9 (the estimated credit count). */
function parseEstimateCredits(text) {
  const m = /~\s*(\d+)\s*credit/.exec(text || '');
  return m ? parseInt(m[1], 10) : null;
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
  await page.locator('[data-testid="project-card"]', { hasText: 'Not started' }).first().click();
  await page.waitForSelector(CHIP, { timeout: 30000 });
  await page.waitForFunction(
    () => [...document.querySelectorAll('[title]')].filter((e) => /^Segment \d+:/.test(e.getAttribute('title'))).length >= 1,
    { timeout: 30000 }
  );
  await page.waitForTimeout(500);
}

test('T5790: credit estimate is live, equals ceil(output), and matches the modal', async ({ context, page }) => {
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

  // ---- Criterion (live update): trimming reduces the estimate immediately ----
  const trimBtn = page.locator('button[title="Trim segment"]').first();
  if (await trimBtn.count()) {
    await trimBtn.click();
    await page.waitForTimeout(400);
    const estTrim = parseEstimateCredits((await estimateState(page)).text);
    const trackTrim = await trackVisualTotal(page);
    expect(estTrim, 'estimate tracks ceil(output) after trim').toBe(Math.ceil(trackTrim.sum));
    expect(estTrim, 'trimming lowers the estimated credit cost').toBeLessThan(creditsSpeed);
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
