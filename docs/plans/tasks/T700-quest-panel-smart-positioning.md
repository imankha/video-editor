# T700: Quest Panel Smart Positioning

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-03-23
**Updated:** 2026-03-24

## Problem

The quest panel (floating NUF overlay) overlaps the sidebar clip list and ClipDetailsEditor when a clip is selected in annotate mode.

## Screenshot Analysis

| State | Quest Panel | Result |
|-------|------------|--------|
| Projects screen (no sidebar) | Bottom-left | **Good** — no overlap |
| Annotate, no clip selected | Bottom-left | **Good** — sidebar content is short, panel fits below |
| Framing, small sidebar | Bottom-left | **Good** — sidebar content is short, panel fits below |
| **Annotate, clip selected** | Bottom-left | **Bad** — ClipDetailsEditor + clip list fills sidebar vertically, panel overlaps |

**Pattern:** Overlap occurs ONLY when a clip is selected in annotate mode. The ClipDetailsEditor (scrub handles, rating, tags, name, notes, delete button) takes significant vertical space, pushing sidebar content down into the quest panel's area.

## Solution

**Hide the quest panel when a clip is selected in annotate mode.**

This is the simplest rule that preserves all good states and fixes the bad state:
- Projects screen → show (no sidebar)
- Annotate, no selection → show (sidebar content is short)
- Annotate, clip selected → **hide** (ClipDetailsEditor fills the space)
- Framing → show (sidebar is always small)

### Implementation

The quest panel is rendered in `App.jsx` and doesn't have direct access to annotate selection state. Two approaches:

**Option A (preferred): Check for ClipDetailsEditor in DOM**
```javascript
// In QuestPanel.jsx — check if the details editor is taking the space
const detailsVisible = document.querySelector('.border-t-2 .cursor-col-resize') !== null;
if (detailsVisible) return null; // Hide panel
```
Re-check on a React-level signal (editorMode change, not MutationObserver).

**Option B: Expose selection state via context or store**
- Add `hasSelectedClip` to a Zustand store or React context
- QuestPanel reads it and hides when true + annotate mode

Option A is simpler (no plumbing), Option B is cleaner (no DOM queries).

## Context

### Relevant Files
- `src/frontend/src/components/QuestPanel.jsx` — Positioning logic
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Sidebar with ClipDetailsEditor
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Takes vertical space when clip selected
- `src/frontend/src/App.jsx` — Renders QuestPanel at app level

### Related Tasks
- Depends on: T690 (state machine determines selection)
- Blocks: None

## Acceptance Criteria

- [ ] Quest panel hidden when a clip is selected in annotate mode
- [ ] Quest panel visible on Projects screen (no sidebar)
- [ ] Quest panel visible in annotate mode with no clip selected
- [ ] Quest panel visible in framing mode
- [ ] No MutationObserver, no elementsFromPoint, no debounce timers
- [ ] No panel jumping or thrashing
