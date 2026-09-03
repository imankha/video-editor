import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildTwoBundles, createStaticBuildServer } from './helpers/staticBuildServer.js';
import { IS_DEPLOYED_TARGET } from './helpers/targetEnv.js';

/**
 * T6230 — the update gate's ServiceWorker path, exercised in a REAL browser.
 *
 * WHY THIS EXISTS (over-correction guard). T6210 (`65841559`) stopped the update-gate
 * loop by requiring `probeForWaitingBundle` to confirm a real waiting SW bundle before
 * gating. Every existing pin lives in `appVersion.test.js` under jsdom with a STUBBED
 * probe — they assert the DECISION given an answer, never that the probe returns the
 * right answer against a real `registration.update()`/`.waiting`/`.installing`. If the
 * probe silently never resolves truthy in a real browser, the gate never fires, users
 * sit on a stale bundle forever, and NOTHING goes red. This spec is that missing layer:
 * case 2+4 goes RED if the probe stops reporting a waiting bundle; case 3 goes RED if the
 * T6210 loop (gate on server-ahead alone) is reintroduced.
 *
 * WHY NOT THE DEV SERVER. The Vite dev server builds no real ServiceWorker, so the probe
 * has no registration and — by T6210's deliberate tradeoff — never gates. The mechanism
 * only exists against a BUILT, SERVED app, which is what the fixture provides.
 *
 * THE FIXTURE (helpers/staticBuildServer.js). One `node:http` origin
 * (`http://localhost:<port>`, a secure context so SWs register) serving a MUTABLE
 * build dir + a MUTABLE fake `serverBuild`. Two real production builds (A, B) are
 * compiled in `beforeAll`; B carries a deliberate marker asset so its Workbox precache
 * manifest — and thus `sw.js` — differs from A's. (The task's original "two builds
 * differ on their own" assumption was VERIFIED FALSE here: version.json's buildTime is
 * tree-shaken out of the bundle, so same-commit builds are byte-identical; see the
 * helper's header and the Progress Log in the task file. `swDiffers` is asserted below.)
 *
 * @staging-gate DECISION: NOT a member. `@staging-gate` is the curated subset that
 * answers "is the deployed staging build safe to promote?" (see e2e/STAGING-GATE.md).
 * This spec never touches staging — it serves its OWN built origin — so it gives zero
 * signal about a deployed target and would only slow the gate (two full `vite build`s).
 * It DOES belong in the local/CI e2e suite as the automated regression guard T6210
 * asked for, and gets its own entry point `npm run test:e2e:sw-gate`. It `test.skip`s
 * when E2E_BASE_URL is set (it owns its origin), matching helpers/targetEnv.js.
 *
 * THROTTLE (why reloads, never a lowered constant). `PROBE_MIN_GAP_MS` and
 * `UPDATE_CHECK_MIN_GAP_MS` are 5 min, but `lastProbeAt`/`lastCheckAt` start at 0 on
 * every fresh page load, so a fresh navigation always gets one un-throttled check +
 * probe. The tests drive the gate with reloads and NEVER touch the production throttle
 * (lowering it or adding a test bypass would weaken exactly what T6210 shipped).
 *
 * T8460 UPDATE (no more blocking modal — read before touching case 2/4). The gate no
 * longer raises a `role="alertdialog"` the user clicks through; `requireUpdate()`
 * auto-runs `runUpdate()` (flush + land the bundle) once the app is quiescent, with
 * NO visible signal while `phase` stays 'idle' (the passive progress card only renders
 * during 'flushing'/'error'). This fixture is deliberately logged out (no backend
 * attached), so updateGateStore's first-session guard (never auto-run within 30s of a
 * cold, unauthenticated boot — see updateGateStore.js) would otherwise mask a probe
 * regression: if `probeForWaitingBundle` wrongly answered, the gate would raise
 * `isUpdateRequired` but the guard would suppress the auto-run, and NOTHING would be
 * observable either way. Case 2+4 (merged below) waits out that 30s window before
 * triggering, so the ONLY thing that can make the page reload on its own is a correct
 * probe finding the real waiting bundle — same regression-catching power as the old
 * "does the modal appear" assertion, now proven via the real end-to-end auto-run +
 * reload instead of a click.
 *
 * DETERMINISM (the on-load-probe poison, and how case 2+4 avoids it). The gate's positive
 * case has one real race: pwaUpdate's `registration` closure is populated by
 * `onRegisteredSW`, and if the on-load probe fires (server already ahead) BEFORE that,
 * it answers false and sets `lastProbeAt`, throttling the real probe for 5 min. Case 2
 * sidesteps it structurally: during each load the fake `serverBuild` is held BELOW the
 * client build, so `checkServerVersion` early-returns and NO probe runs (throttle stays
 * pristine); only AFTER the SW is active + controlling (which is strictly LATER than
 * onRegisteredSW on a first install) is `serverBuild` flipped ahead and a real
 * `visibilitychange` dispatched to drive one clean, un-throttled probe against a
 * populated registration. Before that flip, the test also waits for Workbox's own
 * `register()` update-check to stage build B as `registration.waiting`
 * (`waitForWaitingWorker`), so the probe call is answering against a bundle already
 * confirmed present rather than racing the SW's own discovery. No retry loop is
 * needed: a genuinely broken probe never gates on this single attempt, so the guard
 * fails RED.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.resolve(__dirname, '..');
const SCRATCH_DIR = path.join(__dirname, '.sw-gate-builds');

// Held far above any real `git rev-list --count HEAD` __APP_BUILD__ (~3173), so
// "server is ahead" holds no matter which commit the bundle was built at.
const SERVER_AHEAD = 9_000_000;
// Held below the client build during loads so the on-load check early-returns and no
// probe fires (keeps the throttle pristine for the deterministic post-load trigger).
const SERVER_BEHIND = 1;

// T8460: the app never auto-runs an update within the first 30s of a cold,
// unauthenticated boot (updateGateStore.js's first-session guard). This fixture is
// always logged out, so anything that triggers an auto-run must wait this out first.
const FIRST_SESSION_GUARD_MS = 30_000;

// ---- SW lifecycle helpers (proper waitFor on real SW state, never a bare sleep) ----

/** Locator for the passive, non-blocking update progress card (UpdateGateModal.jsx). */
const progressCard = (page) => page.getByTestId('update-progress-card');

