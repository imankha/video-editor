# T10940: Silent app update did not fire; the user had to hard-refresh to get a new build

**Status:** TODO
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

- [ ] Root cause named with evidence (console/Actions timestamps), not inferred
- [ ] A visible idle tab picks up a new build within ~1 minute of BOTH halves finishing, with no
      user action, on staging (proved by the sw-gate e2e or a timed live run)
- [ ] No blocking popup reintroduced (T8460 invariant); no reload mid-work (T9310 Gap A)
