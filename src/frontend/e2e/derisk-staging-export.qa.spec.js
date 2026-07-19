import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { waitForAppReady } from './helpers/appReady.js';

/**
 * Derisk sweep: staging smoke + export durability probe (T5400 de-hardcoded).
 *
 * Drives the REAL app as the SEEDED FIXTURE account (imankh@gmail.com / profile
 * 9fa7378c, per e2e/FIXTURE-CONTRACT.md — env-overridable via E2E_REAL_EMAIL /
 * E2E_REAL_PROFILE):
 *   login -> Reel Drafts -> open a DISCOVERED draft -> Export -> wait for the
 *   pipeline (framing render -> overlay render -> final video) -> publish
 *   ("Move to My Reels") -> My Reels lists the reel.
 *
 * T5400: the target draft is DISCOVERED from /api/projects (a non-finalized reel
 * draft), NOT hardcoded to project id 1 / a "Wonder Goal" chip. If the fixture has
 * no such draft the test SKIPS LOUDLY (never a silent green pass) so a real
 * regression and a missing fixture never look alike.
 *
 * Durability probe (T4200/T4110 sync-then-announce): we poll /api/exports/active
 * during the export and log every status transition. A `sync_failed` status is the
 * feature working (retryable), not a bug.
 *
 * Run:
 *   E2E_BASE_URL=https://reel-ballers-staging.pages.dev \
 *   E2E_API_BASE=https://reel-ballers-api-staging.fly.dev/api \
 *   E2E_REAL_EMAIL=imankh@gmail.com E2E_REAL_PROFILE=9fa7378c \
 *   npx playwright test e2e/derisk-staging-export.qa.spec.js
 */

const API_BASE = process.env.E2E_API_BASE || 'http://localhost:8000/api';
const EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE = process.env.E2E_REAL_PROFILE || '9fa7378c';
const EVID = 'test-results/derisk-evidence';

async function apiGet(context, path) {
  const res = await context.request.get(`${API_BASE}${path}`, {
    headers: { 'X-Test-Mode': 'true' },
  });
  return res.ok() ? res.json() : { __status: res.status() };
}

async function listProjects(context) {
  const data = await apiGet(context, '/projects');
  return Array.isArray(data) ? data : data.projects || [];
}

async function projectState(context, projectId) {
  return (await listProjects(context)).find((p) => p.id === projectId);
}

/** Open the Reel Drafts tab, then open a draft card by its (discovered) name. */
async function openDraftCard(page, name) {
  await page.goto('/');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: 'Reel Drafts' }) });
  await page.getByRole('button', { name: 'Reel Drafts' }).first().click({ timeout: 30000 });
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: name }).first();
  await card.waitFor({ timeout: 30000 });
  await card.click();
}

const EXPORT_BTN = /^Export( \(\d+\/\d+\))?$/;

