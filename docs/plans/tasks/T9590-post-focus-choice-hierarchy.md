# T9590: Post-Focus choice hierarchy: one dominant action, predictable destinations

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-12, N42, N43 (handoff E6-02)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

The post-Focus screen offers four visually equal choices - **Add Spotlight Now**, **Publish Now**,
**Add Spotlight Later**, **Refocus** - so the main path is not apparent, and "Add Spotlight Later"
names a *time* rather than a destination: it does not say where the user lands.

## This reverses two recent decisions, deliberately

**User decision 2026-09-10, taken with the conflict stated.** The affected history:

- **T8390** shipped the flat four-action bar (order chosen by the user: Add Spotlight / Publish /
  Add Spotlight Later / Refocus).
- **2026-09-08**, the product owner renamed "Publish" -> **"Publish Now"** and "Add Spotlight" ->
  **"Add Spotlight Now"** specifically so the two "now" choices would read as a matched pair against
  "Add Spotlight Later" (recorded in `config/displayNames.js`, `FOCUS_PUBLISH` block).
- **T9110** then mirrored the same flat four-equal-weight bar into Overlay.

The user has chosen to re-hierarchize anyway. **Both bars move together** - leaving Overlay flat
while Focus is hierarchical would recreate the inconsistency this is meant to remove.

## Solution

- **Add spotlight** primary, **Publish without spotlight** secondary, **Edit framing** tertiary.
- **Save draft** stays available but quiet, not a competing card.
- Remove the separate "Add Spotlight Later" destination; the quiet draft path replaces it.
- Add spotlight *enters editing*; it must not silently start an export.
- The publish action explains access and audience **before** commitment, and any re-render charge
  for editing framing is stated before the click.
- Keyboard order follows the visual hierarchy.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` - `FOCUS_PUBLISH`, `OVERLAY_PUBLISH` blocks
- `FocusPublishActionBar` (T8390) and the Overlay equivalent (T9110)
- `src/frontend/src/modes/FocusModeView.jsx`, `OverlayModeView.jsx`

### Related Tasks
- Reverses part of T8390 and T9110; both are STAGING. Update their task files with a pointer so the
  history stays legible rather than looking like drift.
- T9670 - the publication-audience contract this copy depends on
- T9540 - render/job naming, which touches the same buttons

### Technical Notes
The min-content grid-sizing fix and single-row stage gating that T9110 landed are layout work worth
preserving through the hierarchy change; do not rebuild the bar from scratch.

## Acceptance Criteria

- [ ] One dominant action is visually apparent on both the Focus and the Overlay completion screens
- [ ] Every alternative states its destination; no separate Add-Spotlight-Later destination remains
- [ ] Add spotlight opens the editor and never starts an export on its own
- [ ] Publication audience and any re-render charge are stated before the action
- [ ] Keyboard order follows the visual hierarchy
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green
