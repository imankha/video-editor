# T10940: Silent app update did not fire; the user had to hard-refresh to get a new build

**Status:** DONE (deployed 2026-09-21 prod)
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

User report 2026-09-21, during the T10890/T10900/T10910/T10920/T10930 pushes to master (staging
auto-deploy): "I had to hard refresh to get the latest version. I thought we had a system where
users didn't have to do that? ... now I need to do it manually and don't have a popup prompting
me. Very few users would actually do this."

## What is SUPPOSED to happen today (so this is a bug, not a missing feature)

- T8460 deleted the blocking "update available" popup on purpose; the update is silent.
- T9360 (prod since 2026-09-13) polls `GET /api/version` every 30 s while the tab is visible
  (`pwaUpdate.js` `VISIBLE_POLL_INTERVAL_MS`), so a visible tab learns of a deploy within ~30 s.
- `appVersion.js` `checkServerVersion`: server build > client build -> `hasNewerBundle()` probes
  the service worker for a waiting bundle -> `requireUpdate` -> the quiescence gate (T9310 Gap A:
  ~5 s of no pointer/key input, no export/upload/modal) -> full reload. No popup by design.

So the observed behaviour (nothing happened until a manual hard refresh) means one link in that
chain did not fire. Nothing in the report says which.

## Suspects, in order

1. **Deploy-order race -> 5-minute probe lockout.** Frontend (CF Pages) and backend (Fly) deploy
   from the same push but finish at different times. If the backend advertises the new build BEFORE
   Pages has published the bundle, `hasNewerBundle()` answers "no bundle" and `lastProbeAt` locks
   the probe for `PROBE_MIN_GAP_MS` = 5 min (T9310 Gap C shortens it only for a *still-installing*
   miss, not a *not-yet-published* miss). Five pushes in ~90 minutes could keep re-arming that
   lockout. Fix direction: treat "server moved but no bundle" as `stillInstalling`-class (short
   re-probe), or have the poll re-probe whenever the server build advances again.
2. **The user was on prod, not staging.** Prod is still build 5579 (deploy 2026-09-21 morning); a
   hard refresh there changes nothing either. Confirm which origin the report came from.
3. **The tab was never quiescent** (active scrubbing/editing for the whole window) -- then the
   reload is deferred by design; but a deferred update should still land at the next 5 s idle.

## How to verify (needs the user or a repro)

- Ask: staging or prod? Was the tab left open and idle, or in active use? Roughly how long
  between the push and the hard refresh?
- Repro on staging: push a trivial commit, keep a visible idle Annotate tab open, watch the
  console for the `[UpdateGate]`/`pwaUpdate` lines and `/api/version` responses; note the exact
  times CF Pages and Fly finish (Actions tab) vs when the client's probe fires.
- `npm run test:e2e:sw-gate` (real two-build fixture) with the two builds published in the
  "wrong" order is the automated form of suspect 1.

## Root cause (2026-09-21, code-verified + reproduced in a real browser)

User confirmed: PROD, after the morning deploy; loaded prod, old UI; plain refresh, still old;
Ctrl+refresh got the new UI.

**Suspect 1 was right, plus a second, deterministic race on every fresh load.**

1. **The on-load probe ran against a null registration and burned the 5-minute cooldown.**
   `virtual:pwa-register` -> workbox-window `register({immediate:false})` awaits the window `load`
   event before registering, so `pwaUpdate`'s `registration` closure is null for seconds after boot.
   The on-load `GET /api/version` answers in ~200ms. After a deploy the server is ahead on EVERY load
   of the stale precached shell (the old SW serves its precached `index.html` on a plain reload -- the
   spec's own comment at `pwaUpdate.js landLatestBundle` says so), so `checkServerVersion` ->
   `hasNewerBundle` -> `probeForWaitingBundle` ran with `registration == null`, answered "no", and
   `lastProbeAt` was stamped with `PROBE_MIN_GAP_MS` = 5 min. Every 30s poll for the next 5 minutes
   short-circuited at the cooldown even though the browser had already staged the new SW as
   `waiting`. A plain reload = fresh module state = the same race again. Only a hard refresh (bypasses
   the SW) escaped. The existing real-SW e2e (`T6230-update-gate-real-sw.spec.js`) documented this
   exact race in its header and deliberately side-stepped it ("held the server BEHIND during loads so
   no probe runs") -- the real deploy shape was never tested.
2. **Deploy-order race for already-open tabs** (the original suspect): `deploy_production.sh` ships
   the backend BEFORE the Pages bundle, so a live tab's first probe finds no new bytes and, before
   this fix, locked out for 5 minutes.

## Fix (shipped)

- `pwaUpdate.js`: `registrationSettled` promise (resolved by `onRegisteredSW` / `onRegisterError`,
  immediately when `!('serviceWorker' in navigator)`); `probeForWaitingBundle(getRegistration,
  registrationSettled)` awaits it, bounded by `REGISTRATION_WAIT_MS` 15s, and returns a boolean.
- `appVersion.js`: ONE probe cooldown `PROBE_MIN_GAP_MS` = 25s, deliberately < pwaUpdate's 30s
  visible poll so every tick that finds the server ahead may probe. T9310 Gap C's two-tier
  `{hasBundle, stillInstalling}` cooldown deleted. Worst case (server permanently ahead) = one
  conditional `sw.js` GET per tick per visible tab.
- Quiescence gate, no-popup design, flush barrier: untouched.
- Tests: `appVersion.test.js` / `pwaUpdate.test.js` rewritten for the contract (registration wait
  pinned by "registration settles later with a waiting worker"); real-SW e2e **case 5** = the exact
  prod sequence (A active -> both halves land -> plain reload of the stale shell -> must land B with
  no click and no hard refresh). **Red on the pre-fix source (no reload in 90s), green post-fix in
  31.1s** (30s of that is the unauthenticated cold-boot guard; a signed-in user gets install time +
  5s idle). Harness fixes: `buildTwoBundles` builds with `VITE_API_BASE=''` (a developer's local
  `.env.production` made every fixture `/api/version` CORS-blocked, silently reddening case 2+4);
  `framenavigated` waits are main-frame-only (sign-in iframe) and budgeted past the poll tick.
- Reviewer pass: 0 blocking / 2 major (both taken: 25s < 30s tick; race-free case 5 assertions) /
  minors folded in.

## Context

### Relevant Files
- `src/frontend/src/utils/appVersion.js` (`checkServerVersion`, `hasNewerBundle`, `PROBE_MIN_GAP_MS`)
- `src/frontend/src/utils/pwaUpdate.js` (visible poll, `UPDATE_CHECK_MIN_GAP_MS`)
- `src/frontend/src/stores/updateGateStore.js` (quiescence gate)
- `.github/workflows/deploy-frontend.yml` / `deploy-backend.yml` (the two halves that race)

### Related Tasks
- T8460 (silent update), T9310 (Gaps A-C), T9340 (measurement), T9360 (30 s visible poll),
  T9380 (ICE: time-to-activate)

## Acceptance Criteria

- [x] Root cause named with evidence (code path + real-browser repro that is red on the old source)
- [x] A stale load / visible idle tab picks up a new build within ~1 minute of BOTH halves finishing,
      with no user action (sw-gate e2e case 5: 31s logged out; signed-in is faster)
- [x] No blocking popup reintroduced (T8460 invariant); no reload mid-work (T9310 Gap A, untouched)
