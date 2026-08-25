# T7710: Overlay settings tab "Overlay" label should read "Spotlight"

**Status:** STAGING
**Priority:** P2 (small clarity fix, user-directed 2026-08-25)
**Impact:** 3
**Complexity:** 1
**Created:** 2026-08-25
**Updated:** 2026-08-25

## Problem

The Overlay screen's settings section has three tabs: **Overlay | Text | Thumbnail**
(`src/frontend/src/components/overlay/OverlaySettingsTabs.jsx`). The first tab's label,
"Overlay", is misleading — its panel contains settings specific to the spotlight highlight
(shape, stroke width, dim strength, etc. — confirmed via `OverlayModeView.jsx`'s prop list
threaded into this tab). Calling it "Overlay" implies it controls overlays in general, but
the Text tab is right next to it controlling the OTHER overlay type — so a user has no way to
tell from the tab names that "Overlay" specifically means spotlight settings.

## Solution

Change the tab's user-visible `label` from `'Overlay'` to `'Spotlight'`.

**Scope call:** change ONLY the display label, not the tab's internal `id` (`'overlay'`) or
its `data-testid` values (`overlay-tab-overlay`, `overlay-tabpanel-overlay`). Those are
internal identifiers, not user-facing text — renaming them too would ripple into
`OverlayModeView.jsx`'s `activeTab === 'overlay'` state comparisons, `setActiveTab('overlay')`
calls, and any e2e locators keyed on the testid, for zero user-visible benefit. If a future
task wants full internal consistency, that's a separate, explicitly-scoped rename — don't
expand this task's diff to cover it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/overlay/OverlaySettingsTabs.jsx` — the `TABS` array,
  `{ id: 'overlay', label: 'Overlay', icon: Sparkles }` (~line 39) → change `label` only
- Its test file, if one exists (check `OverlaySettingsTabs.test.jsx` or similar)
- Any e2e spec asserting the VISIBLE text "Overlay" as this tab's label (not the testid) —
  grep for it; a testid-based locator needs no change, a text-based one does

### Related Tasks
- File-disjoint from T7700 (Framing→Focus rename) and T7720 (thumbnail marker click) — all
  three were spawned together 2026-08-25, verified not to share files

### Technical Notes
- This is a one-line label change plus whatever test/e2e text-assertions reference it. Do not
  expand scope to the tab `id`/`data-testid` (see Solution).

## Implementation

### Steps
1. [ ] Change the label in `OverlaySettingsTabs.jsx`
2. [ ] Update/add a test asserting the visible label reads "Spotlight"
3. [ ] Grep e2e specs for a text-based locator on this tab; update if found

## Acceptance Criteria

- [ ] The first Overlay-screen settings tab visibly reads "Spotlight", not "Overlay"
- [ ] Tab switching behavior, internal id, and data-testid are unchanged
- [ ] Tests pass; CI green
