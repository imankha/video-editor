# T15250: T14970 e2e spec can hang on a profile the store never loaded

**Status:** WIP
**Impact:** 3
**Complexity:** 1
**Tier:** S (test only)
**Created:** 2026-11-06
**Updated:** 2026-11-06

Found by independent verification of T14970.

## Problem

`?profile= decides which game opens, through clicks, Back and a reload` (phone) timed out at 300 s in
a full run and passed alone in 41 s. It hung in `switchProfileInUi`: the profile dropdown showed only
the first profile, so the click on the twin waited forever.

`createTwinProfile` creates the profile with a raw `POST /api/profiles`, which bypasses the store.
The test then relies on the unforced late `fetchProfiles()` in `App.jsx` landing after that POST. In
the trace `GET /api/profiles` started before the POST finished and no later fetch followed, with the
backend slow at that moment. This cause is inferred from the trace, not proven by a repro. Real users
go through `createProfile`, which forces a refetch, so it does not look like a product bug.

The `Target page, context or browser has been closed` line is secondary: Playwright closed the page
at the timeout and the `finally` block's `selectProfile` hit it.

## Solution

After the raw POST, reload the page or wait until the store holds the twin before opening the
switcher. Fail fast with a named assertion rather than waiting out the 300 s test timeout.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/e2e/T14970-deep-linkable-editor-urls.spec.js` (`createTwinProfile`, `switchProfileInUi`)

### Related Tasks

- T14970. Branch CI does not run Playwright specs, so this only shows on a local run.

## Acceptance Criteria

- [ ] The twin profile is confirmed in the switcher before the test clicks it.
- [ ] A missing twin fails in seconds with a message naming the profile.
- [ ] The full T14970 spec passes alone at both viewports.
