# On Fire: NBA Jam heat effects for Overlay

**Status:** TODO (thought experiment, filed for the "spice it up" tail of the roadmap)
**Impact:** 5
**Complexity:** 7
**Priority:** 0.7
**Created:** 2026-09-08
**Placement:** Post Launch, after the Overlay 3 composable-overlay work (T2100 is a hard prerequisite). This epic is deliberately NOT in any active milestone. Pick it up when the funnel, durability, and upload work are done and the product needs a delight feature.

## Goal

Let a parent flip a spotlighted athlete into NBA Jam "heating up" / "on fire" mode: embers under the feet, a flame plume that streams behind the player as they move, a fire ring instead of the plain spotlight, and a burst on the goal moment. Optionally, once ball tracking exists, the ball itself catches fire while the athlete has it and leaves a flame trail on the shot.

Why it is worth an epic at all: the product's core value is "puts the focus on your athlete" and the reels are shared on TikTok/IG by kids. NBA Jam's fire is the most recognizable "this player is unstoppable" visual in sports culture, it is instantly legible at phone size, and it is built from exactly the primitives the overlay pipeline already has (a tracked ellipse plus per-frame compositing). It turns a 3-play reel into a story: play 1 normal, play 2 heating up, play 3 on fire.

## What NBA Jam actually did (research, 2026-09-08)

| Rule / visual | NBA Jam (Midway arcade, 1993) |
|---|---|
| Trigger | A player makes 3 consecutive baskets without the other team scoring. After 2 the announcer says "He's heating up!", after 3 "He's on fire!". |
| Visuals | The ball is engulfed in flames and streams a fire trail while that player has it; a made shot singes/burns the net; smoke puffs. The flame and smoke sprites were lifted from Smash TV by Mark Turmell after Sal DiVita refused to draw new ones, then DiVita polished them. |
| Benefits | Unlimited turbo, higher shooting accuracy, free goaltending. |
| Ends | When the opposing team scores, or after the on-fire player scores 4 more baskets. |
| Variants | Tournament Edition added hot spots and clutch/fatigue; later games added Team Fire (3 consecutive alley-oops); the 2010 remake and On Fire Edition kept the same rule. |
| Audio | Tim Kitzrow's Marv-Albert-style calls ("He's heating up", "He's on fire", "Boomshakalaka") were the thing you could hear from across the arcade. |

Two takeaways that shape the design:

1. **The fire is attached to the ball, not the player.** The player's own sprite does not change; the ball burns while they hold it, and the net burns when it goes in. We do not have ball tracking, so v1 attaches fire to the athlete (feet + trail) and treats the ball as Phase 3.
2. **The magic was the escalation rule, not the sprite.** "Three in a row" is a narrative the viewer understands without explanation. A reel of an athlete's plays is already "consecutive baskets", so the escalation can be automatic across clips.

## What the codebase gives us today (audit, 2026-09-08)

| Capability | State | Pointer |
|---|---|---|
| Player lock-on | There is NO tracker. A region's spotlight position is Catmull-Rom interpolation between user-placed keyframes `{time, x, y, radiusX, radiusY, strokeOpacity, fillOpacity, color}`. | `keyframe_interpolator.py:126-180`, frontend `interpolateHighlightSpline`, Modal inline `_spline_interpolate_highlight` |
| Detection data | YOLOv8x, PERSON class only, 4 sampled frames per clip in the first 2 s (`calculate_detection_timestamps`). Boxes are centers in source pixels, no track ids. | `video_processing.py:955-1212`, `multi_clip.py:785-824`, `detections_data` (profile_db v027) |
| Ball detection | None. `routers/detection.py:6` mentions it in a docstring only. COCO class 32 is available in the baked `yolov8x.pt`. | `video_processing.py:1048,1192` (class filter) |
| Overlay render | Per-frame numpy/cv2 in BOTH backend paths (raw BGR piped to ffmpeg), inline SVG in the preview. No ffmpeg filtergraph for the highlight. | `overlay._process_frames_to_ffmpeg`, `keyframe_interpolator.render_highlight_on_frame`, `video_processing._render_highlight`, `HighlightOverlay.jsx:431-606` |
| Sprite compositing | Exists for text (T5225): app-side Pillow rasterizes RGBA PNGs, bytes ship to Modal per call, decoded once, alpha-blended per frame. Static layers only, must match frame dims. | `overlay.py:1188-1258`, `video_processing.py:242-310`, `modal_client.py:1161-1246` |
| Time-varying effect precedent | T5250 reveal envelope: a pure `(t, start, end)` function mirrored 3 times with a parity test. Glow/pulse was SKIPPED there because it was hard to mirror in the export path. | `utils/spotlightReveal.js`, `services/spotlight_reveal.py`, `video_processing._spotlight_reveal`, `tests/test_spotlight_reveal.py::TestModalInlineParity` |
| Style data model | Every style knob (`effect_type`, `highlight_color`, `highlight_shape`, `stroke_width`, `fill_*`, `dim_strength`) is a `working_videos` COLUMN, i.e. one setting per reel. No per-region style field exists. Additive region keys inside the `highlights_data` msgpack blob need no migration (T4355 `transition` precedent). | `database.py:1256-1279`, `overlay.py:696-1142` (action dispatch) |
| Modal overlay image | numpy + opencv-headless + boto3 only. Any library or code change is a manual, user-gated staging-then-prod redeploy. | `video_processing.py:60-68`, `app/modal_functions/deploy.py` |
| Composable primitives | Planned, unstarted: T2100 (primitive registry + per-clip primitive array), T2120 pulse ring, T2170 glow, T2150 presets, T2140 event badges, T2160 re-acquisition, T2220 multi-player tracking. | `docs/plans/tasks/overlay-v2/` |

