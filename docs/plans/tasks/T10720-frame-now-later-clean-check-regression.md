# T10720: Frame Now / Frame Later silently no-op due to clean-check regression

**Status:** STAGING
**Impact:** 8
**Complexity:** 2
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

Reported live by the user testing staging: clicking "Frame Later" on a play with no project does
nothing (no clip cut, no toast, nothing added to Clips); "Frame Now" also does nothing. Reproduced
directly against staging (imankh's real account, `Vs legends Sep 5` game) via `dev-login` +
Playwright: clicking either button produced zero new network requests, zero console output, zero
UI change, and zero errors.

## Root Cause

T10610 (`AnnotateContainer.jsx` `isCleanAgainst`, merged the same day as this bug) introduced a
"clean write" short-circuit: a gesture whose value already equals the stored region value is
treated as a no-op and never reaches the network. Its comment says `createProject` "is an ACTION,
not a field, so it is never clean" — but the implementation only *excluded* `createProject` from
the comparison key list:

```js
const keys = Object.keys(actualUpdates).filter((k) => k !== 'createProject');
if (keys.length === 0) return true;
```

Frame Now/Later's payload is `{ createProject: true }` — `createProject` is the ONLY key. Filtering
it out leaves an empty key list, which the very next line treats as trivially "clean" and returns
`true`. `updateClipRegionWithSync` then short-circuits before calling `updateClipRegion` or
enqueueing `sendRegionUpdate` at all: no local write, no network write, no
`notifyReelCreated` toast, and (for Frame Now) `result.projectId` comes back `null` so the
create-then-navigate branch never fires either.

## Fix

`src/frontend/src/containers/AnnotateContainer.jsx` — `isCleanAgainst` now checks
`actualUpdates.createProject != null` FIRST and returns `false` immediately, before computing the
key list. This also fixes the same latent bug for a hypothetical `{ createProject: true, rating: <unchanged> }`
payload, which would previously have been misclassified as clean too.

## Tests

Added a regression test to `AnnotateContainer.createAtTap.test.jsx`: a createProject-only payload
(exactly Frame Now/Later's shape) against a region with no other field changes must still reach
`apiFetch` (PUT) and return the created `projectId`. Verified red against the pre-fix code, green
after.

## Acceptance Criteria

- [x] Frame Later creates the project and stays in Annotate (verified via new unit test; live
      staging re-verification pending deploy)
- [x] Frame Now creates the project and navigates to Focus
- [x] New regression test fails without the fix, passes with it
- [x] Existing `AnnotateContainer.createAtTap.test.jsx` / `.reelCreated.test.jsx` /
      `AnnotateModeView.frameClip.test.jsx` all still green
