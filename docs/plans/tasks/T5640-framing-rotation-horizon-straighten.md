# T5640: Framing rotation / horizon straighten (dial + straighten tool)

**Status:** TODO
**Impact:** 6
**Complexity:** 6
**Created:** 2026-07-20
**Updated:** 2026-07-20

## Problem

Handheld phone/camera footage and fixed "wonky" cameras (Arshia's behind-the-net camera on
prod: *Brilliant Save Pats Cup: Vs DPL vs Beach RL Behind Goal Jul 18*,
arshia.kalantari@gmail.com) come in with a **tilted horizon** — the goalposts lean, the ground
plane slopes. See the reference screenshot (`Desktop/Arshia.jpg`): the crop reticle is level but
the video content underneath is rotated a few degrees.

There is no way to correct rotation in the app. 90°-only rotation (the usual "rotate" button)
does not help — this needs **fine, by-the-degree** correction.

Framing is the *natural* place to fix it, and the fit is unusually clean: Framing already crops
away most of the frame, so **rotating the whole video and keeping a level crop introduces no
fill problem** — the black wedges a rotation exposes fall outside the crop and get discarded. The
user's own framing: *"keep the cropped region on 'horizon' and rotate the video to match horizon
to the crop."*

Not a high-frequency feature for clean Veo footage, but a real quality unlock for handheld and
off-axis fixed cameras (and a live prod case).

## Solution

Add a **single rotation angle per clip** (NOT keyframed — camera tilt is constant for a
recording) applied to the video *before* the crop in the render pipeline. Two ways to set it:

1. **Straighten tool (primary UX):** the user drags a reference line along something that should
   be level (the horizon) or vertical (a goalpost); the app computes the angle
   (`atan2(dy,dx)`, normalized to the nearest level/vertical) and applies it. This matches the
   user's mental model directly and is far better than eyeballing a dial. (Prior art: Lightroom /
   Apple Photos "straighten".)
2. **Fine dial / slider (secondary):** range roughly ±15°, numeric readout, nudge buttons at
   ±0.1° for touch-up, plus reset-to-0.

The rotated frame renders live behind the **level** crop reticle. The regions exposed by rotation
(outside the frame) render as clearly out-of-bounds (dimmed / checkerboard), and the crop is
**clamped to the largest level rectangle that fits inside the rotated frame** (the inscribed
safe-area for angle θ) so the export can never bleed black corners. Because users crop hard, the
safe area is almost always larger than the crop.

**Deferred to a follow-up (T5650-adjacent or its own task): auto-detect tilt** (horizon / line
detection to *suggest* an angle). The straighten tool covers ~90% without ML; do not block this
task on it.

## Context

### Relevant Files (REQUIRED)

Grounded in `.claude/knowledge/keyframes-framing.md`.

**Frontend**
- `src/frontend/src/modes/framing/hooks/useCrop.js` — crop defaults, virtual trim, interpolation;
  will hold/expose the clip rotation angle and the inscribed-safe-area clamp.
- `src/frontend/src/containers/FramingContainer.jsx` — gesture handlers (`handleCropComplete`
  L315-373); add rotation gesture handlers + surgical persist.
- `src/frontend/src/screens/FramingScreen.jsx` — Framing screen wiring.
- `src/frontend/src/components/.../CropOverlay.jsx` — the crop reticle; the straighten-line
  drag tool lives here, and it must render the rotated video + out-of-bounds mask.
- `src/frontend/src/hooks/useVideoDisplayRect.js` — the unified video↔screen transform (T4550);
  rotation composes with zoom/pan here. `videoToScreen`/`screenToVideo` must account for θ.
- `src/frontend/src/api/framingActions.js` — add a `set_rotation` surgical action.
- `src/frontend/src/utils/persistKeyframeEdit.js` — single persist path (may or may not extend;
  rotation is clip-scalar, not a keyframe — likely a sibling surgical call, not through this).

**Backend**
- `src/backend/app/routers/clips.py` — `framing_action` (L326); add `set_rotation`. Full-state
  `PUT /projects/{pid}/clips/{cid}` (L2001-2124) must persist rotation too.
- `src/backend/app/services/export/framing.py` — single-clip export; insert a `rotate` filter
  **before** `crop` in the FFmpeg chain.
- `src/backend/app/services/export/multi_clip.py` — multi-clip export path (~1427 / ~1739 INSERT
  sites); same filter insertion, per-clip angle.
- `src/backend/app/interpolation.py` / `generate_crop_filter` (L188-195) — the crop filter
  builder; rotation prepends `rotate=<rad>:...` (fill=black; corners are cropped away).
