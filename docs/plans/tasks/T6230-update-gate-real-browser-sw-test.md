# T6230: The update gate's ServiceWorker path has no real-browser test

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-30
**Updated:** 2026-07-30

## Problem

T6210 fixed the update-gate loop by requiring a probe to confirm a real waiting
ServiceWorker bundle before gating. The **decision** is well pinned — 8 new
regression tests in `appVersion.test.js`, including the exact 3163/3165 repro and
a 5-iteration reload loop that must never gate.

The **mechanism** is not tested at all. `probeForWaitingBundle`'s real
`registration.update()` / `registration.waiting` / `registration.installing`
behavior is jsdom-mocked. Every test asserts what happens *given* a stubbed probe
answer; nothing asserts the probe returns the right answer against a real
ServiceWorker.

This is the same false-confidence class as **T5380** (drag/pointer behavior that
passed in jsdom and was broken in a real browser) — hence the standing rule that
pointer/SW/browser-API fixes must be verified in a real browser.

**The specific risk is over-correction.** T6210 moved the gate from "fires when it
shouldn't" to "fires only when a bundle is provably waiting." If
`probeForWaitingBundle` never resolves truthy in a real browser — wrong lifecycle
timing, `update()` resolving before `waiting` is populated, a registration state
the mock doesn't model — the gate silently **never fires**. Users then sit on a
stale bundle indefinitely and no test goes red. The failure is invisible in CI by
construction.

Note the deliberate tradeoff T6210 shipped: no probe registered (SW unsupported,
private mode, failed or pending registration, dev server) = **no gate**. That is
intended and must not be "fixed" here — but it does mean a real-browser test has
to run somewhere a ServiceWorker actually registers, which the Vite dev server is
not.

## Solution

A Playwright test against a **built, served** app (not the dev server) that drives
the real SW lifecycle:

1. Load the app, wait for the ServiceWorker to register and activate.
2. Publish a second build to the same origin (new precache manifest).
3. Assert `probeForWaitingBundle` observes `registration.waiting` and the gate
   **does** appear — this is the over-correction guard, and the important half.
4. Assert the first-ever install (nothing to supersede) does **not** gate.
5. Assert the T6210 repro: server build ahead, no new bundle → no gate, across
   repeated reloads.

Serving two successive builds from one origin is the real work here — likely a
small static server fixture that can swap its build directory mid-test.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/utils/pwaUpdate.js` — owns the registration; `probeForWaitingBundle`
- `src/frontend/src/utils/appVersion.js` — the decision + throttle/dedupe
- `src/frontend/src/utils/appVersion.test.js` — existing jsdom pins (do not delete)
- `src/frontend/src/stores/updateGateStore.js` — `_swReloader` seam
- `src/frontend/e2e/` — where the new spec lands

### Related Tasks
- Follow-up from: T6210 (`65841559`) — residual risk it explicitly recorded
- Precedent: T5380 (jsdom false confidence on browser APIs)
- Adjacent: T6220 (lockstep deploys) — independent; do not couple

### Technical Notes
- Must run against a production build; the dev server registers no SW.
- Keep the jsdom decision tests. This adds a layer, it does not replace one.
- The throttle is 5 minutes — the test needs to control or bypass it rather than
  wait, without weakening the production throttle.

## Implementation

### Steps
1. [x] Build a fixture that serves two successive production builds from one origin
2. [x] Spec: fresh install → SW activates → no gate
3. [x] Spec: second build published → `registration.waiting` set → gate appears promptly
4. [x] Spec: server build ahead with no new bundle → no gate across N reloads
5. [x] Wire into the e2e suite; decide whether it belongs in the `@staging-gate` subset
       (decision: NOT a member — it serves its own origin and gives no staging signal;
       runs in the local/CI suite with its own `npm run test:e2e:sw-gate` entry point)

### Progress Log

**2026-07-30**: Filed as a follow-up from T6210. Not started.

**2026-07-31 — implemented (branch `feature/T6230-update-gate-real-sw-test`).**

Fixture (`e2e/helpers/staticBuildServer.js`): a single `node:http` origin serving a
MUTABLE build dir + MUTABLE fake `serverBuild`, started inside the spec's `beforeAll`
(no separate process, no new deps). `http://localhost:<port>` is a secure context so
the real ServiceWorker registers. `sw.js` is served `no-cache`; `/api/version` returns
`{build}` and every response is stamped `X-App-Build`; `/api/auth/me` → 401 (logged-out
shell — the gate fires fine logged out, so no auth is built in).

