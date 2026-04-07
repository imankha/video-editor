# T1030: Quest UI Relocation

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

The quest panel is a fixed overlay in the bottom-left corner that sits on top of UI elements. When the user reaches Quest 1 Step 3 ("Watch Your Clips Back" — playback annotations), the panel covers the very controls the user needs to interact with. The panel auto-collapses when a clip is selected to avoid sidebar overlap, but this creates a hide/show dance that's confusing.

The fundamental issue: the quest UI is an overlay that must constantly negotiate with other UI for space, rather than having its own dedicated area.

## Solution

Move the quest UI out of a floating overlay into a dedicated area that doesn't compete with other UI elements. Options:

1. **Sidebar panel** — dedicated right or left sidebar section that coexists with the main content
2. **Top banner / progress bar** — horizontal strip showing current quest progress, expandable for details
3. **Dedicated onboarding screen section** — quest steps shown in context next to the relevant UI (e.g., step 3 shown near the playback button)

The key requirement: the quest UI must be visible and accessible without obscuring the controls the user needs to complete the quest step.

## Context

### Relevant Files
- `src/frontend/src/components/QuestPanel.jsx` — Current floating overlay (fixed, bottom-left, z-50)
- `src/frontend/src/config/questDefinitions.jsx` — Step titles, descriptions, mini-buttons
- `src/frontend/src/stores/questStore.js` — Quest state management
- `src/frontend/src/App.jsx` — Where QuestPanel is mounted

### Related Tasks
- T700 (Quest Panel Smart Positioning) — DONE — CSS-first positioning, but still a floating overlay
- T540 (Quest System) — DONE — Original quest implementation

### Technical Notes
- Current position: `fixed z-50`, left 24px, bottom 40px (desktop)
- Auto-collapses when clip selected in annotate mode
- Panel width: 340px on desktop
- Quest 1 Step 3 requires clicking "Playback Annotations" button which is in the annotate mode controls area

## Implementation

### Steps
1. [ ] Design new quest UI location (needs UI decision)
2. [ ] Implement new layout
3. [ ] Remove floating overlay positioning
4. [ ] Test that quest steps are visible alongside the controls they reference

## Acceptance Criteria

- [ ] Quest UI does not overlap any interactive controls
- [ ] Quest 1 Step 3 is visible while the playback button is also visible
- [ ] Quest progress still clearly visible across all screens
- [ ] No regression in quest step completion tracking
