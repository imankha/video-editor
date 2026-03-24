# T700: Quest Panel Smart Positioning

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-03-23
**Updated:** 2026-03-24

## Problem

The quest panel (floating NUF overlay at bottom-left) overlaps the sidebar clip list and ClipDetailsEditor when a clip is selected in annotate mode.

## Screenshot Analysis

| State | Quest Panel | Result |
|-------|------------|--------|
| Projects screen (no sidebar) | Expanded, bottom-left | **Good** — no overlap |
| Annotate, no clip selected | Expanded, bottom-left | **Good** — sidebar content is short, panel fits below |
| Framing, small sidebar | Expanded, bottom-left | **Good** — sidebar content is short, panel fits below |
| **Annotate, clip selected** | Expanded, bottom-left | **Bad** — ClipDetailsEditor + clip list fills sidebar vertically, panel overlaps |

**Pattern:** Overlap occurs ONLY when a clip is selected in annotate mode. The ClipDetailsEditor (scrub handles, rating, tags, name, notes, delete button) takes significant vertical space, pushing sidebar content down into the quest panel's area.

## Solution

**Auto-collapse the quest panel when a clip is selected in annotate mode.**

The panel has 3 display states: normal expanded (all steps), mobile expanded (current step only), and collapsed (single-line bar: icon + title + progress). Auto-collapsing to the single-line bar when a clip is selected eliminates the overlap while keeping the panel accessible — the user can click to re-expand.

| App State | Quest Panel |
|-----------|------------|
| Projects screen | Expanded (normal) |
| Annotate, no clip selected | Expanded (normal) |
| Annotate, clip selected | **Auto-collapsed** |
| Framing | Expanded (normal) |

### Implementation

1. **Add `annotateHasSelectedClip` to `editorStore`** (Zustand store that already holds `editorMode`)
2. **AnnotateContainer sets it** when `annotateSelectedRegionId` changes (non-null → true, null → false). Clear on mode exit.
3. **QuestPanel reads it**: when `editorMode === 'annotate' && annotateHasSelectedClip`, force `expanded = false`. When the condition clears, restore previous expanded state.

No DOM queries, no MutationObserver, no timers. Pure React state flow.

### Cleanup

QuestPanel currently has dead positioning code that should be removed:
- `MutationObserver` on `document.body` (line 50-51) — no longer needed
- `updatePosition` callback — positioning is always bottom-left, just use CSS
- `position` state and `positionStyle` — replace with simple CSS `left`/`bottom`

## Context

### Relevant Files
- `src/frontend/src/components/QuestPanel.jsx` — Panel component with expanded/collapsed states
- `src/frontend/src/stores/editorStore.js` — Zustand store with `editorMode`, add `annotateHasSelectedClip`
- `src/frontend/src/containers/AnnotateContainer.jsx` — Has `annotateSelectedRegionId` from state machine
- `src/frontend/src/App.jsx` — Renders QuestPanel at app level (lines 386, 501)

### Related Tasks
- Depends on: T690 (state machine determines selection)
- Blocks: None

## Acceptance Criteria

- [ ] Quest panel auto-collapses when a clip is selected in annotate mode
- [ ] Quest panel re-expands when clip is deselected
- [ ] Quest panel stays expanded on Projects screen, Framing screen, and Annotate with no selection
- [ ] User can manually re-expand while collapsed (click to toggle)
- [ ] No MutationObserver, no elementsFromPoint, no debounce timers
- [ ] Remove dead positioning code (MutationObserver, updatePosition)
