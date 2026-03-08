# T335: Mobile Annotate — Clips Panel & Details Editor

**Status:** TESTING
**Impact:** 7
**Complexity:** 5
**Created:** 2026-03-07
**Updated:** 2026-03-07

## Problem

The Annotate mode's clips panel and clip details editor need a dedicated mobile pass. T300 fixed the overall layout (overflow, sidebar as slide-over), but the **content inside the panel** wasn't redesigned for mobile. On a 360px phone with the sidebar at 85vw (306px), the current layout has several issues:

### Current Issues (verified via Playwright at 360x640)

1. **CRITICAL: Clip list completely invisible** — When the sidebar opens with a clip selected, the ClipDetailsEditor (676px tall) consumes the entire viewport (640px), leaving 0px for the clip list. The `flex-1 min-h-0 overflow-y-auto` clip list div is crushed to 0 height. Users literally cannot see or access their 33 clips.

2. **Video letterboxing wastes 60% of screen** — `min-h-[60vh]` (384px) forces the video container to be huge, but the actual wide-angle soccer footage only fills a horizontal strip in the middle with massive black bars above/below. This pushes controls and timeline completely off-screen — user must scroll past the video to reach anything interactive.

3. **Timeline clip markers are tiny and overlapping** — 33 clips across 94 minutes shown as 6px green bars. Many overlap and are completely untappable. The minimum recommended touch target is 44x44px (Apple HIG).

4. **Zoom controls waste vertical space** — "Zoom: [-] 100% [+]" takes a full row between metadata and video. Precious vertical real estate on a 640px viewport.

5. **Resolution metadata empty** — Shows "Resolution:" with no value. Takes space but provides no information.

6. **Game title truncated** — "Vs LA Breakers (LB) Sep 27" clips at right edge. Breadcrumb doesn't wrap.

7. **"Create Annotated Video" button below the fold** — User must scroll past video (384px), controls, and timeline to find the export action.

8. **Tag selector buttons cramped** — 11 tag buttons across 4 position groups with `px-2 py-1` sizing. On 306px sidebar, buttons wrap awkwardly and position group headers add visual noise.

9. **Import/Export buttons take prime real estate** — These are infrequent actions but sit at the top of the sidebar on every visit.

10. **Clip list items are small** — `py-1.5` padding with `text-sm` makes rows hard to tap accurately on touch devices.

## Solution

### 1. Main Screen Layout (video + controls + timeline)

**Video container**: Remove `min-h-[60vh]` on mobile. Use `max-h-[40vh]` or `aspect-video` to keep the video compact, leaving room for controls and timeline without scrolling.

**Hide non-essential elements on mobile**:
- Zoom controls: hide on mobile (zoom isn't useful on a small touch screen)
- Resolution/metadata bar: hide on mobile (or collapse into header)
- Move "Create Annotated Video" button to the header area or make it a sticky bottom bar

**Breadcrumb**: Truncate long game names with `truncate` class on mobile.

### 2. Mobile Clips Panel (sidebar slide-over)

**Clip List View** (default when panel opens):
- Larger touch targets: increase row height to `py-3` on mobile
- Rating badge + clip name + end time on each row (add time to row since it's useful context)
- Import/Export buttons collapsed into a "..." overflow menu
- "Add Clip" button at bottom of list (sticky) for easy access

**Clip Details View** (when a clip is selected):
- Full-panel takeover with back arrow to return to list — this is CRITICAL since the current layout crushes the clip list to 0px height
- Compact tag layout: single horizontal scrollable row grouped by position, or a 2-column grid
- Duration slider thumb enlarged for touch (min 44px touch target)
- Star rating: larger stars for touch (current size works but could be bigger)
- Collapsible sections: "Timing" (end time, duration, start time) collapsed by default since users rarely edit these
- Delete button pinned at bottom with safe spacing from other controls

### 3. Timeline Clip Markers

- Increase mobile marker width from 6px to 12px minimum
- Add transparent touch padding (`-inset-3 bg-transparent` pattern from T355)
- On tap: select clip and open sidebar to its details

### Layout Flow

```
Mobile Panel States:
1. Panel closed → tap "Clips (N)" button in header → Panel opens to Clip List
2. Clip List → tap a clip → Panel shows Clip Details (full panel)
3. Clip Details → tap back arrow → Panel shows Clip List
4. Clip Details → tap outside panel → Panel closes (clip stays selected)
```

## Context

### Relevant Files

**Clips Panel:**
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Sidebar layout, clip list, import/export
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Full details form (rating, tags, timing, notes, delete)
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` — Individual clip row in list

**Tag Selector:**
- `src/frontend/src/components/shared/TagSelector.jsx` — Multi-select tag buttons by position group
- `src/frontend/src/modes/annotate/constants/soccerTags.js` — 4 position groups, 11 total tags

**Timeline Markers:**
- `src/frontend/src/modes/annotate/layers/ClipRegionLayer.jsx` — Renders clip markers (6px mobile bars)

**Screen Layout:**
- `src/frontend/src/screens/AnnotateScreen.jsx` — Top-level layout, mobile sidebar overlay toggle
- `src/frontend/src/modes/AnnotateModeView.jsx` — Video player + controls + timeline container, `min-h-[60vh]` video, zoom controls, metadata bar
- `src/frontend/src/components/VideoPlayer.jsx` — Video container with `min-h-[60vh]`

### Related Tasks
- T300: Mobile Annotate Screen (DONE) — fixed overflow and sidebar-as-overlay
- T310: Mobile Editor Layout (DONE) — vertical stack pattern for editor screens
- T330: Mobile Video Players (TESTING) — touch controls pattern

## Implementation

### Steps

**Main screen layout:**
1. [ ] Video container: remove `min-h-[60vh]` on mobile, use `max-h-[40vh]` or `aspect-video`
2. [ ] Hide zoom controls on mobile
3. [ ] Hide or collapse metadata bar on mobile
4. [ ] Truncate breadcrumb game name on mobile
5. [ ] Move "Create Annotated Video" to sticky bottom bar or header on mobile

**Clips panel:**
6. [ ] ClipsSidePanel: add list/detail view state with back navigation on mobile (CRITICAL — details currently crush list to 0px)
7. [ ] ClipListItem: increase touch targets (`py-3` on mobile), add end time display
8. [ ] ClipsSidePanel: move Import/Export to overflow menu on mobile
9. [ ] ClipDetailsEditor: collapsible "Timing" section (end time, duration, start time)
10. [ ] TagSelector: compact mobile layout (horizontal scroll or 2-column grid)
11. [ ] ClipDetailsEditor: enlarge duration slider thumb and star rating for touch

**Timeline:**
12. [ ] ClipRegionLayer: widen mobile markers to 12px, add transparent touch padding
13. [ ] Test on 360px and 428px widths

## Acceptance Criteria

- [ ] Video + controls + timeline visible without scrolling on 640px viewport
- [ ] Clip list visible and scrollable when sidebar opens (not crushed by details editor)
- [ ] Selecting a clip shows full-panel details with back navigation to list
- [ ] Clip list rows are easy to tap on mobile (44px+ touch targets)
- [ ] Tag buttons are usable on mobile without awkward wrapping
- [ ] Duration slider is draggable with thumb touch
- [ ] Timeline clip markers are tappable on mobile
- [ ] Import/Export accessible but not taking prime space
- [ ] Game title doesn't overflow/truncate off-screen
- [ ] "Create Annotated Video" reachable without scrolling past video
- [ ] No horizontal overflow on any view state
- [ ] Desktop layout unchanged (all changes behind `sm:` breakpoint)
