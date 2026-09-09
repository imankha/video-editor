# T9340: Why does the version update take so long?

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-09-09
**Updated:** 2026-09-09 (promoted into the Fast App Update epic as its gating child)

**Epic:** [Fast App Update](EPIC.md), child 1/4. **This task gates T9360, T9370 and T9380** - whichever leg it shows to dominate gets implemented first, and a leg it shows to be noise may be dropped outright.

## Problem

User report 2026-09-09: updating to a new app version takes a long time. This is a LATENCY question,
distinct from T9310, which asks whether the silent update works at all and is already in STAGING.

T8460 replaced the blocking "A new version is ready" wall with a passive progress card. Nobody has
measured the wall-clock between "the server is on a newer build" and "the user is running it", and
three separate stalls are visible in `utils/pwaUpdate.js` without measuring anything. Tuning any one
of them before knowing which dominates would be guessing.

### The three known stalls

1. **`PROBE_MIN_GAP_MS` vs `SW_INSTALL_TIMEOUT_MS`.** `UPDATE_CHECK_MIN_GAP_MS` is 5 minutes
   (`pwaUpdate.js:9`); the bundle probe waits `SW_INSTALL_TIMEOUT_MS` = 10 seconds
   (`pwaUpdate.js:21`) for an `installing` worker to become `waiting`. A slow connection that misses
   the 10s window answers "no bundle yet" and then cannot re-probe for a full 5 minutes, even if the
   precache finished at second 11. T9310 Part 2 gap (C) names this same ratio.

2. **Quiescence is only re-tested on API traffic.** A deferred update waits for the app to look idle,
   and that check is driven by new API requests. A user reading a page, or one who just closed a
   modal, generates none - so a ready update can sit indefinitely. T9310 Part 2 gap (B).

3. **The activation round trip.** `skipWaiting` -> `controllerchange` -> page reload, with a 3.5s
   escalation to a manual bust-and-reload when Safari does not fire the event
   (`SW_ACTIVATE_TIMEOUT_MS`, `pwaUpdate.js:15`). Paid on top of everything above.

There is also a structural contributor: `vite.config.js` uses `registerType: 'prompt'` with a
deliberately no-op `onNeedRefresh`, so the ONLY thing that ever activates a waiting bundle is
`checkServerVersion`, which itself rides `visibilitychange` and the 5-minute gap. T9310 already
flagged characterizing this window as part of its Part 1.

## Solution

Investigation only. Deliverable is a measurement plus a ranked recommendation, not a patch.

1. Instrument or trace the full path on a real deploy: server build changes -> `checkServerVersion`
   fires -> probe result -> quiescence decision -> activation -> new bundle boots. Record the
   wall-clock of each leg. `main.jsx:26`'s `[Build] <hash> (#<number>)` line is the ground truth for
   which bundle is actually running at each point.
2. Do it on at least two profiles: a warm desktop tab left open, and a mobile PWA resumed from
   background (the case where `visibilitychange` is the only trigger and background timers are
   frozen).
3. `e2e/T6230-update-gate-real-sw.spec.js` (`npm run test:e2e:sw-gate`) already serves two genuinely
   different builds from a self-owned origin. It is the honest harness for this - use it rather than
   simulating.
4. Report which leg dominates, with numbers, and recommend the smallest change that moves it.

## Files

Read-only:

- `src/frontend/src/utils/pwaUpdate.js`
- `src/frontend/src/utils/appVersion.js`
- `src/frontend/src/stores/updateGateStore.js`
- `src/frontend/src/components/UpdateGateModal.jsx`
- `src/frontend/vite.config.js` (the `registerType` setting)
- `e2e/T6230-update-gate-real-sw.spec.js`

## Tests

No production code changes, so no new unit tests. The measurement runs through the existing
`test:e2e:sw-gate` fixture; any instrumentation added to take the measurement is removed before the
task closes, or landed deliberately as a logging change with its own justification.

## Notes

- Tier M, investigation. Read-only on production code.
- **Do not implement any fix here.** Fixes belong to the epic's other three children, one per leg.
- T9310 (STAGING, merged 2026-09-09) ALREADY closed its gaps A, B and C: `isQuiescent` gained a ~5s
  input-idle condition, a 2s interval re-tests quiescence while an update is pending, and a
  still-installing probe re-tries after ~30s instead of the full 5-minute lockout. Gap D (auto-retry
  of `flush-verify`) was explicitly DEFERRED. Measure the world AFTER those landed, and do not
  re-report them as findings.
- Note from T9310: T8460 is not on prod yet (prod was on build 4290, T8460 landed in 4437), so the
  next prod deploy shows every existing user the OLD blocking wall exactly once. Any latency number
  measured on staging describes the post-4437 world only.