**Assumption that did NOT hold (reported, not papered over):** the task expected two
successive `npm run build`s to diverge on their own via version.json's fresh `buildTime`.
VERIFIED FALSE here — the only importer, `CropOverlay.jsx`, reads `versionInfo.environment`
ONLY, so rollup tree-shakes `buildTime` out and two same-commit builds are **byte-identical**
(`diff A/sw.js B/sw.js` → exit 0). Fallback per the task's instruction: build B injects a
unique marker file into `public/` (removed again in a `finally`, so the repo tree stays
clean), which Workbox precaches → distinct precache manifest → distinct `sw.js`
(`diff A/sw.js B/sw.js` → exit 1; the only delta is the marker entry). The spec asserts
`swDiffers` in `beforeAll` so a regression to identical builds fails LOUD.

**Real-browser lifecycle facts learned (recorded in `e2e/STAGING-GATE.md` § T6230):**
- A fresh navigation resets `appVersion.lastProbeAt` to 0, so reloads (never a lowered
  throttle) drive the un-throttled probe. No production constant was touched.
- The positive case must let **Workbox's own** `register()` update-check discover build B
  (poll `registration.waiting`) BEFORE triggering the app's probe. Discovering B via a raw
  `registration.update()` first makes it an *external* update, which vite-plugin-pwa does
  NOT wire to its controlling→reload listener — so "Update now" would activate B but never
  reload the page. Workbox-own discovery matches a real deploy (Workbox finds the new SW on
  load) and makes case 4's reload deterministic.

Cases (all in `e2e/T6230-update-gate-real-sw.spec.js`): 1 fresh-install-no-gate,
2 over-correction guard (published B → `registration.waiting` → gate, on the modal copy),
3 T6210 repro (server ahead, no new bundle → no gate ×5 reloads), 4 escapable (Update now →
land B → gate does not reappear). No production source changed.

QA evidence (pasted in the handoff report): 3 consecutive green runs (4/4 each);
mutation RED/GREEN for the probe (case 2) and for the `hasNewerBundle` guard (case 3);
`npm test` → 1440 passed with `appVersion.test.js` (17 tests) untouched and green.

**2026-07-30 — interim manual check PASSED.** After the prod deploy to build #3171
(`f309731d`), the user loaded prod on a browser holding the old #3166 service
worker and got the update prompt **once**, which cleared permanently on Update.
So `probeForWaitingBundle` does resolve truthy against a real `registration.waiting`,
and the gate fires promptly — the over-correction risk is empirically ruled out for
this path.

**This does not close the task.** That was one observation, one browser, one
lifecycle timing — it is evidence, not a regression guard. Nothing currently goes
red if the probe breaks later. The remaining value here is purely automated
regression protection, so the urgency dropped but the scope did not.

## Acceptance Criteria

- [x] A real browser with a real ServiceWorker exercises `probeForWaitingBundle`
      (real Chromium + real SW; case 2 drives `registration.update()`/`.waiting`)
- [x] The suite goes RED if the probe never reports a waiting bundle (over-correction caught)
      (mutation: `probeForWaitingBundle` → `return false` → case 2 RED)
- [x] The suite goes RED if the T6210 loop is reintroduced
      (mutation: drop the `hasNewerBundle()` guard → case 3 RED)
- [x] First-ever install does not gate (case 1)
- [x] Existing jsdom decision tests still pass unchanged (`appVersion.test.js` untouched; `npm test` 1440 passed)
