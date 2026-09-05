/**
 * T8820 QA — the multi-file confirm strip + reorder editor, driven end-to-end in a
 * real browser (not jsdom). This is the live-drive the intake arc owes: T8810
 * disclosed a manual-verification gap (real folder/device needed), but this screen
 * needs neither — we synthesize four tiny-but-VALID MP4 segments with ffmpeg,
 * stamping each with an explicit creation_time so useFootageIntake probes a real
 * embedded-time chain (seg1/2 continuous, a ~9-min break, seg3/4 continuous), the
 * exact shape of the DJI evidence fixture.
 *
 * It proves the acceptance criteria that unit tests can only approximate:
 *   - the strip renders from a REAL probe (4 chips, green time trust line, one
 *     "9 min break" gap connector);
 *   - "Adjust order" opens the reorder editor and a real pointer drag reorders,
 *     flipping the trust line to "Order set by you";
 *   - submit ("Add Game") is NEVER gated by ordering — enabled throughout;
 *   - no horizontal overflow at 360 / 390 / 428 px.
 *
 * Emulates phone VIEWPORTS on the chromium engine (the honest limit documented in
 * playwright.config.js) — the responsive sweep measures geometry, and the drag uses
 * Pointer Events which chromium's mouse synthesizes.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8820-confirm-strip-reorder.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertNoHorizontalOverflow, saveEvidence } from './helpers/qa.js';

// Four segments: a continuous pair, a >2-min (9-min) break, then another pair.
const SEGMENTS = [
  { name: 'DJI_0003.MP4', at: '2026-09-05T14:00:00' },
  { name: 'DJI_0004.MP4', at: '2026-09-05T14:00:30' },
  { name: 'DJI_0005.MP4', at: '2026-09-05T14:09:30' },
  { name: 'DJI_0006.MP4', at: '2026-09-05T14:10:00' },
];

let fixtureDir;
let fixturePaths;

test.beforeAll(() => {
  fixtureDir = mkdtempSync(path.join(tmpdir(), 't8820-'));
  fixturePaths = SEGMENTS.map((seg) => {
    const out = path.join(fixtureDir, seg.name);
    // Tiny valid H.264 MP4, faststart (moov in the head bytes the probe reads),
    // with an explicit mvhd creation_time so the order-by-time chain is deterministic.
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-metadata', `creation_time=${seg.at}`, out,
    ], { stdio: 'ignore' });
    return out;
  });
});

async function openAddGameModalWithFootage(page) {
  // Empty-session bypass (src/frontend/CLAUDE.md): the new-user "Add your first
  // game" surface, no real account / R2 needed.
  await page.goto('/home/games', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    await fetch('/api/auth/test-login', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'X-Test-Mode': 'true' },
    });
  });
  await page.evaluate(async () => {
    const { useAuthStore } = await import('/src/stores/authStore.js');
    useAuthStore.setState({ isAuthenticated: true, email: 'test@e2e.local', showAuthModal: false });
  });
  await page.goto('/home/games', { waitUntil: 'domcontentloaded' });

  const addCta = page.getByRole('button', { name: /^Add Game$/ }).first();
  await addCta.waitFor({ state: 'visible', timeout: 30000 });
  await addCta.click();
  await expect(page.getByText('Add New Game')).toBeVisible();

  // Feed the four segments through the (hidden) multi-select input.
  await page.setInputFiles('[data-testid="footage-file-input"]', fixturePaths);
  await expect(page.getByTestId('footage-strip')).toBeVisible({ timeout: 30000 });
}

test('confirm strip renders a real probed time-chain and submit is never gated', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  await openAddGameModalWithFootage(page);

  // 4 chips, green time trust line, one non-huge "9 min break" gap connector.
  await expect(page.getByTestId('footage-chip')).toHaveCount(4);
  const trust = page.getByTestId('footage-trust-line');
  await expect(trust).toHaveText('Put in order by the time each was recorded');
  const connectors = page.getByTestId('footage-gap-connector');
  await expect(connectors).toHaveCount(1);
  await expect(connectors.first()).toContainText('9 min break');
  await expect(connectors.first()).toHaveAttribute('data-huge', 'false');

  // Submit is enabled from the start — ordering ambiguity NEVER gates Add Game.
  const submit = page.getByRole('button', { name: /^Add Game$/ }).last();
  await expect(submit).toBeEnabled();

  await saveEvidence(page, 't8820-strip');
  await context.close();
});

test('a real pointer drag reorders and flips the trust line to manual', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  await openAddGameModalWithFootage(page);

  await page.getByTestId('footage-adjust-order').click();
  await expect(page.getByTestId('footage-reorder-list')).toBeVisible();

  // Drag row 0's handle down past row 2 with a real pointer.
  const handle = page.getByTestId('footage-reorder-handle-0');
  const rows = page.getByTestId('footage-reorder-row');
  const from = await handle.boundingBox();
  const target = await rows.nth(2).boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height, { steps: 4 });
  await page.mouse.up();

  await expect(page.getByTestId('footage-trust-line')).toHaveText('Order set by you');

  // Submit still enabled after the manual reorder.
  await expect(page.getByRole('button', { name: /^Add Game$/ }).last()).toBeEnabled();

  await page.getByTestId('footage-reorder-done').click();
  await expect(page.getByTestId('footage-reorder-list')).toHaveCount(0);

  await context.close();
});

test('no horizontal overflow at 360 / 390 / 428 px', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({ browserName: 'chromium', serviceWorkers: 'block' });
  await context.setExtraHTTPHeaders({ 'X-User-ID': 'manual-test-user', 'X-Test-Mode': 'true' });
  const page = await context.newPage();

  await openAddGameModalWithFootage(page);
  await page.getByTestId('footage-adjust-order').click();
  await expect(page.getByTestId('footage-reorder-list')).toBeVisible();

  for (const width of [360, 390, 428]) {
    await page.setViewportSize({ width, height: 780 });
    await page.waitForTimeout(250); // let responsive layout settle
    await assertNoHorizontalOverflow(page);
    await saveEvidence(page, `t8820-responsive-${width}`);
  }

  await context.close();
});
