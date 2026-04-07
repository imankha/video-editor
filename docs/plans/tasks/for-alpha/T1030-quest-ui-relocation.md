# T1030: Quest UI Relocation

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

The quest panel is a fixed overlay in the bottom-left corner that sits on top of UI elements. When the user reaches Quest 1 Step 3 ("Watch Your Clips Back" — playback annotations), the panel covers the very controls the user needs to interact with. The current workaround auto-collapses the panel when it detects overlap, but this creates a hide/show dance that's confusing — the user can't see their quest progress while doing the thing the quest asks them to do.

The fundamental issue: collapsing is a fallback, not a solution. The panel should find empty screen space nearby instead of hiding.

## Solution

**Smart repositioning instead of collapsing.** When the quest panel would overlap interactive UI, find the nearest empty space (no UI underneath) close to the preferred position and place it there. Keep the panel open and visible.

### Concrete examples (see screenshots):

1. **Framing screen** (`screenshots/better_pos_1.png`) — The preferred position overlaps the timeline/scrub bar. Instead of collapsing, move the panel to the empty space in the bottom-left below the clip metadata form and above the "Export Highlights" button.

2. **Annotate screen** (`screenshots/better_pos_2.png`) — The preferred position overlaps the clip controls. Instead of collapsing, move the panel to the empty space in the left panel below the clip details section.

### Approach

- Keep the floating overlay approach (don't restructure layout)
- Instead of collapse-on-overlap, compute available empty regions near the preferred position
- Place the panel in the best available spot per screen/mode
- Each screen mode (annotate, framing, overlay, home) may have a different "fallback position" since empty space varies by layout

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
- Auto-collapses when clip selected in annotate mode (this is the behavior to replace)
- Panel width: 340px on desktop
- Quest 1 Step 3 requires clicking "Playback Annotations" button which is in the annotate mode controls area
- Screenshots showing preferred positions: `screenshots/better_pos_1.png` (framing), `screenshots/better_pos_2.png` (annotate)

## Implementation

### Steps
1. [ ] Identify the preferred and fallback positions for each screen mode (home, annotate, framing, overlay)
2. [ ] Replace collapse-on-overlap logic with position-switching logic
3. [ ] Test each screen mode — panel should always be visible and not overlap interactive controls
4. [ ] Remove the auto-collapse behavior (no longer needed)

## Acceptance Criteria

- [ ] Quest panel never collapses due to overlap — it repositions instead
- [ ] Quest panel is always visible and open when there's an active quest
- [ ] Panel does not overlap any interactive controls on any screen
- [ ] Quest 1 Step 3 is visible while the playback button is also visible
- [ ] No regression in quest step completion tracking
