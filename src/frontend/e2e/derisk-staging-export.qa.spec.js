import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';

/**
 * Derisk sweep (2026-07-12): staging smoke + export durability probe.
 *
 * Drives the REAL staging app as the dedicated test account (e2e@test.local):
 *   login -> Reel Drafts -> open framing draft -> Export -> wait for the
 *   pipeline (framing render -> overlay render -> final video) -> publish
 *   ("Move to My Reels") -> My Reels lists the reel.
 *
 * Durability probe (T4200/T4110 sync-then-announce): we poll
 * /api/exports/active during the export and log every status transition.
 * A `sync_failed` status is the feature working (retryable), not a bug.
 *
 * Run:
 *   E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
 *   E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
 *   E2E_REAL_EMAIL=e2e@test.local \
 *   npx playwright test e2e/derisk-staging-export.qa.spec.js
 */

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const EMAIL = process.env.E2E_REAL_EMAIL || 'e2e@test.local';
const EVID = 'test-results/derisk-evidence';

async function apiGet(context, path) {
  const res = await context.request.get(`${API_BASE}${path}`, {
    headers: { 'X-Test-Mode': 'true' },
  });
  return res.ok() ? res.json() : { __status: res.status() };
}

async function projectState(context, projectId) {
  const data = await apiGet(context, '/projects');
  const list = Array.isArray(data) ? data : data.projects || [];
  return list.find((p) => p.id === projectId);
}

test('staging export pipeline + publish (smoke + durability)', async ({ context, page }) => {
  test.setTimeout(900_000);

  // Staging PG pool serves a dead connection after idle -> first login can 500.
  // Retry up to 3x (documented finding; retry always succeeds).
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try { await loginAsRealUser(context, EMAIL); lastErr = null; break; }
    catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 2000)); }
  }
  if (lastErr) throw lastErr;

  // --- home -> Reel Drafts -> open the first framing draft
  await page.goto('/');
  await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 30000 });
  await page.screenshot({ path: `${EVID}/01-reel-drafts.png` });

  const transitions = [];
  const alreadyFramed = (await projectState(context, 1))?.has_working_video;
  if (!alreadyFramed) {

  // Target project 1's chip by NAME (a generic first() chip can hit the wrong draft)
  const framingChip = page.getByTitle(/Wonder Goal.*\(click to open\)/).first();
  await framingChip.waitFor({ timeout: 30000 });
  await framingChip.click();
  await page.locator('.crop-handle').first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${EVID}/02-framing-loaded.png` });

  // --- export from framing; watch /api/exports/active transitions
  (async () => {
    for (let i = 0; i < 180; i++) {
      const active = await apiGet(context, '/exports/active');
      const list = Array.isArray(active) ? active : active.exports || [];
      const sig = JSON.stringify(list.map((e) => `${e.project_id ?? e.export_id}:${e.status}`));
      if (transitions[transitions.length - 1] !== sig) {
        transitions.push(sig);
        console.log(`[derisk] exports/active -> ${sig}`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  })();

  const exportBtn = page.getByRole('button', { name: /^Export( \(\d+\/\d+\))?$/ }).first();
  await exportBtn.waitFor({ timeout: 30000 });
  await exportBtn.click();
  console.log('[derisk] framing Export clicked');
  await page.screenshot({ path: `${EVID}/03-export-clicked.png` });
  } // end !alreadyFramed

  // --- wait until the framing render lands (working video), max 8 min
  let proj = null;
  let deadline = Date.now() + 480_000;
  while (Date.now() < deadline) {
    proj = await projectState(context, 1);
    if (proj?.has_working_video) break;
    await page.waitForTimeout(5000);
  }
  console.log('[derisk] after framing export:', JSON.stringify(proj));
  console.log('[derisk] transitions:', JSON.stringify(transitions));
  await page.screenshot({ path: `${EVID}/04-after-export.png` });
  expect(proj?.has_working_video, 'framing export produced a working video').toBeTruthy();

  // --- overlay step: open the draft (now in Overlay) and export the final
  if (!proj.has_final_video) {
    await page.goto('/');
    await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 30000 });
    // Project 1 is the started-overlay draft; project 2's chip says "Not Started"
    const overlayChip = page.getByTitle(/Overlay: Started.*\(click to open\)/).first();
    await overlayChip.waitFor({ timeout: 30000 });
    await overlayChip.click();
    // overlay editor ready: its Export button appears
    const overlayExport = page.getByRole('button', { name: /^Export( \(\d+\/\d+\))?$/ }).first();
    await overlayExport.waitFor({ timeout: 120000 });
    await page.screenshot({ path: `${EVID}/04b-overlay-loaded.png` });
    await overlayExport.click();
    console.log('[derisk] overlay Export clicked');

    deadline = Date.now() + 480_000;
    while (Date.now() < deadline) {
      proj = await projectState(context, 1);
      if (proj?.has_final_video) break;
      await page.waitForTimeout(5000);
    }
    console.log('[derisk] after overlay export:', JSON.stringify(proj));
    await page.screenshot({ path: `${EVID}/04c-after-overlay-export.png` });
  }
  expect(proj?.has_final_video, 'pipeline produced a final video').toBeTruthy();

  // --- publish: Reel Drafts card shows "Move to My Reels"
  await page.goto('/');
  await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 30000 });
  const moveBtn = page.getByRole('button', { name: /Move to My Reels/i }).first();
  await moveBtn.waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${EVID}/05-ready-to-publish.png` });
  await moveBtn.click();
  console.log('[derisk] Move to My Reels clicked');

  // publish opens the gallery; the reel count must become >= 1
  await page.waitForTimeout(4000);
  const count = await apiGet(context, '/downloads/count');
  console.log('[derisk] downloads/count:', JSON.stringify(count));
  await page.screenshot({ path: `${EVID}/06-after-publish.png` });
  expect(count.count, 'published reel visible in My Reels').toBeGreaterThanOrEqual(1);
});