## Algorithm evaluation

### A. What the fire attaches to (motion source)

| Option | How | Cost | Verdict |
|---|---|---|---|
| A1. Spotlight ellipse (interpolated) | Anchor = the ellipse the render loop already computes each frame. Feet point = `(x, y + radiusY)` for the body shape; for the ground shape the ground ellipse IS the feet. Velocity `v(t) = (p(t+dt) - p(t-dt)) / 2dt` from the same spline, `dt = 1/fps`. Trail direction = `-v`, intensity = `clamp(|v| / v_ref)`. | Zero new detection, zero new Modal calls. Works on every existing reel. | **v1.** The user already accepts the ellipse as "the athlete"; the flame inherits exactly the tracking quality the spotlight has. Weakness: with 2 keyframes the trail is a straight line, and it lags real motion the same way the ring does. |
| A2. Dense tracking on the region span | Run YOLO on every frame (or every 2nd) of each fire region on the WORKING video, with Ultralytics' built-in ByteTrack (`model.track(persist=True)`, no new dependency). Pick the track whose box best overlaps the user's keyframe ellipse. Feet = bbox bottom-center per frame, smoothed (EMA or 1-euro). | New Modal call per export (~30 ms/frame on T4 at imgsz 640; a 10 s region is ~300 frames, ~10 s of GPU), payload grows from 4 to ~300 samples per clip, Modal redeploy. | **v2**, and it is exactly the T2160/T2220 work. Enables scorch footprints (needs real feet) and a trail that reacts to cuts and stutter-steps. Gap bridging through occlusion falls back to A1's spline. |
| A3. Optical flow in the ellipse ROI | `cv2.calcOpticalFlowFarneback` on the ellipse crop between consecutive frames gives a local motion vector without any detector. | cv2 already in the Modal image; ~5 ms/frame at ROI size. Preview cannot compute it (no frame history in SVG), so preview and export would disagree on trail direction. | Rejected for direction. Maybe useful later as an intensity-only signal on the export side. |

### B. How the fire is drawn (render technique)

The hard constraint is preview == export with THREE implementations (SVG preview, backend numpy, Modal inline numpy that cannot import `app`). T5250 dropped glow/pulse over this. Whatever we pick has to be a pure function of `(t, anchor, velocity, radius, level)` plus assets both sides can load byte-identically.

| Option | How | Parity risk | Verdict |
|---|---|---|---|
| B1. Sprite-sheet flames (what NBA Jam did) | Author an ORIGINAL flame animation once (plume, trail, embers, smoke, burst; 24-frame loops at 12 fps for the arcade feel, 256 px RGBA PNGs). A pure placement function returns `[ {sprite, frame_index, cx, cy, scale, rotation, alpha, blend} ]` per frame: `frame_index = floor(t * 12) mod 24`, scale from `radiusY`, rotation from `atan2(-vy, -vx)`, alpha times the T5250 reveal factor. Preview draws them as SVG `<image>` with `mix-blend-mode: screen`; both numpy paths bilinear-resize the same PNG bytes and apply screen blend `1 - (1-a)(1-b)` for flame, normal alpha for smoke. Assets ship as bytes per Modal call like T5225 text layers, so tweaking art never needs an image rebuild. | Low. Same PNG bytes, same integer frame index, same affine; differences are resampling rounding. | **v1.** Deterministic, cheap (one blend of a ~300 px sprite per frame), and it is literally the technique the original used. |
| B2. Procedural particle system | Emit N particles per frame at the feet with lifetime, buoyancy, inherited `-v`, color ramp white to yellow to orange to red to gray, additive blobs. Seeded per `(region_id, frame)` with a tiny xorshift PRNG so all 3 copies agree. | Medium-high. The sim can be mirrored and parity-tested, but the pixel output of SVG/canvas blobs vs numpy gaussians will not match, and it is a 4th mirrored physics copy to maintain. | v2 or never. Only if B1 looks too "arcade" for the recruiting audience. |
| B3. Motion trail / ghosting | Ring buffer of the ellipse ROI from the last k frames, composited with decaying alpha and an orange tint (the "speed lines" look). | High. Trivial in numpy, impossible in SVG (no frame history); preview would need a canvas that replays video frames. | Deferred. Revisit if the preview layer moves to canvas for other reasons. |