- Modal path — mirror the same filter change wherever the GPU export builds its filter chain.

**Schema / migration**
- New scalar on `working_clips` (profile_db): `rotation` REAL default 0 (radians or degrees —
  pick ONE and document; suggest **degrees** for readability, convert to rad at the ffmpeg
  boundary). Update `_SCHEMA_DDL`-equivalent (`ensure_database()` in `database.py`) for fresh DBs
  AND write a versioned `profile_db` migration (`v0NN_working_clips_rotation.py`).

### Related Tasks
- Pairs with **T5650** (large/messy footage ingest) — same feedback thread; rotation is the
  "fix it in Framing" answer that makes a mandatory pre-upload stage less necessary.
- Coordinate-transform SSOT: **T4550** (`useVideoDisplayRect`) — build on it, do not fork it.
- Interplay with aspect-ratio refit (`POST /aspect-ratio`, T3910) and default-centered-crop must
  be defined (rotation is orthogonal to ratio, but the safe-area clamp interacts with refit).

### Technical Notes
- **FFmpeg order is load-bearing:** `rotate` (or `rotate` via `rotate=a=<rad>`) **then** `crop`.
  The crop coordinates are expressed in the rotated frame's space. Confirm the crop-expression
  builder still lines up frame-for-frame after rotation (linear crop expr in `generate_crop_filter`).
- **Coordinate space is the core design decision → Architect gate.** Options: (a) crop coords
  stay in the *rotated* frame space and rotation is an outer transform applied first everywhere
  (frontend preview + backend export must agree); (b) crop coords in original space, rotation
  applied to the crop rect. (a) is simpler to keep consistent. Lock this in the design doc and
  add characterization tests that pin an exported frame for a known (angle, crop) pair.
- **Inscribed safe-area math:** for a frame W×H rotated by θ, the largest axis-aligned rectangle
  of a given aspect that fits is a closed-form (rotated-rectangle-in-rectangle). Clamp crop
  position+size to it on every rotation change and on every crop drag while rotation ≠ 0.
- **Persistence is gesture-based + surgical** (project-wide rule): the straighten-drag end and
  the dial commit each fire ONE `set_rotation` action with the new angle. No reactive/`useEffect`
  persistence. No full re-send of crop keyframes.
- **Single angle per clip**, not per-keyframe — do not thread rotation into the keyframe list.

## Implementation

### Steps
1. [ ] Stage 1 Code Expert: confirm exact filter-chain build sites (local + Modal + multi-clip)
       and the crop-expression coordinate assumptions.
2. [ ] **Stage 2 Architect (design gate, required):** coordinate space decision, safe-area clamp
       contract, schema field (degrees vs radians), persistence action shape, straighten-tool
       interaction spec. Produce `docs/plans/tasks/T5640-design.md`. **User approval before code.**
3. [ ] Schema: add `working_clips.rotation`; write profile_db migration; update fresh-DB DDL.
4. [ ] Backend: `set_rotation` action + full-state PUT persistence; `rotate`-before-`crop` in
       export/framing.py, multi_clip.py, Modal path; characterization test pinning a rotated+
       cropped export frame.
5. [ ] Frontend: rotation state in useCrop; rotate the preview video via useVideoDisplayRect;
       out-of-bounds mask; inscribed-safe-area crop clamp.
6. [ ] Frontend: straighten-line drag tool in CropOverlay + fine dial (±0.1°, reset, numeric
       readout); wire gestures to `set_rotation` surgical persist.
7. [ ] Verify end-to-end in a REAL browser on Arshia's clip (drag/pointer = real-browser rule)
       AND verify the exported video is actually level.

### Progress Log
**2026-07-20**: Created from user feedback (Arshia behind-goal tilted footage). No existing
content-rotation feature in the codebase (grep: only CSS spinners + RIFE benchmarks). Scoped
L-tier, design-gated on the coordinate-space decision.

## Acceptance Criteria
- [ ] A clip can be rotated by fractional degrees; the angle persists (surgical action) and
      survives reload + re-export.
- [ ] Straighten tool: dragging a line along the tilted horizon levels the video.
- [ ] The level crop over a rotated frame exports with **no black corners** (safe-area clamp
      holds); Arshia's clip exports level.
- [ ] Desktop crop drag behavior is unchanged when rotation = 0 (no regression).
- [ ] Real-browser verification (not jsdom) of the straighten/dial gestures + a leveled export.
- [ ] Tests pass; touched knowledge doc (`keyframes-framing.md`) updated at Stage 7.
