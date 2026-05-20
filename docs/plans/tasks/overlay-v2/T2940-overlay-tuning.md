# T2940: Overlay Tuning

**Status:** TODO
**Impact:** 8
**Complexity:** 3
**Created:** 2026-05-20
**Updated:** 2026-05-20

## Problem

The current highlight overlay looks bad in exported videos. Two failure modes:

1. **Brightness boost mode** (colored ellipse): Default 0.15 opacity fill + 1px stroke = nearly invisible on a busy field. The pink option is essentially undetectable. Users can't tell where the highlight is.
2. **Dark overlay mode** (spotlight): 30% background dimming is too aggressive. The entire scene looks washed out and filtered. Draws attention to the dimming effect, not the player.

Both modes rely on the wrong visual element as the primary identifier. Fill and background-dim are secondary cues — the **stroke ring** should be the primary visual, but it's currently 1px in export and shares opacity with the fill.

## Solution

Improve the existing overlay rendering (no architecture changes) so the highlight looks good by default and gives users meaningful controls.

### Rendering Changes

**1. Bold stroke as primary visual**
- Export stroke width: 1px → 3-4px at 1080p (scale proportionally with video resolution)
- Frontend preview stroke: 2px dashed → 3px solid (match what export produces)
- Stroke opacity: separate from fill, default 0.85

**2. Contrasting outline on stroke**
- Add 1-2px dark border (black at 50-60% opacity) around the colored stroke
- Ensures visibility against any background: bright grass, dark shadows, white field markings, sky
- Implementation: render a slightly larger ellipse stroke in dark color behind the main colored stroke

**3. Better default colors**
- Add white and cyan to the color palette (both pop against green fields)
- Change default from yellow to white — yellow blends with field markings and sunlit grass
- Keep yellow, pink, orange as options

**4. Separate stroke and fill opacity**
- Currently one `opacity` value (0.15) controls both → stroke invisible, fill invisible
- Split into `strokeOpacity` (default 0.85) and `fillOpacity` (default 0.05)
- Fill should be barely-there or off — the ring identifies, fill just obscures the player

**5. Reduce dark overlay strength**
- Background dimming: 30% → 15% default
- Add slider so users can dial it to taste (0-40%)

### User Controls

| Control | Type | Default | Range |
|---------|------|---------|-------|
| Stroke color | Palette picker | White | White, Cyan, Yellow, Pink, Orange, custom hex |
| Stroke width | Slider | 3px | 1-6px (at 1080p) |
| Fill on/off | Toggle | Off | On/Off |
| Fill opacity | Slider (when fill on) | 0.10 | 0.0-0.4 |
| Background dim | Slider (dark_overlay mode) | 15% | 0-40% |

Stroke opacity is fixed at 0.85 — not a user control (simplifies UI, always looks right).

### Migration

Existing overlays with `opacity: 0.15` should be interpreted as `fillOpacity: 0.15` with new defaults for stroke. No data migration needed — just different rendering interpretation.

## Context

### Why this matters before new overlay features

Every future overlay primitive (labels, event badges, presets) renders on top of the highlight ring. If the ring looks bad, everything built on top looks bad. Tuning the base overlay first means all future work inherits good defaults.

### Relevant Files

**Frontend:**
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` — SVG ellipse rendering (stroke width, opacity, outline)
- `src/frontend/src/components/ExportButtonView.jsx` — effect type toggle, color picker
- `src/frontend/src/constants/highlightColors.js` — color palette
- `src/frontend/src/modes/overlay/hooks/useHighlight.js` — default ellipse values (opacity 0.15)

**Backend:**
- `src/backend/app/ai_upscaler/keyframe_interpolator.py` — `render_highlight_on_frame()` (lines 298-396): export rendering with OpenCV. Stroke thickness=1, dark_overlay dims 30%.
- `src/backend/app/routers/export/overlay.py` — frame processing pipeline

### What NOT to change
- Ellipse positioning, sizing, or tracking — those work fine
- Spline interpolation — already matches frontend and backend
- Keyframe data model — reuse existing fields, add strokeOpacity/fillOpacity as optional

## Implementation

1. [ ] Add white and cyan to highlightColors.js, change default to white
2. [ ] Split opacity into strokeOpacity (0.85) and fillOpacity (0.05) in useHighlight.js defaults
3. [ ] Update HighlightOverlay.jsx: solid 3px stroke + dark outline border, separate fill
4. [ ] Update keyframe_interpolator.py `render_highlight_on_frame()`: 3-4px stroke with dark outline, separate fill opacity
5. [ ] Add stroke width slider and fill toggle to ExportButtonView.jsx
6. [ ] Add background dim slider for dark_overlay mode (default 15%)
7. [ ] Reduce dark_overlay hardcoded dimming from 0.3 to configurable (default 0.15)
8. [ ] Backward compat: interpret old `opacity` as `fillOpacity`, apply new stroke defaults

## Acceptance Criteria

- [ ] Highlight ring is clearly visible on exported video at default settings
- [ ] Ring visible against bright grass, dark shadows, and white field markings
- [ ] Dark overlay mode doesn't wash out the scene
- [ ] Frontend preview matches export appearance
- [ ] Existing overlay data renders without migration (backward compatible)
- [ ] User can adjust stroke width, fill, and dim strength
