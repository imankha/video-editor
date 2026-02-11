# T67: Overlay Color Selection

**Status:** TODO
**Impact:** MEDIUM
**Complexity:** LOW
**Created:** 2026-02-11

## Problem

Users cannot customize the highlight overlay color. Currently it's a fixed color, but users may want different colors for visibility or preference.

## Solution

Add a color selector to the Overlay settings panel that lets users choose from:
- None (no overlay)
- Yellow
- Pink
- Orange

The control should be **visual** (show actual colors as swatches) and **consistent** with other overlay settings layout.

## Design

### UI Mockup
```
Overlay Settings
├── [Toggle] Enable Highlights
├── Color: [■ None] [■ Yellow] [■ Pink] [■ Orange]  ← color swatches
├── Opacity: [slider]
└── ...other settings
```

### Color Values
| Name | Hex | Use Case |
|------|-----|----------|
| None | transparent | No highlight effect |
| Yellow | #FFEB3B or similar | High visibility on dark |
| Pink | #E91E63 or similar | Distinct, vibrant |
| Orange | #FF9800 or similar | Warm, visible |

## Relevant Files

- `src/frontend/src/modes/overlay/` - Overlay mode components
- `src/frontend/src/stores/overlayStore.js` - Overlay state
- `src/frontend/src/components/shared/` - Shared UI components
- Overlay rendering code (where color is applied)

## Implementation Steps

1. [ ] Add `highlightColor` to overlay store (default: yellow)
2. [ ] Create color swatch selector component
3. [ ] Add color selector to overlay settings panel
4. [ ] Update overlay rendering to use selected color
5. [ ] Persist color preference

## Acceptance Criteria

- [ ] Color swatches displayed visually (not text dropdown)
- [ ] Layout consistent with other overlay settings
- [ ] Selected color applied to highlight overlay
- [ ] Color preference persisted across sessions
- [ ] "None" option disables highlight coloring