/** Wait out the first-session guard, measured from a given navigation start time. */
async function waitOutColdBootGuard(page, navigatedAt) {
  const remaining = FIRST_SESSION_GUARD_MS - (Date.now() - navigatedAt);
  if (remaining > 0) await page.waitForTimeout(remaining);
}

/**
 * Resolve once THIS page load has an active, controlling SW. On a first install this
 * is strictly LATER than onRegisteredSW (register resolves -> onRegisteredSW -> install
 * -> activate -> clientsClaim -> controller), so pwaUpdate's `registration` closure is
 * guaranteed populated by the time this returns.
 */
async function waitForSwReady(page) {
  await page.waitForLoadState('load');
  // evaluate() properly awaits the promise: serviceWorker.ready resolves once the
  // registration has an ACTIVE worker (waitForFunction must NOT be used with an async
  // predicate — it would see the returned Promise as truthy and pass instantly).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Then wait (synchronous predicate) for that worker to CONTROL this page (clientsClaim).
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
}

/** Snapshot the real SW registration state from the page. */
async function swState(page) {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return {
      hasWaiting: !!(reg && reg.waiting),
      hasActive: !!(reg && reg.active),
      hasController: !!navigator.serviceWorker.controller,
      registrationCount: (await navigator.serviceWorker.getRegistrations()).length,
    };
  });
}

/** Dispatch the real return-to-app signal the app already listens for (visibilitychange
 *  while visible), which runs onReturnToApp -> registration.update() + version check. */
async function dispatchReturnToApp(page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
}

/**
 * Wait until Workbox's OWN register() update-check has staged the newly-published
 * build as a `waiting` worker. Two things depend on discovering it via Workbox (not
 * via the app's raw registration.update): (1) it arms vite-plugin-pwa's
 * controlling->reload listener, which only fires for Workbox-discovered updates — so
 * the auto-run's reload actually lands (case 2+4), matching a real deploy where
 * Workbox finds the new SW on load; (2) a non-null `waiting` proves register() resolved, hence
 * pwaUpdate's onRegisteredSW ran and its `registration` closure is populated, so the
 * gate-raising probe below cannot lose the registration race. */
async function waitForWaitingWorker(page) {
  await expect
    .poll(async () => (await swState(page)).hasWaiting, {
      timeout: 20_000,
      message: 'Workbox did not stage a waiting worker for the published build',
    })
    .toBe(true);
}

