# T1550: Unified mode navigation — consistent Annotate/Framing/Overlay tabs

**Status:** TODO
**Priority:** P2 (UX confusion)
**Impact:** 6 (users can't distinguish indicators from buttons; navigation model breaks between modes)
**Complexity:** 4
**Created:** 2026-04-17

## Problem

The navigation for editor modes is inconsistent across screens, breaking the user's mental model:

1. **Annotate mode** shows a green badge (`bg-green-600/20`, scissors icon, "Annotate" label) in the header. It looks like a button (colored background, rounded, icon + label) but is **not clickable** — it's just a "you are here" indicator.

2. **Framing/Overlay mode** shows a `ModeSwitcher` with two **clickable tabs** (`Framing | Overlay`). Active tab is colored, inactive is gray with hover states.

3. The Annotate indicator uses the **same visual language** as the ModeSwitcher tabs (colored bg, rounded corners, icon + label), so users can't distinguish "current location" from "click to navigate."

4. There's also an "Edit in Annotate" button that appears in the App.jsx header when a clip is selected in Framing — a third navigation pattern for the same concept.

### Where the components live today

- **Annotate indicator (non-clickable):** `AnnotateScreen.jsx` lines 471-474, also `ModeSwitcher.jsx` lines 69-74 (fallback)
- **ModeSwitcher (clickable tabs):** `ModeSwitcher.jsx` — only shows Framing/Overlay, never Annotate
- **Edit in Annotate (clickable):** `App.jsx` header — separate from ModeSwitcher, different position

## Goal

Unify all three modes into a single, consistent navigation component that always appears in the same location and uses the same visual language:

```
[ Annotate | Framing | Overlay ]
```

- **Active mode:** Colored background (green for Annotate, blue for Framing, purple for Overlay)
- **Available mode:** Gray text, hover state, cursor:pointer — clearly clickable
- **Unavailable mode:** Dimmed, cursor:not-allowed, tooltip explaining why (e.g., "Create a reel first" for Overlay when no working video exists)

### Navigation rules

| From | To | Condition |
|------|----|-----------|
| Annotate → Framing | Click Framing tab | A project/reel must be selected |
| Annotate → Overlay | Click Overlay tab | Project must have a working video |
| Framing → Annotate | Click Annotate tab | Always available (returns to game's annotate view) |
| Framing → Overlay | Click Overlay tab | Project must have a working video (existing behavior) |
| Overlay → Annotate | Click Annotate tab | Always available |
| Overlay → Framing | Click Framing tab | Always available (existing behavior) |

### What to remove

- The standalone green Annotate badge in AnnotateScreen header
- The Annotate fallback indicator in ModeSwitcher
- The separate "Edit in Annotate" button in App.jsx header (absorbed into the unified tabs)

## Best practices this follows

1. **Consistent position** — navigation tabs always in the same header location across all modes
2. **Visual distinction** — clickable items have hover/pointer states; active item is styled differently but uses the same shape as siblings (not a standalone badge)
3. **Progressive disclosure** — unavailable modes are visible but disabled with explanatory tooltips, so users learn the workflow without hitting dead ends
4. **Mental model continuity** — the three-tab bar persists across modes, anchoring the user's sense of where they are in the pipeline

## Acceptance criteria

1. All three modes appear in a single tab bar in the same header position
2. Active mode is visually distinct (colored) but same shape as inactive tabs
3. Inactive clickable tabs have hover states and cursor:pointer
4. Unavailable tabs are dimmed with tooltip explaining the prerequisite
5. No standalone mode indicators or separate navigation buttons for the same concept
6. Mobile: icon-only tabs (scissors, crop, layers) with same active/inactive states