### C. Grabbing the ball

| Step | What it takes | Assessment |
|---|---|---|
| C1. Detect the ball | Add COCO class 32 to both YOLO functions (2-line class filter change), split the payload into `person`/`ball` boxes (ripples into `slice_detections`, `hoist_video_detections`, and the frontend `sliceDetections`). Run on the Focus OUTPUT (cropped + upscaled 9:16 working video), where the ball is 30-60 px instead of the 8-15 px it is in the raw wide shot. Add `imgsz=1280` if recall is still poor. | The biggest lever is running on the Focus output, not the raw game. Still expect misses on blur and occlusion; measure before building anything on it. |
| C2. Track the ball | ByteTrack or a constant-velocity Kalman filter over the per-frame detections with gap interpolation (ball paths are near-parabolic, so short gaps are predictable). | Standard, low risk once C1 recall is acceptable. |
| C3. Possession + ignition | Ball is "held" when its center is within `k * bboxHeight` of the tracked athlete's feet point for >= 3 frames. Ignite on first held frame, keep burning while held, and on release with `|v_ball| > v_shot` switch to the shot-trail sprite (the classic flaming shot). Goal moment (T2140 event badge time, or the region end) fires the burst (the net-burn analog). | The fun part, and a small amount of logic once C1/C2 exist. |
| C4. Fallback if recall is bad | A fine-tuned YOLOv8n on a public soccer-ball dataset, or a TrackNet-style heatmap model. | Real ML project, separate Modal image, out of scope until C1 is measured. |

Verdict: **evidence-gate the ball.** Ship a measurement spike (T9260) that reports ball recall on 10 real user working videos inside spotlight regions. Proceed to C2/C3 only if recall inside possession windows is >= 80%.

### D. Heat semantics (the escalation rule)

Per-region level, `off | heating | fire`, chosen by the user. Plus one optional reel-level preset, "NBA Jam mode", that sets the level automatically by clip position: clip 1 off, clip 2 heating, clip 3 and later fire, burst at each region end. This maps "3 consecutive baskets" onto "3 plays in a reel" and needs nothing new from detection.

Announcer audio is out of scope: the Kitzrow lines are EA/Midway trade dress, and the Overlay 3 epic already excludes audio. A `"{Athlete name} is heating up"` text badge via T2130/T2140 gets the same beat legally.

## Effect catalog (all sprite-based in v1)

| Level | Feet | Motion | Ring | Moment |
|---|---|---|---|---|
| heating | Ember glow + occasional sparks at the feet point | Faint heat trail only above `0.5 * v_ref` | Spotlight stroke tinted orange, unchanged geometry | none |
| fire | Flame plume (height scales with `radiusY`), smoke puffs | Flame trail streaming along `-v`, length and alpha scale with speed | Animated fire ring replaces the stroke | Burst + smoke at region end or goal marker |
| fire + ball (Phase 3) | as above | Ball engulfed while held, shot trail on release | as above | Burst on the goal marker |

Entrance and exit use the existing T5250 reveal envelope so nothing pops.

## Pipeline

```mermaid
flowchart LR
  KF[Region keyframes<br/>user-placed] --> SP[Catmull-Rom spline<br/>p(t), radius(t)]
  SP --> V[Finite-difference<br/>velocity v(t)]
  SP --> FT[Feet point<br/>x, y + radiusY]
  H[Region heat level<br/>off / heating / fire] --> PL
  V --> PL[heat_placements(t, ...)<br/>pure, mirrored x3]
  FT --> PL
  RV[T5250 reveal factor] --> PL
  PL --> SVG[Preview: SVG image layer]
  PL --> NP1[Backend numpy blend]
  PL --> NP2[Modal inline numpy blend]
  AS[Flame sprite PNGs<br/>original art, shipped as bytes] --> SVG
  AS --> NP1
  AS --> NP2
```

## Design constraints (inherited, non-negotiable)

