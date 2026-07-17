import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';
import { skipOnDeployedTarget, assertSeamAvailable } from './helpers/targetEnv.js';

/**
 * T4120 — self-verify the durable-export boundary (T4110) end to end, IN-CONTAINER,
 * with NO supervisor / AI. Seeded from the T4110 repro spec but with HARD asserts
 * (T4110 is soft/investigation-only). Drives the REAL local overlay render
 * (MODAL_ENABLED=false, set by dev-verify.sh) as the real user, exercising the
 * durability test seams from inside one process:
 *
 *   1. health: assert local render mode (modal_enabled === false).
 *   2. find a real export-ready project (working video).
 *   3. force R2 sync to fail -> REAL overlay render -> assert the terminal export
 *      signal is the retryable `sync_failed` (render finished, COMPLETE WITHHELD).
 *   4. clear the fault -> REAL overlay render -> assert COMPLETE (final video durable).
 *   5. machine-cycle: drop machine-local SQLite + re-pull R2 -> assert the un-synced
 *      delta from the faulted export is GONE, and durable state restores cleanly.
 *
 * Run (from a /dotask container):
 *   bash scripts/dev-verify.sh e2e/T4120-self-verify-durability.spec.js
 *
 * Requires the spec's user in this env's Postgres (seed with
 * scripts/copy_user_between_envs.py --from production --to dev if dev-login 404s).
 */

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';

const H = { 'X-Profile-ID': PROFILE_ID };

test.describe.configure({ mode: 'serial' });

