# T9380: Shrink time-to-activate - the handover from waiting bundle to running code

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-09
**Updated:** 2026-09-12

**Epic:** [Fast App Update](EPIC.md), child 4/4. **Blocked on [T9340](T9340-version-update-latency-investigation.md)'s measurement.**

## Problem

Once the new bundle is installed and waiting, taking it into use still costs:

- a quiescence wait - after T9310's Gap A, that includes about 5 seconds of pointer and key idle on
  top of the existing export/upload/modal/cold-boot conditions;
- a `POST /api/sync/flush-verify` round trip (sub-second in the normal case, per T8460's notes);
- `skipWaiting` -> `controllerchange` -> a full page reload, with a 3.5 second escalation path
  (`SW_ACTIVATE_TIMEOUT_MS`, `utils/pwaUpdate.js:15`) for browsers that do not fire the event;
- the cold boot of the new bundle itself, which is a full app start.

The 3.5 second escalation is the interesting one: it exists because Safari's `controllerchange`
reload is flaky. If that timeout is being HIT rather than being a rare fallback, it is pure added
latency on every update for a whole browser family.

## Solution

Gated on T9340's numbers. Do not tune a constant without evidence it is the one that matters.

1. **Find out whether the escalation path is the normal path on Safari or the exception.** If it is
   normal, stop waiting 3.5 seconds for an event that will not come - detect the condition and go
   straight to the manual bust-and-reload.
2. **Look at the quiescence wait's real cost.** The input-idle condition is correct and stays, but
   measure how long it actually adds. If the answer is "seconds", leave it: not reloading someone
   mid-gesture is worth seconds. If the answer is "minutes", the condition is being satisfied by the
   wrong events and needs narrowing, not removing.
3. **Consider whether the reload has to be a full cold boot.** This is the ambitious end and may well
   be rejected: the current design reloads the page, which throws away in-memory editor state that
   the flush already persisted. Cheaper alternatives (restoring scroll/route after the reload) are
   perceived-latency wins rather than real ones, and should be judged as such.

## Invariants

- **Never reload a user mid-work.** The Gap A input-idle condition is a floor. Anything here that
  makes activation faster by making it more intrusive is the wrong answer.
- **No blind retry of `flush-verify`.** T9310's Gap D decision stands: a failure there may be a real
  CAS refusal, and the manual Retry gesture is the required surface.
- Do not "clean up" the dynamic imports of `exportStore` / `uploadStore` in `updateGateStore`. They
  are dynamic on purpose - a static import caused a production-only Rollup TDZ crash.

## Files

- `src/frontend/src/utils/pwaUpdate.js` - `SW_ACTIVATE_TIMEOUT_MS`, `landLatestBundle`, the reloader
- `src/frontend/src/stores/updateGateStore.js` - `isQuiescent`, `runUpdate`
- `src/frontend/src/components/UpdateGateModal.jsx` - only if the progress card's phases change

## Tests

- `src/frontend/src/stores/updateGateStore.test.js` - quiescence gating, flush/reload ordering,
  re-entrancy
- `src/frontend/src/utils/pwaUpdate.test.js` - reloader wiring and the escalation path
- `npm run test:e2e:sw-gate` - the real SW lifecycle across two real builds
- `src/frontend/e2e/update-gate.spec.js` at 1280px and 390x844
- Safari specifically, on a real device, if the escalation path is touched. This is the browser the
  timeout exists for; jsdom and Chromium cannot answer the question.

## Notes

Tier M for items 1 and 2. Item 3 is L with an Architect gate and should only be opened if T9340 shows
the reload itself is the dominant cost.

## Progress Log

**2026-09-12**: Container worker investigated Q1/Q2 in-container (Chromium only, unit tests green,
54 passed, no branch needed since neither question yielded a verifiable code change):
- **Q1** (is the Safari 3.5s escalation normal or exceptional): on Chromium the `controllerchange`
  event fires normally and activation completes in ~1s — the escalation path is NOT hit. Whether
  it's normal on real iOS Safari is exactly the number this container cannot produce (same
  real-device gap T9340 already flagged). The only code change worth making — detect the Safari
  condition and skip straight to manual bust-and-reload — would change the SW activation mechanism
  itself, which is real-device-verification + Architect territory, not an M-tier in-container fix.
  Tuning `SW_ACTIVATE_TIMEOUT_MS` blind is barred by T9340/CLAUDE.md's no-fallback-without-evidence
  rule.
- **Q2** (quiescence wait's real cost): the input-idle-specific cost is the ~5s floor from Gap A
  (re-polled every 2s per Gap B) — seconds, not minutes. Multi-minute waits users may perceive come
  from export/upload/modal conditions, which are the INTENDED never-reload-mid-work floor, not a bug.
  Per the task's own invariant, this stays as-is.
- **Item 3** not opened — no evidence surfaced here that the reload is the dominant cost (T9340
  already ranked activation as the smallest of the three legs), so there's no basis to open an
  Architect gate for it now.

**Recommendation:** DEFER this task until a real iOS Safari activation-timing number exists (matches
T9340's own guidance that a leg shown to be noise may be dropped outright). No branch or commit was
made. Flipped to WAITING ON USER — decide whether to (a) get a real iOS Safari number to unblock a
real fix for Q1, or (b) drop this task per the epic's own "may be noise" allowance.