test.describe('T6230 update gate — real ServiceWorker', () => {
  // Owns its own built origin; meaningless against a deployed target.
  test.skip(IS_DEPLOYED_TARGET, '[T6230] serves its own built origin; not a deployed-target spec');

  let server;
  let dirA;
  let dirB;
  let origin;

  test.beforeAll(async () => {
    const built = buildTwoBundles({ frontendDir: FRONTEND_DIR, outDir: SCRATCH_DIR });
    dirA = built.dirA;
    dirB = built.dirB;
    // The whole test rests on B looking like a NEW worker to a browser holding A. If
    // the two sw.js are identical the fixture is a no-op and every "gate appears"
    // assertion would be a false green — fail LOUD here.
    expect(built.swDiffers, 'build A and build B must produce different sw.js (precache manifest)').toBe(true);

    server = createStaticBuildServer({ currentDir: dirA, serverBuild: SERVER_AHEAD });
    origin = await server.listenAsync();
  });

  test.afterAll(async () => {
    if (server) await server.closeAsync();
  });

  // Cases 1 -> 2 -> 4 are ONE continuous SW lifecycle (a `waiting` worker requires a
  // prior `active` controller in the SAME registration), so they share one clean
  // context and run serially. Case 3 gets its own fresh context below.
  test.describe.serial('SW lifecycle: install A -> publish B -> update', () => {
    let context;
    let page;

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext();
      page = await context.newPage();
    });

    test.afterAll(async () => {
      if (context) await context.close();
    });

    test('case 1: fresh install activates and does NOT gate (probe honesty: server ahead, nothing waiting)', async () => {
      server.setCurrentDir(dirA);
      server.setServerBuild(SERVER_AHEAD); // server IS ahead on this first install
      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await waitForSwReady(page);

      // First-ever registration: it activates directly with nothing to supersede, so
      // registration.waiting is null and the on-load probe answers "no". The server is
      // ahead — ONLY the probe's honest "no" keeps the gate down.
      const state = await swState(page);
      expect(state.hasActive, 'SW should be active after first install').toBe(true);
      expect(state.hasWaiting, 'first install has nothing waiting to supersede').toBe(false);
      await expect(progressCard(page)).toHaveCount(0);
      // Negative settle: a wrongly-truthy probe would gate within a beat of the check.
      await page.waitForTimeout(1500);
      await expect(progressCard(page)).toHaveCount(0);
    });

    test('case 2+4 (OVER-CORRECTION GUARD, T8460 auto-run): waiting bundle -> gate auto-runs and lands the new bundle, no click', async () => {
      server.setCurrentDir(dirB); // B is now the newest published bundle

      // Load with the server held BEHIND so the on-load check early-returns and NO
      // probe runs — the throttle (lastProbeAt) stays pristine for the deterministic
      // trigger below.
      server.setServerBuild(SERVER_BEHIND);
      const navigatedAt = Date.now();
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForSwReady(page);
      // Let Workbox's own register() discover B and stage it as a waiting worker
      // (deterministic; also arms the controlling->reload listener the auto-run relies on).
      await waitForWaitingWorker(page);

      // T8460: this fixture is logged out, so the first-session guard would otherwise
      // swallow the auto-run below with zero observable signal (see the file header).
      // Clear it before triggering.
      await waitOutColdBootGuard(page, navigatedAt);

      // Now flip the server ahead and fire one real return-to-app check. The probe
      // finds B already waiting AND the server strictly ahead -> requireUpdate() fires
      // and (quiescent: logged out, no export/upload/modal) runUpdate auto-runs
      // immediately -- flush is skipped (unauthenticated) and the SW reloader
      // (landLatestBundle) lands B with NO click. If probeForWaitingBundle stops
      // reporting the waiting bundle (the over-correction this task guards), or if the
      // auto-run regresses, nothing reloads and this case fails RED.
      server.setServerBuild(SERVER_AHEAD);
      const navigationPromise = page.waitForEvent('framenavigated', { timeout: 30_000 });
      await dispatchReturnToApp(page);
      await navigationPromise;

      await waitForSwReady(page);
      const state = await swState(page);
      expect(state.hasActive, 'the new bundle is now the active SW').toBe(true);
      expect(state.hasWaiting, 'the waiting worker was consumed on update — nothing left waiting').toBe(false);
      // Stays down afterward (server still ahead, but B shares A's __APP_BUILD__ —
      // same commit — so no newer bundle exists to gate on; the escapable half of
      // T6210's invariant).
      await page.waitForTimeout(1500);
      await expect(progressCard(page)).toHaveCount(0);
    });
  });

  test('case 3 (T6210 REPRO): server ahead, no newer bundle -> no gate across 5 reloads', async ({ browser }) => {
    // Fresh, isolated context — the T6210 loop was a fresh client repeatedly reloading.
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      server.setCurrentDir(dirA);
      server.setServerBuild(SERVER_AHEAD); // permanently ahead, the backend-only-deploy shape

      await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
      await waitForSwReady(page);
      // Prove the fresh context started clean (no SW/cache leak from the chain context):
      // exactly this context's own single A registration exists.
      expect((await swState(page)).registrationCount, 'fresh context has exactly its own one SW registration').toBe(1);

      // Each reload is a fresh, un-throttled on-load check+probe against server-ahead.
      // No newer bundle exists (still A), so the probe answers "no" and the gate must
      // never appear — this is the exact loop T6210 fixed.
      for (let i = 1; i <= 5; i++) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await waitForSwReady(page);
        // Let the on-load async probe run and (correctly) decline before asserting.
        await page.waitForTimeout(1000);
        await expect(progressCard(page), `gate must not appear on reload ${i}`).toHaveCount(0);
        expect((await swState(page)).hasWaiting, `nothing waiting on reload ${i}`).toBe(false);
      }
    } finally {
      await context.close();
    }
  });
});
