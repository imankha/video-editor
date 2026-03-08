# T335: Mobile Annotate — Clips Panel & Details Editor

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-03-07
**Updated:** 2026-03-07

## Problem

The Annotate mode's clips panel and clip details editor need a dedicated mobile pass. T300 fixed the overall layout (overflow, sidebar as slide-over), but the **content inside the panel** wasn't redesigned for mobile. On a 360px phone with the sidebar at 85vw (306px), the current layout has several issues:

### Current Issues

1. **Clip Details Editor is too dense** — Rating, tags (4 position groups x 2-3 tags each = 11 buttons), name input, end time, duration slider, start time, notes textarea, and delete button are stacked in a narrow column. Users must scroll extensively to edit a clip.

2. **Tag selector buttons are cramped** — 11 tag buttons across 4 position groups with `px-2 py-1` sizing. On 306px, the buttons wrap awkwardly and the position group headers add visual noise.

3. **Timeline clip markers are hard to tap** — The thin 6px color bars are difficult touch targets on mobile. The minimum recommended touch target is 44x44px (Apple HIG).

4. **Clip list items are small** — `py-1.5` padding with `text-sm` makes rows hard to tap accurately on touch devices.

5. **No way to dismiss clip details** — Once a clip is selected in the sidebar, the details editor takes up the bottom portion. There's no close/back gesture to return to just the clip list.

6. **Import/Export buttons take prime real estate** — These are infrequent actions but sit at the top of the sidebar on every visit.

## Solution

### Mobile Clips Panel (sidebar slide-over)

**Clip List View** (default when panel opens):
- Larger touch targets: increase row height to `py-3` on mobile
- Rating badge + clip name + end time on each row (add time to row since it's useful context)
- Import/Export buttons collapsed into a "..." overflow menu
- "Add Clip" button at bottom of list (sticky) for easy access

**Clip Details View** (when a clip is selected):
- Full-panel takeover with back arrow to return to list
- Compact tag layout: single horizontal scrollable row grouped by position, or a 2-column grid
- Duration slider thumb enlarged for touch (min 44px touch target)
- Star rating: larger stars for touch (current size works but could be bigger)
- Collapsible sections: "Timing" (end time, duration, start time) collapsed by default since users rarely edit these
- Delete button pinned at bottom with safe spacing from other controls

### Timeline Clip Markers

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

### Related Tasks
- T300: Mobile Annotate Screen (DONE) — fixed overflow and sidebar-as-overlay
- T310: Mobile Editor Layout (DONE) — vertical stack pattern for editor screens
- T330: Mobile Video Players (TESTING) — touch controls pattern

## Implementation

### Steps
1. [ ] ClipListItem: increase touch targets (`py-3` on mobile), add end time display
2. [ ] ClipsSidePanel: move Import/Export to overflow menu on mobile
3. [ ] ClipsSidePanel: add list/detail view state with back navigation on mobile
4. [ ] ClipDetailsEditor: collapsible "Timing" section (end time, duration, start time)
5. [ ] TagSelector: compact mobile layout (horizontal scroll or 2-column grid)
6. [ ] ClipDetailsEditor: enlarge duration slider thumb and star rating for touch
7. [ ] ClipRegionLayer: widen mobile markers to 12px, add transparent touch padding
8. [ ] Test on 360px and 428px widths

## Acceptance Criteria

- [ ] Clip list rows are easy to tap on mobile (44px+ touch targets)
- [ ] Selecting a clip shows full-panel details with back navigation
- [ ] Tag buttons are usable on mobile without awkward wrapping
- [ ] Duration slider is draggable with thumb touch
- [ ] Timeline clip markers are tappable on mobile
- [ ] Import/Export accessible but not taking prime space
- [ ] No horizontal overflow on any view state
- [ ] Desktop layout unchanged (all changes behind `sm:` breakpoint)
