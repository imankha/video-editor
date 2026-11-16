# T16600: The staging export check cannot find the Clips button

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-15
**Updated:** 2026-11-15

## Problem

Before anything is promoted from staging, one of the "staging gate" browser checks signs in and exports a real
highlight: `src/frontend/e2e/derisk-staging-export.qa.spec.js`. It is the only gate member that covers the whole
export path (Frame, Spotlight, final video, publish), and `e2e/STAGING-GATE.md` lists it as the check for that
path. It starts by waiting for a button named "Clips" on the Home screen and clicking it.

On 2026-11-15, while checking T4410 on staging, this check failed at that first step with "Clips button not
visible". The Home screen no longer has a button with that name, so the check cannot reach the export. A person
exported a highlight on staging by hand through a different route that day, so the export itself works; only the
check is out of date. Until it is fixed the gate has a hole exactly where the most expensive code runs (the GPU
render), and nobody is told, because a check that fails to start looks like an environment problem.

## Solution

Find how a signed-in user now gets from Home to the list of their highlight drafts (the Home screen was reworked,
so read it and the current Home tests), and change the check's first steps to use that route. Keep the rest of
the check as it is. If other steps in the same file or in `derisk-staging-endcard-copylink.qa.spec.js` use the same
dead route, fix them in the same way; do not rewrite the checks.

## Why

The staging gate is what the owner relies on to decide a deploy is safe. A gate member that cannot start is worse
than a missing one, because it reads as covered.

## Relevant Files

- `src/frontend/e2e/derisk-staging-export.qa.spec.js`
- `src/frontend/e2e/derisk-staging-endcard-copylink.qa.spec.js`
- `src/frontend/e2e/STAGING-GATE.md`

## Acceptance Criteria

- [ ] C1: Run against staging (`E2E_BASE_URL=https://staging.reelballers.com`, `E2E_API_BASE=https://api-staging.reelballers.com/api`,
  the gate lane A account), `derisk-staging-export.qa.spec.js` gets past its first step and opens a draft.
- [ ] C2: The same run goes on to export a highlight and ends with the publish step passing, or the file names the one
  step that still fails and why.
- [ ] C3: `derisk-staging-endcard-copylink.qa.spec.js` does not stop at the same dead route.
