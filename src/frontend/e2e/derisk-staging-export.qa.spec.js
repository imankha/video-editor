import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth.js';
import { waitForAppReady } from './helpers/appReady.js';

/**
 * Derisk sweep: staging smoke + export durability probe (T5400 de-hardcoded).
 *
 * Drives the REAL app as the SEEDED FIXTURE account (imankh@gmail.com / profile
 * 9fa7378c, per e2e/FIXTURE-CONTRACT.md — env-overridable via E2E_REAL_EMAIL /
 * E2E_REAL_PROFILE):
 *   login -> Clips -> open a DISCOVERED draft -> Export -> wait for the
 *   pipeline (framing render -> overlay render -> final video) -> publish
 *   ("Move to Highlight Reels") -> Highlight Reels lists the reel.
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

// Lifetime guard for the exports/active durability probe below (see its comment).
// afterEach clears it so the probe can never outlive the test that started it --
// including when the test fails or skips partway through.
let probeRunning = false;
test.afterEach(() => { probeRunning = false; });

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

/**
 * Probe whether a draft's working video will actually LOAD in the browser (T6120).
 *
 * The overlay export panel is gated on OverlayScreen's
 * `effectiveOverlayVideoUrl = workingVideo?.url` -- which only hydrates once the
 * working video's presigned R2 URL actually loads. A draft can report
 * `has_working_video=true` in the DB yet have a MISSING working-video R2 object
 * (a dangling ref -> NoSuchKey/404, e.g. after a staging wipe that dropped
 * `working_videos/` objects while keeping the profile SQLite rows + `final_videos/`
 * objects). When that happens `workingVideo` never hydrates, `effectiveOverlayVideoUrl`
 * stays null, and the panel never mounts.
 *
 * This -- NOT "framingVideoUrl not hydrated" -- is the real overlay-export-mount cause.
 * `framingVideoUrl` is irrelevant for a pre-framed single-clip draft: `workingVideo.url`
 * wins the `effectiveOverlayVideoUrl` fallback whenever the working video loads (verified
 * on staging: drafts with an intact working-video R2 object DO mount the panel).
 *
 * Returns { loads, reason } so callers can pick a loadable target and skip diagnostically.
 */
async function probeWorkingVideo(context, projectId) {
  const detail = await apiGet(context, `/projects/${projectId}`);
  const wvId = detail?.working_video_id ?? 'null';
  if (!detail?.working_video_url) {
    return { loads: false, reason: `no working_video_url (working_video_id=${wvId}) -> un-framed` };
  }
  const presign = await apiGet(context, `/projects/${projectId}/working_video/playback-url`);
  if (presign?.__status) {
    return { loads: false, reason: `playback-url returned ${presign.__status} (working_video_id=${wvId})` };
  }
  const r2Url = presign?.url;
  if (!r2Url) return { loads: false, reason: `playback-url 200 but no url: ${JSON.stringify(presign).slice(0, 120)}` };
  // GET the first bytes of the actual R2 object the <video> element would load.
  const r2 = await context.request.get(r2Url, { headers: { Range: 'bytes=0-63' } });
  if (r2.ok()) return { loads: true, reason: `working-video R2 object loads (HTTP ${r2.status()})` };
  const key = r2Url.split('?')[0].split('/').pop();
  return {
    loads: false,
    reason: `working-video R2 object MISSING (HTTP ${r2.status()} for ${key}) -> dangling ` +
      `working_video ref: DB says has_working_video=true but the R2 object is gone. The overlay ` +
      `export panel cannot mount over a video that will not load (this is NOT a framingVideoUrl issue).`,
  };
}

/** Open the Clips tab, then open a draft card by its (discovered) name. */
async function openDraftCard(page, name) {
  await page.goto('/');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: 'Clips' }) });
  await page.getByRole('button', { name: 'Clips' }).first().click({ timeout: 30000 });
  const card = page.locator('[data-testid="project-card"]').filter({ hasText: name }).first();
  await card.waitFor({ timeout: 30000 });
  await card.click();
}

// T7800 (gate run 2026-08-26): the export button was RENAMED in ExportButtonView.jsx —
// Framing mode reads "Export Focused Video( (n/m))?", Overlay mode reads "Add Overlay"
// (same onExport handler, different label). The old /^Export( \(\d+\/\d+\))?$/ matched
// neither, which presented as a phantom "overlay panel never mounted" mount-logic FAIL
// on a perfectly healthy screen.
const FRAMING_EXPORT_BTN = /^Export Focused Video( \(\d+\/\d+\))?$/;
const OVERLAY_EXPORT_BTN = /^Add Overlay$/;