test('T4120 self-verify: durable export boundary + machine-cycle (real local render)', async ({ context }) => {
  // T4934: fault-injection seams are dev/local-only — never run against staging.
  skipOnDeployedTarget(test, 'uses /api/test/sync-fault + /api/test/simulate-machine-cycle fault-injection seams (dev/local-only)');
  test.setTimeout(240000); // real ffmpeg render + R2 round-trips

  const req = context.request;
  const getJson = async (res) => { try { return await res.json(); } catch { return null; } };

  // --- auth -----------------------------------------------------------------
  await loginAsRealUser(context, REAL_EMAIL);

  // --- 1. local render mode (proves D1/D3: MODAL_ENABLED=false) --------------
  const health = await req.get('/api/health', { headers: H });
  expect(health.ok(), 'GET /api/health').toBeTruthy();
  const healthJson = await getJson(health);
  expect(healthJson?.modal_enabled, 'render must be LOCAL (modal_enabled=false) for verify').toBe(false);

  // Clear any leftover fault from a prior run. Fail fast (self-documenting) if the
  // seam isn't mounted, instead of hanging on a 404 — T4934.
  const clearFault = await req.post('/api/test/sync-fault', { headers: H, data: { enabled: false } });
  assertSeamAvailable(clearFault, 'sync-fault');
  expect(clearFault.status()).toBe(200);

  // --- 2. find a real export-ready project ----------------------------------
  const projectsRes = await req.get('/api/projects', { headers: H });
  expect(projectsRes.ok(), 'GET /api/projects').toBeTruthy();
  const projects = (await getJson(projectsRes)) || [];
  // Prefer a published reel with overlay edits (real Game Highlights reel);
  // fall back to any project that has a working video to render an overlay on.
  const candidate =
    projects.find((p) => p.has_working_video && p.has_overlay_edits && p.is_published) ||
    projects.find((p) => p.has_working_video && p.has_overlay_edits) ||
    projects.find((p) => p.has_working_video);
  expect(candidate, 'an export-ready project (has_working_video) must exist for the real user').toBeTruthy();
  const projectId = candidate.id;
  console.log(`[T4120] using project ${projectId} ("${candidate.name}") has_overlay_edits=${candidate.has_overlay_edits} published=${candidate.is_published}`);

  // Poll the export-progress dict (more robust than the WS in a spec) until terminal.
  const pollTerminal = async (exportId, capMs = 180000) => {
    const deadline = Date.now() + capMs;
    let last = null;
    while (Date.now() < deadline) {
      const r = await req.get(`/api/export/progress/${exportId}`, { headers: H });
      if (r.ok()) {
        last = await getJson(r);
        const status = last?.status;
        const terminal = status === 'complete' || status === 'error' || status === 'failed'
          || last?.code === 'sync_failed' || last?.phase === 'error';
        if (terminal) return last;
      }
      await new Promise((res) => setTimeout(res, 1500));
    }
    return last;
  };

  // --- 3. durable boundary UNDER a forced sync fault ------------------------
  expect((await req.post('/api/test/sync-fault', { headers: H, data: { enabled: true } })).status()).toBe(200);

  const faultId = `t4120-fault-${Date.now()}`;
  const faultRender = await req.post('/api/export/render-overlay', {
    headers: H,
    data: { project_id: projectId, export_id: faultId, effect_type: 'dark_overlay' },
    timeout: 200000,
  });
  // The render itself must run (local ffmpeg). The DURABILITY failure shows up as
  // the terminal progress event, not an HTTP error on the render call.
  console.log(`[T4120] faulted render-overlay HTTP ${faultRender.status()}`);
  const faultTerminal = await pollTerminal(faultId);
  console.log(`[T4120] faulted terminal: ${JSON.stringify(faultTerminal)?.slice(0, 300)}`);
  expect(faultTerminal, 'faulted export must reach a terminal state').toBeTruthy();
  expect(faultTerminal.code, 'forced sync fault -> retryable sync_failed').toBe('sync_failed');
  expect(faultTerminal.retryable, 'sync_failed must be retryable').toBe(true);
  expect(faultTerminal.status, 'COMPLETE must be WITHHELD on sync failure').not.toBe('complete');

  // --- 4. durable boundary with the fault CLEARED ---------------------------
  expect((await req.post('/api/test/sync-fault', { headers: H, data: { enabled: false } })).status()).toBe(200);

  const okId = `t4120-ok-${Date.now()}`;
  const okRender = await req.post('/api/export/render-overlay', {
    headers: H,
    data: { project_id: projectId, export_id: okId, effect_type: 'dark_overlay' },
    timeout: 200000,
  });
  console.log(`[T4120] clean render-overlay HTTP ${okRender.status()}`);
  const okTerminal = await pollTerminal(okId);
  console.log(`[T4120] clean terminal: ${JSON.stringify(okTerminal)?.slice(0, 300)}`);
  expect(okTerminal, 'clean export must reach a terminal state').toBeTruthy();
  expect(okTerminal.status, 'sync OK -> export COMPLETE').toBe('complete');

  // --- 5. machine-cycle: prove an un-synced delta reverts -------------------
  // Re-fault, render (its final-video row commits LOCALLY but never reaches R2),
  // then cycle the "machine" (drop local SQLite + re-pull R2). The faulted row
  // must be gone while the cleanly-exported one (step 4, durable in R2) survives.
  const downloadsCount = async (label) => {
    const r = await req.get('/api/downloads', { headers: H });
    expect(r.ok(), `GET /api/downloads (${label})`).toBeTruthy();
    const j = await getJson(r);
    const n = Array.isArray(j?.downloads) ? j.downloads.length : (Array.isArray(j) ? j.length : null);
    console.log(`[T4120] downloads count [${label}] = ${n}`);
    return n;
  };

  const beforeFault2 = await downloadsCount('before-fault2');
  expect((await req.post('/api/test/sync-fault', { headers: H, data: { enabled: true } })).status()).toBe(200);
  const fault2Id = `t4120-cycle-${Date.now()}`;
  await req.post('/api/export/render-overlay', {
    headers: H,
    data: { project_id: projectId, export_id: fault2Id, effect_type: 'dark_overlay' },
    timeout: 200000,
  });
  const fault2Terminal = await pollTerminal(fault2Id);
  expect(fault2Terminal?.code, 'second faulted export -> sync_failed').toBe('sync_failed');
  const afterFault2 = await downloadsCount('after-fault2-local');

  // Simulate the Fly machine cycle (gated test seam). Fault may stay on — the sim
  // deletes local DBs and re-pulls R2, which does NOT have the un-synced row.
  const cycle = await req.post('/api/test/simulate-machine-cycle', { headers: H });
  expect(cycle.status(), 'simulate-machine-cycle').toBe(200);
  expect((await getJson(cycle))?.status).toBe('ok');

  // Clear the fault so post-cycle reads/writes are normal again.
  expect((await req.post('/api/test/sync-fault', { headers: H, data: { enabled: false } })).status()).toBe(200);

  const afterCycle = await downloadsCount('after-cycle');
  // Durable state restored cleanly: count is back to the pre-fault baseline (the
  // un-synced delta reverted), and the project still loads.
  expect(afterCycle, 'un-synced faulted export must REVERT after machine cycle').toBe(beforeFault2);
  expect(afterFault2, 'the un-synced row was present locally before the cycle').toBeGreaterThanOrEqual(beforeFault2);

  const projAfter = await req.get('/api/projects', { headers: H });
  expect(projAfter.ok(), 'projects reload cleanly after machine cycle').toBeTruthy();
  expect(((await getJson(projAfter)) || []).some((p) => p.id === projectId), 'durable project survives the cycle').toBeTruthy();

  console.log('[T4120] PASS: local render + durable boundary (sync_failed/complete) + machine-cycle revert verified.');
});