1. **Preview == export.** The placement function is mirrored three times and pinned by a parity test exactly like `TestModalInlineParity`. No effect ships to one path without the other two.
2. **Gesture persistence, surgical.** `set_region_heat` is one action carrying only `{region_id, level}`; never a full-state write, never a `useEffect`.
3. **Per-region key, no schema change for v1.** `heat` lives inside the region dict in `highlights_data` (additive key, T4355 precedent). Absent key means `off`. The reel-level "NBA Jam mode" belongs to T2150's preset system, not a new `working_videos` column.
4. **No new Postgres state.** Everything is per-profile SQLite blob data.
5. **Runtime fixups stay in memory.** The sprite placements are derived every frame; nothing derived is ever persisted.
6. **Modal changes are an ops gate.** T9230 and T9250 are inert in prod until the user runs the staging-then-prod Modal redeploy.
7. **Original art only.** No NBA Jam sprites, no voice lines, no "Boomshakalaka" text. "On fire" and "heating up" as plain phrases are fine.
8. **Credit cost stays zero for v1.** Sprite compositing rides inside the existing overlay render; only T9250 dense tracking and T9260 ball detection add GPU time, and they must show it in the credit estimate (T5790 pattern).

## Tasks (strict order inside the epic)

| ID | Task | Impact | Cmplx | Pri | Depends on |
|----|------|--------|-------|-----|------------|
| T9210 | [Flame asset pipeline + heat placement spec (mirrored x3)](T9210-flame-assets-and-placement-spec.md) | 5 | 4 | 1.3 | T2100 |
| T9220 | [Per-region heat level: data key, action, settings UI](T9220-region-heat-level-data-and-ui.md) | 5 | 3 | 1.7 | T9210 |
| T9230 | [Render the fire in all three paths (preview, backend, Modal)](T9230-render-fire-three-paths.md) | 6 | 7 | 0.9 | T9220 |
| T9240 | ["NBA Jam mode" auto-escalation preset + goal burst](T9240-nba-jam-mode-preset.md) | 6 | 4 | 1.5 | T9230, T2150, T2140 |
| T9250 | [Dense tracking for feet fire + scorch footprints](T9250-dense-tracking-feet-fire.md) | 5 | 7 | 0.7 | T9230, T2160/T2220 |
| T9260 | [Ball on fire: recall spike, then possession + shot trail (evidence-gated)](T9260-ball-on-fire-spike.md) | 4 | 9 | 0.4 | T9250 |

Phase 1 = T9210-T9230 (the feature). Phase 2 = T9240 (the narrative). Phase 3 = T9250-T9260 (real tracking, the ball).

## Non-goals

- Announcer audio or any audio.
- Real-time effects in Annotate or Focus; this is Overlay-only, post-process.
- Changing the spotlight tracking model itself (that is T2160/T2220; this epic consumes it).
- Heat shimmer / displacement (needs a displacement map in SVG and numpy; not worth a 4th mirrored effect).

## Open questions (for the user, when this is picked up)

1. Art direction: arcade-faithful pixel flames, or a softer "cinematic" plume that fits the recruiting preset? (Affects T9210 only; the pipeline is the same.)
2. Should "NBA Jam mode" be the default for reels with 3+ clips, or always opt-in? Recruiting-reel parents may not want it.
3. Is it worth a Focus-output ball recall measurement before Phase 1 ships, to decide early whether Phase 3 is real?

## Completion criteria

- [ ] A region can be set to heating or fire and the flame follows the spotlight through the whole region, entrance and exit faded by the reveal envelope
- [ ] Preview and export are visually identical on the same reel (parity test green in all three copies)
- [ ] "NBA Jam mode" escalates across a 3-clip reel with no manual per-region setup
- [ ] No new Postgres state, no profile_db migration for Phase 1
- [ ] Modal redeploy verified on staging then prod; render time per reel within the 600 s `render_overlay` cap
- [ ] Ball phase either shipped with measured recall or explicitly closed with the measurement recorded

## Sources

- [Wayback Wednesday: Why Being On Fire Was So Cool in NBA Jam (NLSC)](https://www.nba-live.com/ww-why-being-on-fire-was-so-cool-in-nba-jam/)
- [Fire (NLSC Wiki)](https://www.nba-live.com/nbalivewiki/index.php?title=Fire)
- [NBA Jam (1993 video game), Wikipedia](https://en.wikipedia.org/wiki/NBA_Jam_(1993_video_game))
- [The Behind-the-Scenes Story of "He's on Fire!" in NBA Jam (MEL Magazine)](https://melmagazine.com/en-us/story/hes-on-fire-nba-jam)
- [Devs tell the tale of making NBA Jam (Game Developer)](https://www.gamedeveloper.com/design/devs-tell-the-tale-of-making-i-nba-jam-i-i-was-down-on-the-monster-dunks-)
- [Ball Tracking in Sports with Computer Vision (Roboflow)](https://blog.roboflow.com/tracking-ball-sports-computer-vision/)
- [Tracking the Blur: Accurate Ball Trajectory Detection in Broadcast Sports Videos (ACM MMSports 2024)](https://dl.acm.org/doi/10.1145/3689061.3689075)
- [Automating Basketball Highlights with Object Tracking (Medium)](https://medium.com/swlh/automating-basketball-highlights-with-object-tracking-b134ce9afec2)
