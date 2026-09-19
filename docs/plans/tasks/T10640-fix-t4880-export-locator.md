# T10640: Fix stale "Export" locator in T4880 mobile reachability spec

**Status:** TODO
**Impact:** 3
**Complexity:** 1
**Created:** 2026-09-19

## Problem

`e2e/T4880-mobile-editor-reachable.spec.js`'s Framing test looks for a button named
`/^Export( \(\d+\/\d+\))?$/`. The primary Framing CTA's accessible name was renamed to
`` `Generate ${MODE_NAMES.FRAMING}` `` = "Generate Framing" some time ago
(`displayNames.js:359`, tagged N19, comment says "was 'Export Focused Video'") and the spec
was never updated. The stale locator never resolves, so the test polls to its full 3-minute
timeout instead of failing fast — anyone running this spec locally burns 3+ minutes on a
false negative.

Discovered 2026-09-19 while verifying T10630 (ActionBand mobile stack); confirmed pre-existing
and unrelated to that branch. Logged in `docs/testing/known-failures.md`. Not a Branch CI
blocker (this spec isn't wired into `branch-ci.yml`), but it blocks the local reachability
check every Focus/Overlay-touching task is supposed to run before push.

## Solution

Update the locator in `e2e/T4880-mobile-editor-reachable.spec.js` (~line 50) to match the
current CTA name. Read `displayNames.js`'s `FOCUS_EXPORT`-family copy (~line 359 onward) for
the exact current strings — the render/in-progress/completed labels may all need covering if
the reachability check spans job states. Re-run the spec locally against dev servers and
confirm it passes without the 3-minute stall; remove the `known-failures.md` row once green.

## Acceptance Criteria

- [ ] Locator matches the current CTA accessible name (no hardcoded "Export")
- [ ] `T4880-mobile-editor-reachable.spec.js` passes locally, both sub-tests
- [ ] `known-failures.md` row removed
