# T2950: Ground Spotlight Overlay

**Status:** TESTING
**Impact:** 8
**Complexity:** 4
**Created:** 2026-05-25
**Updated:** 2026-05-25

## Problem

The current highlight ellipse wraps around the player's full body like a halo. This looks unnatural on soccer footage — real stadium spotlights cast a pool of light on the ground beneath the player, not a ring around their silhouette.

A ground-level ellipse (like a shadow or spotlight pool) is more visually natural, less occluding, and immediately communicates "this is the player to watch" without covering the action.

## Solution

Add a **Ground Spotlight** shape option alongside the existing Body Ellipse. When selected, the ellipse is projected onto the ground plane beneath the player's feet instead of centered on their body.

### UX Design

**Shape selector** in Overlay Settings (alongside Highlight Color, Stroke Width, Fill, Outside Dim):

| Option | Label | Description |
|--------|-------|-------------|
| Body Ellipse | "Body" | Current behavior — ellipse around full body |
| Ground Spotlight | "Ground" | Flat ellipse at player's feet |

When **Ground Spotlight** is selected:
- The ellipse shape changes: wider and shorter (landscape orientation, like a shadow on the ground)
- Fill defaults to ON at ~15-20% opacity (the "spotlight pool" effect needs fill to work)
- Stroke can be optional (some users may want just the glow, no ring)
- Outside Dim works the same way — dims everything except the spotlight area

Controls that stay the same in both modes:
- Highlight Color (the spotlight pool color)
- Stroke Width (outline of the ground ellipse)
- Fill opacity (brightness of the spotlight pool)
- Outside Dim (background dimming strength)

### Bounding Box → Ground Ellipse Math

YOLO detection returns a full-body bounding box: `{x, y, width, height}` where (x,y) is the center.

**Body Ellipse (current):**
```
center = (bbox.x, bbox.y)
radiusX = bbox.width / 2 * 1.3
radiusY = bbox.height / 2 * 1.3
```

**Ground Spotlight (new):**
```
// Center at the bottom of the bounding box (player's feet)
centerX = bbox.x
centerY = bbox.y + bbox.height / 2

// Wide, flat ellipse — width based on body width, height much smaller
radiusX = bbox.width / 2 * 2.0    // ~2x body width for natural ground spread
radiusY = bbox.height * 0.15       // ~15% of body height for flat ground look
```

Key insight: the Y-center shifts from body center to body bottom (feet), and the aspect ratio flips from tall-and-narrow to wide-and-flat. The exact multipliers should be tunable during development — these are starting points based on typical soccer camera angles.

**Camera angle consideration:** Soccer footage is typically shot from an elevated sideline angle (~20-30 degrees). A true ground-plane projection would require perspective correction (wider ellipse for closer players, narrower for farther). For v1, a fixed aspect ratio is sufficient — the visual reads correctly because the camera angle is consistent across most soccer footage.

**Tracking across frames:** The ground position tracks with the bounding box bottom edge. As the player moves, the spotlight follows their feet. During jumps (headers, bicycle kicks), the spotlight may briefly separate from the player — this actually looks natural since the "light source" is fixed on the ground.

### Data Model

Add a `highlightShape` field to overlay settings:

**Frontend store (overlayStore.js):**
```javascript
highlightShape: 'body',  // 'body' | 'ground'
```

**Backend (working_videos table):**
```sql
highlight_shape TEXT DEFAULT 'body'
```

The shape setting is global (per-project), not per-keyframe — all highlights in a project use the same shape. This simplifies the UI and matches user intent (you want consistent visual style across a reel).

### Rendering Changes

Both frontend SVG preview and backend OpenCV rendering need to support the ground ellipse:

**Frontend (HighlightOverlay.jsx):**
- When `highlightShape === 'ground'`, transform the interpolated keyframe position before rendering:
  - Shift Y to bottom of original bounding box
  - Apply ground aspect ratio to radiusX/radiusY
  - Increase default fill opacity

**Backend (keyframe_interpolator.py + video_processing.py):**
- Accept `highlight_shape` in `overlay_settings`
- Apply same transform before rendering

The interpolation itself doesn't change — we still interpolate the body-center keyframes, then transform to ground position at render time. This means existing keyframe data works with both shapes without re-detection.

## Context

### Relevant Files
- `src/frontend/src/stores/overlayStore.js` — Add highlightShape state
- `src/frontend/src/components/ExportButtonView.jsx` — Add shape selector UI
- `src/frontend/src/modes/overlay/overlays/HighlightOverlay.jsx` — Ground ellipse SVG rendering
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — Ground ellipse on detection click
- `src/frontend/src/screens/OverlayScreen.jsx` — Wire shape setting + persistence
- `src/frontend/src/api/overlayActions.js` — New gesture action for shape
- `src/backend/app/database.py` — Add highlight_shape column
- `src/backend/app/routers/export/overlay.py` — Thread shape through render pipeline
- `src/backend/app/ai_upscaler/keyframe_interpolator.py` — Ground transform in render
- `src/backend/app/modal_functions/video_processing.py` — Ground transform in Modal render
- `src/backend/app/services/modal_client.py` — Pass shape in overlay_settings

### Related Tasks
- Depends on: T2940 (Overlay Tuning) — uses the overlay_settings infrastructure built there
- Related: T2100 (Composable Overlay Architecture) — ground spotlight could become a "primitive" in that system

### Technical Notes
- The body-center keyframe data is preserved — ground transform is a render-time operation
- Switching between body/ground is non-destructive (no re-detection needed)
- Ground ellipse with fill + outside dim creates a natural "spotlight on the pitch" look
- Per-keyframe radiusX/radiusY still work for manual resize after detection
- Migration needed for new DB column (profile_db track)

## Acceptance Criteria

- [ ] Shape selector (Body / Ground) visible in Overlay Settings
- [ ] Ground spotlight renders as wide, flat ellipse at player's feet in preview
- [ ] Ground spotlight renders identically in exported video
- [ ] Switching shape is non-destructive — existing keyframes work with both
- [ ] Fill defaults to ON (~15%) when ground shape is selected
- [ ] Detection click produces correct ground-positioned ellipse
- [ ] Manual resize (drag handles) works with ground ellipse
- [ ] Outside Dim works correctly with ground ellipse mask
