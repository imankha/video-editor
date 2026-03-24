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

The quest panel is rendered in `App.jsx` and doesn't have direct access to annotate selection state. Expose the selection state via the existing editor store so QuestPanel can read it.

1. **Add `annotateHasSelectedClip` to `editorStore`** (or whichever Zustand store holds `editorMode`)
2. **AnnotateContainer sets it** when `annotateSelectedRegionId` changes (non-null = true, null = false)
3. **QuestPanel reads it**: `if (editorMode === 'annotate' && annotateHasSelectedClip) return null;`
4. **Clear on mode exit**: reset to false when leaving annotate mode

No DOM queries, no MutationObserver, no timers. Pure React state flow.

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
