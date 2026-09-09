# T9360: Shrink time-to-notice - a client should learn about a deploy in seconds

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-09
**Updated:** 2026-09-09

**Epic:** [Fast App Update](EPIC.md), child 2/4. **Blocked on [T9340](T9340-version-update-latency-investigation.md)'s measurement.**

## Problem

A waiting bundle never activates itself. `vite.config.js` uses `registerType: 'prompt'` and
`onNeedRefresh` is a deliberate no-op, so the only path to activation is
`checkServerVersion -> requireUpdate -> runUpdate` (`utils/appVersion.js:91`).

`checkServerVersion` fires from exactly three places:

1. the `sessionInit` interceptor, on every API response;
2. the on-load `GET /api/version` in `setupPwaUpdatePrompt`;
3. the `visibilitychange` / `pageshow` return-to-app poll.

All three are throttled by `UPDATE_CHECK_MIN_GAP_MS` = 5 minutes (`utils/pwaUpdate.js:9`).

T9310's Part 1 verdict states the consequence plainly: for a tab that makes no API calls and never
tab-switches, **the window is effectively unbounded**. That verdict called it "acceptable in steady
state". The user has since asked for updates to be fast, which reopens the judgement - this task is
that reopening, not a contradiction of it.

## Solution

Pick the cheapest mechanism that makes the notice interval seconds rather than minutes, and justify
it against the measurement T9340 produces. Candidates, cheapest first:

1. **Tighten the throttle when a deploy is plausibly fresh.** `GET /api/version` is a tiny
   unauthenticated endpoint. A short gap (roughly 30s) for the first few minutes after the app
   observes ANY version movement, decaying back to 5 minutes, costs almost nothing and needs no new
   server surface.
2. **Check on navigation, not only on API traffic.** A route change is a natural, gesture-driven
   moment to ask. It is free for an idle reader, who is exactly the user the current design strands.
3. **Let the server say so.** The backend already knows its build number. An SSE stream or a header
   on responses the client already receives would make the notice push-driven instead of polled.
   Bigger surface; only justified if 1 and 2 measurably fall short.

Explicitly considered and NOT the answer on its own: switching `registerType` to `autoUpdate`. That
would hand activation back to workbox and bypass the quiescence gate entirely, which is the exact
behavior T8460 and T9310 Gap A were built to prevent. If it is used at all, the quiescence gate must
still own when the reload happens.

## Invariants

- No blocking interstitial (T8460).
- Noticing sooner must not mean reloading sooner: the T9310 Gap A input-idle condition and the whole
  quiescence gate stay in front of any reload.
- The `/api/version` poll must not become a per-response storm. Whatever the new gap is, it is still
  a gap, and `lastProbeAt` bookkeeping stays.
- No `useEffect` that watches state and writes.

## Files

- `src/frontend/src/utils/appVersion.js` - `PROBE_MIN_GAP_MS`, `checkServerVersion`
- `src/frontend/src/utils/pwaUpdate.js` - `UPDATE_CHECK_MIN_GAP_MS`, the resume poll
- `src/frontend/src/stores/updateGateStore.js` - only if the trigger surface changes
- `src/frontend/vite.config.js` - only if `registerType` is revisited
- backend `/api/version` handler - only for option 3

## Tests

- `src/frontend/src/utils/appVersion.test.js` - the throttle/decay behavior, new cases
- `src/frontend/src/utils/pwaUpdate.test.js` - trigger wiring
- `src/frontend/src/stores/updateGateStore.test.js` - the gate still defers correctly
- `npm run test:e2e:sw-gate` (real two-build fixture) - the notice actually lands faster
- `src/frontend/e2e/update-gate.spec.js` at 1280px and 390x844

## Notes

Tier M if the answer is options 1+2; L with an Architect gate if it becomes a server-push channel.
Decide after T9340 reports, not before.
