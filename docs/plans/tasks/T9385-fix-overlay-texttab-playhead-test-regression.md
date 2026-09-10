# T9385: Fix OverlayModeView.textTabPlayhead.test.jsx after T9270's tab unification

**Status:** TODO
**Impact:** 4
**Complexity:** 2
**Created:** 2026-09-10

## Problem

T9270 (PR #384, merged 2026-09-10) unified Overlay's previously-duplicated settings tabs into
the new `SettingsRail` component (`src/components/settings/SettingsRail.jsx`), fixing the exact
bug `src/modes/OverlayModeView.textTabPlayhead.test.jsx` documents in its own header comment
("OverlayModeView renders its settings-tabs section TWICE"). The test file predates the fix and
still queries the old test-ids (`overlay-tab-text`, `overlay-tabpanel-text`), which no longer
exist — the new tab buttons render `data-testid={\`settings-tab-${tab.id}\`}` (e.g.
`settings-tab-text`), and there is no `overlay-tabpanel-*` equivalent for panel content.

**Confirmed as a real regression, not flake:** 9/9 tests in the file fail identically on a clean
master checkout (`ed2031ad`), independent of any branch — first surfaced on T9350's unrelated
Branch CI run (T9350 touches only `AnnotateModeView.jsx`/`AddFootageButton.jsx`). Tracked in
`docs/testing/known-failures.md` in the meantime so it doesn't block other branches' CI triage.

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
- `src/frontend/src/modes/OverlayModeView.textTabPlayhead.test.jsx` — the test to fix
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
- [ ] Every original assertion's intent is preserved (playhead-scoped region visibility), not
      just made to pass mechanically
- [ ] The `docs/testing/known-failures.md` row for this test is deleted in the same commit
- [ ] Tests pass