test('staging export pipeline + publish (smoke + durability) @staging-gate @gate-a', async ({ context, page }) => {
  test.setTimeout(900_000);

  // Retry baked into loginAsRealUser (staging PG stale-pool 5xx blip) — T5400.
  await loginAsRealUser(context, EMAIL, PROFILE);

  // --- DISCOVER a reel draft to drive (no hardcoded id/name). Prefer one already
  //     framed (has_working_video) but not finalized -> exercises overlay -> final
  //     -> publish. Fall back to any non-finalized draft with clips.
  const projects = await listProjects(context);
  const candidates = projects.filter((p) => !p.has_final_video && !p.is_published && p.clip_count > 0);
  // Prefer a framed draft whose working video ACTUALLY LOADS (its R2 object exists) so we
  // exercise overlay -> final -> publish. T6120: a draft can report has_working_video=true
  // yet have a MISSING working-video R2 object (dangling ref, e.g. after a staging wipe) --
  // opening that one strands the overlay screen with no export panel. Probe and skip those
  // (logged), so a green run drives a draft that can genuinely reach overlay-export instead
  // of dying on a dangling ref. Fall back to any non-finalized draft with clips (Phase 1
  // then frames it, producing a fresh, loadable working video).
  let target = null;
  for (const c of candidates.filter((p) => p.has_working_video)) {
    const probe = await probeWorkingVideo(context, c.id);
    if (probe.loads) { target = c; break; }
    console.log(`[T6120] skipping draft id=${c.id} (${JSON.stringify(c.name)}) as overlay target: ${probe.reason}`);
  }
  target = target || candidates[0];
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
  //
  // MUST be cancellable. This was a bare fire-and-forget IIFE polling 180 x 3s = up
  // to 9 MINUTES with nothing to stop it, so it outlived its own test: once the test
  // ended, its next apiGet rejected with "apiRequestContext.get: Test ended." and
  // Playwright attributed that stray rejection to whatever test happened to be
  // running -- which is how game-loading.spec.js "failed" with a stack pointing into
  // THIS file. The flag + try/catch keep the probe's lifetime inside the test.
  probeRunning = true;
  (async () => {
    for (let i = 0; i < 180 && probeRunning; i++) {
      let active;
      try {
        active = await apiGet(context, '/exports/active');
      } catch {
        break; // context torn down (or the test ended) -- stop, never leak a rejection
      }
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

    // T8510: unframed clips now HARD-BLOCK the export button (Option A reversal of
    // T3700 P0), so a zero-effort export on this un-framed draft would hang on a
    // disabled button. Frame the clip with one real crop gesture (drag a handle a
    // few px -> add_crop_keyframe) before clicking Export.
    const cropHandle = page.locator('.crop-handle').first();
    if (await cropHandle.count()) {
      const hb = await cropHandle.boundingBox();
      if (hb) {
        await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
        await page.mouse.down();
        await page.mouse.move(hb.x + hb.width / 2 + 24, hb.y + hb.height / 2 + 24, { steps: 5 });
        await page.mouse.up();
        await page.waitForTimeout(800);
      }
    }

    const exportBtn = page.getByRole('button', { name: FRAMING_EXPORT_BTN }).first();
    await exportBtn.waitFor({ timeout: 30000 });
    await expect(exportBtn, 'T8510: export unlocks once the clip has a focus point').toBeEnabled({ timeout: 10000 });
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
    // The overlay Export button only mounts once Overlay mode has an EFFECTIVE video:
    // OverlayScreen's `effectiveOverlayVideoUrl = workingVideo?.url` for a pre-framed
    // draft (the framingVideoUrl pass-through is only for un-framed / multi-clip / edited
    // drafts). So the panel mounts iff the working video actually LOADS. T6120: when it
    // does not mount for a has_working_video draft the cause is almost always a MISSING
    // working-video R2 object (dangling ref -> NoSuchKey/404), NOT "framingVideoUrl not
    // hydrated" (that earlier T5420 diagnosis was wrong -- a draft with an intact
    // working-video R2 object DOES mount). Discovery above already prefers a loadable
    // draft; if none was loadable we still reach here. Wait a bounded time for the button;
    // if it never mounts, probe the ACTUAL cause and SKIP LOUDLY (never a silent green
    // pass) rather than hard-timeout. See e2e/FIXTURE-CONTRACT.md.
    const overlayExport = page.getByRole('button', { name: OVERLAY_EXPORT_BTN }).first();
    const reachedOverlayExport = await overlayExport
      .waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
    if (!reachedOverlayExport) {
      const diag = await probeWorkingVideo(context, targetId);
      console.log(`[T6120] draft id=${targetId} (${JSON.stringify(target.name)}) did not surface the ` +
        `overlay Export button on staging within 60s. Diagnosis: ${diag.reason}`);
      // More diagnostic, NOT more tolerant (T6120): split the two causes.
      //  - working video LOADS but the panel still never mounted -> a genuine mount-logic
      //    regression -> FAIL (do not skip green).
      //  - working video does NOT load (dangling ref / un-framed) -> a staging-data / fixture
      //    issue, nothing the product can do -> SKIP loudly (re-seed imankh per FIXTURE-CONTRACT).
      expect(diag.loads,
        'overlay export panel never mounted even though the working video loads -- mount-logic regression')
        .toBe(false);
      test.skip(true,
        '[T6120] discovered draft cannot reach overlay-export on staging: working video did not load ' +
        '(staging dangling-ref/fixture issue, not a mount bug) -- see diagnosis in log');
    }
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

  // --- PUBLISH: the ready-to-publish card shows "Move to Highlight Reels" ---
  await page.goto('/');
  await waitForAppReady(page, { ready: page.getByRole('button', { name: 'Clips' }) });
  await page.getByRole('button', { name: 'Clips' }).first().click({ timeout: 30000 });
  const moveBtn = page.getByRole('button', { name: /Move to Highlight Reels/i }).first();
  await moveBtn.waitFor({ timeout: 60000 });
  await page.screenshot({ path: `${EVID}/05-ready-to-publish.png` });
  await moveBtn.click();
  console.log('[derisk] Move to Highlight Reels clicked');

  // publish opens the gallery; the reel count must become >= 1
  await page.waitForTimeout(4000);
  const count = await apiGet(context, '/downloads/count');
  console.log('[derisk] downloads/count:', JSON.stringify(count));
  await page.screenshot({ path: `${EVID}/06-after-publish.png` });
  expect(count.count, 'published reel visible in Highlight Reels').toBeGreaterThanOrEqual(1);
});
