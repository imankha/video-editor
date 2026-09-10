# T9385: Fix Overlay tab/panel tests after T9270's tab unification

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Problem

T9270 (PR #384, merged 2026-09-10) unified Overlay's previously-duplicated settings tabs into
the new `SettingsRail` component (`src/components/settings/SettingsRail.jsx`), fixing the exact
bug `src/modes/OverlayModeView.textTabPlayhead.test.jsx` documents in its own header comment
("OverlayModeView renders its settings-tabs section TWICE"). **Two** test files predate the fix
and still query the old test-ids (`overlay-tab-text`, `overlay-tabpanel-text`,
`overlay-tabpanel-thumbnail`), which no longer exist — the new tab buttons render
`data-testid={\`settings-tab-${tab.id}\`}` (e.g. `settings-tab-text`), and there is no
`overlay-tabpanel-*` equivalent for panel content:
- `src/modes/OverlayModeView.textTabPlayhead.test.jsx` (9/9 tests fail)
- `src/modes/OverlayModeView.thumbnailMarkerClick.test.jsx` (2/3 tests fail)

**Confirmed as a real regression, not flake:** both files fail identically on a clean master
checkout (`ed2031ad`), independent of any branch — first surfaced on T9350's Branch CI (run
34520026402, diff touches only `AnnotateModeView.jsx`/`AddFootageButton.jsx`) and confirmed
again on T9320's (run 34524251428). Tracked in `docs/testing/known-failures.md` in the meantime
so it doesn't block other branches' CI triage.

## Solution

Rewrite the test against the new `SettingsRail`/`OverlayModeView` structure, not a simple
test-id swap:
1. Read `SettingsRail.jsx` and `OverlayModeView.jsx`'s current tab wiring (`tab.id === 'text'`,
   `data-testid={\`settings-tab-${tab.id}\`}`) to find the correct selector for the Text tab
   button.
2. Find where the region-scoped-to-playhead panel CONTENT now renders under the unified rail
   (it used to be `overlay-tabpanel-text`; T9270 may not have preserved an equivalent test-id —
   check `SettingsRail`'s children-rendering API and add one if genuinely missing, following the
   existing `data-testid` naming convention rather than inventing a new one).
3. Preserve every existing assertion's INTENT (the playhead-scoping logic itself is almost
   certainly untouched by T9270 — this is a harness break, not a logic break) while updating the
   selectors and any structural assumptions that no longer hold (e.g. the old `getAllByTestId(...)
   [0]` pattern for picking the first of two duplicate renders is now wrong once there's only one
   render).
4. Confirm the underlying playhead-scoping behavior is unchanged by testing it live if there's
   any doubt the rewrite might be masking a real behavior change rather than just fixing selectors.

## Context

### Relevant Files
- `src/frontend/src/modes/OverlayModeView.textTabPlayhead.test.jsx` — test to fix (9 cases)
- `src/frontend/src/modes/OverlayModeView.thumbnailMarkerClick.test.jsx` — test to fix (2 cases)
- `src/frontend/src/components/settings/SettingsRail.jsx` — the new tab/panel component T9270
  introduced (`settings-tab-${tab.id}`, `settings-drawer`, `settings-rail` test-ids)
- `src/frontend/src/modes/OverlayModeView.jsx` — tab config at ~L738-740 (`id: 'text'`, etc.)

### Related Tasks
- Caused by: T9270 (Focus/Overlay CTA action band + settings rail, PR #384, merged 2026-09-10)
- Tracked as debt: `docs/testing/known-failures.md` (delete that row when this task ships)

### Technical Notes
- This is Tier S/M territory — a test-only fix, no production code change expected unless step 2
  finds a genuinely missing test-id, in which case adding one `data-testid` is still trivial.

## Acceptance Criteria
- [ ] `npx vitest run src/modes/OverlayModeView.textTabPlayhead.test.jsx` passes 9/9 against the
      current `SettingsRail`-based `OverlayModeView`
- [ ] `npx vitest run src/modes/OverlayModeView.thumbnailMarkerClick.test.jsx` passes 3/3
- [ ] Every original assertion's intent is preserved (playhead-scoped region visibility,
      marker-click tab-switch + seek), not just made to pass mechanically
- [ ] The `docs/testing/known-failures.md` row for these tests is deleted in the same commit
- [ ] Tests pass