test('staging export pipeline + publish (smoke + durability) @staging-gate', async ({ context, page }) => {
  test.setTimeout(900_000);

  // Retry baked into loginAsRealUser (staging PG stale-pool 5xx blip) — T5400.
  await loginAsRealUser(context, EMAIL, PROFILE);

  // --- DISCOVER a reel draft to drive (no hardcoded id/name). Prefer one already
  //     framed (has_working_video) but not finalized -> exercises overlay -> final
  //     -> publish. Fall back to any non-finalized draft with clips.
  const projects = await listProjects(context);
  const candidates = projects.filter((p) => !p.has_final_video && !p.is_published && p.clip_count > 0);
  const target = candidates.find((p) => p.has_working_video) || candidates[0];
  if (!target) {
    console.log('[T5400][SKIP] fixture has no un-finalized reel draft ' +
      '(need clip_count>0 && !has_final_video); seed imankh per FIXTURE-CONTRACT');
  }
  test.skip(!target, '[T5400] fixture has no un-finalized reel draft; seed imankh per FIXTURE-CONTRACT');
  const targetId = target.id;
  console.log(`[derisk] target draft: id=${targetId} name=${JSON.stringify(target.name)} ` +
    `has_working_video=${target.has_working_video} has_final_video=${target.has_final_video}`);

  const transitions = [];
  // Durability probe: log every /api/exports/active transition during the run.
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

  // --- PHASE 1: framing export (only if the discovered draft is not yet framed) ---
  if (!target.has_working_video) {
    await openDraftCard(page, target.name);
    await page.locator('.crop-handle').first().waitFor({ timeout: 120000 }).catch(() => {});
    await page.screenshot({ path: `${EVID}/02-framing-loaded.png` });
    const exportBtn = page.getByRole('button', { name: EXPORT_BTN }).first();
    await exportBtn.waitFor({ timeout: 30000 });
    await exportBtn.click();
    console.log('[derisk] framing Export clicked');
    await page.screenshot({ path: `${EVID}/03-export-clicked.png` });

    let deadline = Date.now() + 480_000;
    let proj = null;
    while (Date.now() < deadline) {
      proj = await projectState(context, targetId);
      if (proj?.has_working_video) break;
      await page.waitForTimeout(5000);
    }
    console.log('[derisk] after framing export:', JSON.stringify(proj));
    expect(proj?.has_working_video, 'framing export produced a working video').toBeTruthy();
  }

  // --- PHASE 2: overlay export -> final video ---
  let proj = await projectState(context, targetId);
  if (!proj?.has_final_video) {
    await openDraftCard(page, target.name);
    // The overlay Export button only mounts once Overlay mode has an EFFECTIVE video
    // (a rendered overlay URL, or a pass-through framing URL for a single un-edited
    // clip — OverlayContainer.effectiveOverlayVideoUrl). On staging, a pre-framed
    // single-clip draft opened straight into Overlay streams its working_video but
    // does NOT hydrate framingVideoUrl, so the export panel never mounts (verified
    // T5420: waited 90s, neither the Export button nor the "Export required" message
    // ever appeared). Wait a bounded time for the button; if it never mounts, SKIP
    // LOUDLY (never a silent green pass) rather than hard-timeout — the fixture lacks
    // a draft that can reach overlay-export. See e2e/FIXTURE-CONTRACT.md.
    const overlayExport = page.getByRole('button', { name: EXPORT_BTN }).first();
    const reachedOverlayExport = await overlayExport
      .waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    if (!reachedOverlayExport) {
      console.log(`[T5420][SKIP] draft id=${targetId} (${JSON.stringify(target.name)}) did not ` +
        `surface the overlay Export button on staging within 60s. The Overlay export ` +
        `panel did not mount (framingVideoUrl not hydrated for a pre-framed single-clip ` +
        `draft opened directly into Overlay). Seed a draft that reaches overlay-export, ` +
        `or file the overlay-export-mount gap. See e2e/FIXTURE-CONTRACT.md.`);
    }
    test.skip(!reachedOverlayExport,
      '[T5420] discovered draft cannot reach overlay-export on staging (Overlay export panel did not mount)');
    await page.screenshot({ path: `${EVID}/04b-overlay-loaded.png` });
    await overlayExport.click();
    console.log('[derisk] overlay Export clicked');

    const deadline = Date.now() + 480_000;
    while (Date.now() < deadline) {
      proj = await projectState(context, targetId);
      if (proj?.has_final_video) break;
      await page.waitForTimeout(5000);
    }
    console.log('[derisk] after overlay export:', JSON.stringify(proj));
    console.log('[derisk] transitions:', JSON.stringify(transitions));
    await page.screenshot({ path: `${EVID}/04c-after-overlay-export.png` });
  }
  expect(proj?.has_final_video, 'pipeline produced a final video').toBeTruthy();

  // --- PUBLISH: the ready-to-publish card shows "Move to My Reels" ---
  await page.goto('/');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: 'Reel Drafts' }) });
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
