# T8280 Design - 30fps Export Choice and fps-based Pricing for High-fps Sources

**Status:** DESIGN - AWAITING USER APPROVAL (Stage 2 gate)
**Tier:** L
**Task file:** `docs/plans/tasks/T8280-fps-export-choice-and-pricing.md`
**Follows on from:** `docs/plans/tasks/Tbug49p-modal-export-fps-mismatch.md` (DONE, deployed 2026-09-01)
**Potential blocking prerequisite:** `docs/plans/tasks/Tbug49p-followup-highlight-transform-fps-units.md` (TODO) - see Prerequisite Dependency section

This document is design-only. No implementation happens until the user approves, and in
particular until the user chooses between the Q2 options below (that choice sets the scope).

---

## 1. Current State

### 1.1 The two-pass render pipeline

```
Focus/framing export (pass 1, GPU GAN upscale)
  process_clips_ai (video_processing.py)
    -> reads EVERY source frame, upscales EVERY source frame (outscale=4)
    -> writes frame_{idx:06d}.png (1 png per source frame)
    -> ffmpeg: PNG seq (-framerate original_fps) -> -r 30 output (working video)
  RESULT: working video is 30fps CFR (Tbug49p Fix A forces -r <target_fps=30>)

Overlay export (pass 2, ffmpeg composite, NOT GAN, FREE to user)
  render_overlay (video_processing.py:411,425)
    -> reads the working video's OWN fps (cap.get(CAP_PROP_FPS)) and re-emits -r <that fps>
    -> no independent resample; no-highlights path is -c copy
  RESULT: overlay auto-inherits whatever fps pass 1 produced
```

Consequence today: for a 50fps source, pass 1 GAN-upscales 863 frames but only ~518
survive the `-r 30` output. ~40% of the (expensive) GAN compute is thrown away. The user
pays `ceil(video_seconds)` credits with no fps term, so a 50fps clip costs the same as a
30fps clip of equal duration despite costing us ~67% more GPU time.

### 1.2 Entry points and data flow (ground truth from Code Expert)

Read/upscale loop - `process_clips_ai` (`video_processing.py`):
- signature line 2631, `fps: int = 30` at 2639
- read loop 2845-2929
- `original_fps = cap.get(cv2.CAP_PROP_FPS) or fps` (2808) - silent fallback (a smell,
  see 1.5)
- `start_frame = int(absolute_start*original_fps)` (2825), `end_frame` (2826),
  `frames_to_process` (2827)
- `for frame_num in range(start_frame,end_frame)` (2845): `cap.read()` (2846),
  `frame_time=frame_num/original_fps` (2852), `_interpolate_crop` (2856),
  `rotate_then_crop` (2892), `upsampler.enhance(cropped, outscale=4)` (2896) = the GPU cost,
  writes `frame_{output_frame_idx:06d}.png` + `output_frame_idx += 1` (2906-2908)
- Emits ONE png per source frame; `output_frame_idx == source frame count` today

ffmpeg builders (`video_processing.py`):
- `_build_simple_ffmpeg_cmd` (2521): sig `input_fps=None` -> defaults to `fps` at 2536;
  `-framerate <input_fps>` for PNG input, output `-r <fps>`, audio `-t frame_count/input_fps`
- `_build_speed_change_ffmpeg_cmd` (2574): `-framerate <original_fps>`, output `-r <fps>`;
  speed PTS math inline 2963-3025 against `original_fps`
- Call sites: speed builder 3022-3025; simple builder 3029-3033 and 3037-3041 (both
  `input_fps=original_fps`)
- Three consumers assume `output_frame_idx == source frame count`: speed-change
  `output_duration = output_frame_idx/original_fps` (2973); `_build_simple_ffmpeg_cmd` audio
  `-t frame_count/input_fps`; the `-framerate input_fps` PNG-cadence declaration

Credit formulas (the ONLY place fps is absent):
- single-clip `framing.py:492-493`: `video_seconds = get_output_duration(segments_raw,
  source_duration)`; `credits_required = math.ceil(video_seconds)`
- multi-clip `multi_clip.py:2149-2155`: sums `get_output_duration` per clip, then `math.ceil`
- `get_output_duration` accounts for trim/speed only, NO fps term

fps detection:
- single-clip `framing.py:594-604` inside `_run_render_background` (background task, AFTER
  credits are reserved) - `get_video_info(source_url)` -> `framerate`. This does NOT feed a
  UI cost preview. There is NO pre-export fps-based cost preview anywhere today; the frontend
  never learns source fps.
- multi-clip has no request-path probe - reads stored `working_clips.fps`/`game_videos.fps`:
  `framerate = db_clip['wc_fps'] or db_clip['gv_fps']` (multi_clip.py:2320, Tbug49p Fix B)

Plumbing (target_fps is ALREADY wired end-to-end - contradicts the task's greenfield framing):
- single-clip `RenderRequest.target_fps:int=30` (`framing.py:375`) ->
  `_run_render_background(target_fps)` (531) -> `_export_clips(target_fps)` (710)
- multi-clip `target_fps:int=Form(30)` (`multi_clip.py:2055`) -> `_export_clips`
- shared `_export_clips` -> `call_modal_clips_ai(...,fps=target_fps)` (~1504) ->
  `process_clips_ai(fps=)`
- `ClipExportData` (multi_clip.py:78-92) already has `source_fps:float|None` (84), NO
  output-fps field; `normalized_clips_data` (1485-1492) forwards
  keyframes/segments/clipIndex/duration/clipName/rotation but NOT fps

Frontend:
- credit estimate at `ExportButtonView.jsx:157-170` (`data-testid="export-credit-estimate"`,
  `~${estimatedCredits} credit . balance ${creditBalance}`, gated
  `isFramingMode && !isCurrentlyExporting && estimatedCredits!=null`, amber via
  `insufficientForEstimate`)
- container `ExportButtonContainer.jsx`: `estimateExportCredits(clips)` exported 38-44
  (`sumEffectiveDurations` -> `getRequiredCredits`); `EXPORT_CONFIG={targetFps:30,
  exportMode:'fast'}` at 46-50 ("Fixed at 30fps" - the single knob); `estimatedCredits` memo
  1015-1022; export dispatch appends `target_fps` at 605 (form) + 644 (render body)
- `CompareModelsButton.jsx:133` also hard-codes `target_fps` '30'
- The estimate is a PURE render-time derivation (T350/T5790 doctrine) - any fps toggle MUST
  be gesture-driven, NEVER a reactive effect

### 1.3 The 30fps-CFR working-video assumption sites (critical for Q2)

A genuinely native-fps working video would violate the invariant "working video is always
30fps CFR". Sites that bake in 30:
- `SNAPSHOT_FRAMERATE = 30.0` (`highlight_carry.py:60`)
- `_build_framing_snapshot` `"fps": SNAPSHOT_FRAMERATE` (`multi_clip.py:138`, with a comment
  explaining why source_fps was NOT threaded - the follow-up)
- `transform_all_regions_to_working` + siblings `framerate=30.0` defaults
  (`highlight_transform.py:389,423,653,713,781,846,914,940`) - `working_frame =
  round(working_time*framerate)` (~761) must stay 30 while the crop conversion (~732) needs
  source fps; both conflated behind ONE param today
- detection timestamps assume 30: `calculate_detection_timestamps(...,fps=30)`
  (`multi_clip.py:785`, `frame=round(absolute_time*fps)` 816)
- overlay finalize `framerate=30.0` (`overlay.py:1975,2168`)
- `projects.py:1655`

Verdict (Code Expert): genuinely native-fps working video violates these; the
highlight_transform source/working-fps split (the follow-up doc) is a HARD prerequisite for
CORRECT native delivery.

### 1.4 Architecture diagram (current)

```
[Focus UI]                    [Backend]                     [Modal GPU]
ExportButtonView              framing.py / multi_clip.py     process_clips_ai
 credit estimate (30fps       target_fps=30 hard             upscale EVERY frame
 hard-coded, PURE derive)  -> credits=ceil(seconds)      ->  -> -framerate src, -r 30
 no source fps known             (NO fps term)                -> 30fps CFR working video
                                                                       |
                                                              render_overlay
                                                              inherits working fps -> 30fps out
```

### 1.5 Code smells in the touched area

| Smell | Location | Impact |
|-------|----------|--------|
| Silent fallback for internal data | `original_fps = cap.get(...) or fps` (video_processing.py:2808) | Hides a corrupt/missing source fps; violates the no-silent-fallback rule. In scope to fix loudly IF we touch this loop. |
| Duplicated fps=30 magic constant | 8+ sites in highlight_transform.py, plus multi_clip/overlay/projects | One param conflates source-fps and working-fps units (the follow-up bug). Do NOT fix here; make the dependency explicit. |
| Parallel target_fps hard-code | `ExportButtonContainer.jsx:46`, `CompareModelsButton.jsx:133` | Two frontend call sites bake 30. When fps becomes selectable, both must read the same source (single code path). |

---

## 2. Target State

The precise target depends on the Q2 choice. Below is the target for the RECOMMENDED option
(Q2 Option B - ship the 30fps cost-saving choice now, defer true native delivery). The
alternative targets are described inside Q2.

```
[Focus UI]                          [Backend]                      [Modal GPU]
ExportButtonView                    framing.py / multi_clip.py      process_clips_ai(fps, mode)
 - source fps surfaced to client    - credit formula gains fps      - mode="downsample_30":
 - if fps >= 31: show BOTH prices      term (see Q1)                    decode all, enhance()
   30fps (recommended) + native{f}  - target_fps from request           ONLY frames on 30 grid
 - toggle writes to local state       (already wired)               - mode="native": today's
   on click (gesture, not effect)   - fps probe surfaced pre-export    behavior, output -r=fps
 - if fps < 31: unchanged single                                    -> ffmpeg fps math keyed to
   price, target_fps=30                                                the ACTUAL png count/cadence
```

Key properties of the target:
- Single credit-estimate code path in the frontend (both prices derive from one helper; the
  toggle only picks which number to display and which `target_fps` to submit).
- Single render code path in the backend: `process_clips_ai` gains an explicit output-fps
  behavior driven by the already-wired `fps` param; the read loop skips enhance()+imwrite()
  for frames off the target grid instead of a parallel code path.
- Overlay/multi-clip inherit automatically (finding 5) - no new prompt, no new plumbing on
  the overlay side.

---

## 3. Open Question Resolutions

### Q1 - Exact credit formula

**Proposed:**
- `credits_30fps = ceil(video_seconds)` (unchanged from today)
- `credits_native = ceil(video_seconds * max(1, fps/30))`

**Reasoning (grounded in E6 benchmark anchors, modal-gpu.md:115):**
GAN cost is per-frame, not per-second: T4 ~= 681 ms/frame; a 10s clip @30fps ~= 300 frames
~= 204 GPU-s ~= $0.03; framing cost anchor ~= 0.3c/exported-second. Credits are charged flat
per second today, which is really a per-frame cost expressed against a 30fps assumption
(30 frames/s). Frame count for a clip of `video_seconds` at `fps` is `video_seconds * fps`.
So relative GPU cost native-vs-30 = `(video_seconds * fps) / (video_seconds * 30) = fps/30`.
For 50fps that is 1.667x; for 60fps 2.0x - which matches the "~67% more GPU" figure in the
task problem statement and the frame-count arithmetic in Tbug49p's root cause (863/518 =
1.667). The `max(1, ...)` clamp guarantees native never prices BELOW 30fps (protects the
25fps case, see Q3). The 30fps-choice price genuinely maps to real work because the
read-loop skip (Stage 1) actually removes the discarded-frame GAN cost - the discount is
backed by a pipeline change, not a fictional discount on unchanged work.

**Assumption stated explicitly:** this formula assumes GAN GPU-seconds scale linearly with
enhanced-frame count and that per-frame time is fps-independent (true - `enhance()` cost is a
function of crop pixel dimensions, not source cadence). Overhead (model load, decode, encode,
concat) is treated as amortized into the per-second anchor; at real clip lengths (multi-second)
this is a small constant relative to per-frame GAN time.

**EXPLICIT PRE-LAUNCH GATE (supervisor must run before shipping the number to users):** Modal
is OFF in /dotask containers (T4180), so real billed GPU-seconds CANNOT be obtained from
inside this session. Before the credit-formula change ships, the supervisor must render ONE
real high-fps clip (e.g. the 50fps cohort video) at native and ONE 30fps-choice render of
EQUAL source duration on real Modal, read the actual billed GPU-seconds from the Modal
dashboard, and confirm the ratio is ~= fps/30 (within, say, +/-15% after subtracting fixed
overhead). If the measured ratio diverges materially, the formula's multiplier is adjusted
before launch. This mirrors the Tbug49p rule "verify against real data, don't guess" and the
task's Acceptance Criterion 5. Ship behind this gate; do not launch the price on the formula
alone.

### Q2 - Does "native" deliver a genuinely native-fps file? (THE decisive question)

This choice sets the task's scope. Three options, each fully costed:

**Option A - Ship true native-fps delivery now.**
- What it means: the "native" choice produces a working video at the source fps (e.g. 50fps),
  genuinely smoother; the 30fps choice produces a 30fps file.
- Hard prerequisite: a native-fps working video violates the "working video is 30fps CFR"
  invariant baked into 8+ sites (section 1.3). Highlight-carry (`transform_all_regions_to
  _working`) conflates source-fps and working-fps behind ONE `framerate` param; a non-30
  working video makes `working_frame = round(working_time*framerate)` (~761) land in the
  wrong unit and corrupts persisted `highlights_data.frame`. This is EXACTLY the class of bug
  Tbug49p fixed, relocated. The follow-up doc (`Tbug49p-followup-highlight-transform-fps
  -units.md`, Status TODO) identifies the required split (separate `working_framerate` param)
  and its verification plan.
- Cost: the follow-up MUST land first as its own task (do NOT fold it in - it has its own
  blast radius across every 29.97fps project's carry fast path, `resolve_carried_highlights`
  Rule 2). Plus detection timestamps, overlay finalize, `SNAPSHOT_FRAMERATE`, snapshot
  equality, and projects.py:1655 must all be audited for the non-30 case. This is a
  multi-task epic, not a single L task.

**Option B - Ship the 30fps cost-saving choice now; defer true native to a follow-up. (RECOMMENDED)**
- What it means: two labelled prices are shown, but BOTH deliver a 30fps CFR working video
  today. The 30fps choice is the real product: it triggers the read-loop frame-skip so the
  user pays less AND we spend ~40% less GPU. The "native" label is DEFERRED - not shipped as
  a second delivered-fps until the follow-up lands.
- Wait - if both deliver 30fps, is that not the "pointless" outcome the task warns about
  (Q2's own "no visible difference" trap)? No, because we do NOT ship a second price for an
  identical file. Option B ships ONLY the 30fps side: the value is "your 50fps clip costs
  less than it does today, and we render it faster", with copy that explains the source was
  high-fps and we are down-sampling to 30 for a cheaper, visually-equivalent result. There is
  no second "native" button that delivers the same bytes at a higher price - that would be
  dishonest. True native delivery becomes a follow-up once the fps-units bug is fixed.
- Cost: the actual GPU-cost win (the task's headline), no dependency on the follow-up, correct
  and honest. Scope is one L task: read-loop skip + credit formula + fps surface + UI.
- Downside: users who genuinely want smoother-than-30 output must wait for the follow-up.
  Given the fleet data (4 high-fps videos total across prod, section Q3), this is a very small
  cohort; shipping the cost win to everyone first is the higher-value ordering.

**Option C - Ship BOTH labels now, but make "native" re-encode at native fps WITHOUT changing
working-video fps semantics.**
- Investigated: is there a way to deliver a native-fps FILE while keeping the working video
  30fps for the highlight-transform/overlay machinery? No. The working video IS the delivered
  framing artifact and IS the input to the overlay pass (finding 5: `render_overlay` reads the
  working video's own fps and re-emits `-r <that fps>`). There is no separate "working copy at
  30 + delivered copy at native" - it is one file. To make the delivered file native fps you
  must make the working video native fps, which re-triggers the entire section-1.3 dependency.
  You cannot re-encode a 30fps working video UP to 50fps and gain real smoothness - the
  discarded frames are gone; you would only be frame-duplicating, which is strictly worse than
  Option A (bigger file, no extra motion) and still trips overlay inheritance. **Option C is a
  dead end** and is not offered.

**RECOMMENDATION: Option B.** Ship the 30fps cost-saving choice now. It delivers the task's
real value (genuine ~40% GPU reduction and a lower, honest price for high-fps sources) with no
dependency on the unresolved fps-units bug and no risk to the 30fps-CFR invariant. True
native-fps delivery is a legitimate follow-up feature, but it is blocked on the
highlight_transform source/working-fps split landing first; bundling it here would drag a
second blast-radius bug (every 29.97fps project's carry fast path) into a cost feature. If the
user wants native delivery in this task, we take Option A and the follow-up becomes a filed,
landed-first blocking prerequisite (see Prerequisite Dependency section) - a materially larger
scope the user should choose with eyes open.

### Q3 - Exact threshold for "high fps"

**Proposed: strictly `fps >= 31`.**

**Reasoning against the fleet data (Tbug49p full-prod scan, 117 game videos / 70 profile DBs):**
50 videos at 29.97fps (standard NTSC), and 4 genuinely high/uneven: one 50, one 60, two 25.
- `>= 31` cleanly excludes 29.97 (rounds to 30 for every practical purpose; 0.1% drift,
  imperceptible - the reason bug 49p survived so long). Prompting the 29.97 majority with an
  irrelevant cost choice would be noise, not a feature.
- A tolerance BAND around 30 (e.g. `29 < fps < 31 -> treat as 30`) is unnecessary complexity:
  a single strict threshold `fps >= 31` already achieves the goal (only true high-fps sources
  trigger the choice). Keep it a single comparison - greppability beats cleverness.
- The two 25fps videos are BELOW 30, so the "cheaper" down-sample framing does NOT apply -
  you cannot skip frames you do not have. For sub-30 sources the pipeline behaves exactly as
  today (`-r 30` with the existing input cadence; ffmpeg duplicates frames to hit 30). The
  `max(1, fps/30)` clamp in Q1 already prevents any pricing anomaly for the sub-30 case. So:
  sub-30 sources are NOT prompted and are NOT changed by this task.

**Decision: `fps >= 31` triggers the two-choice UI; everything else (including 29.97 and
sub-30) exports exactly as today at 30fps, single price, no prompt.** Define the threshold as
a single named constant so both frontend and backend read the same number (e.g.
`HIGH_FPS_THRESHOLD = 31`), avoiding a divergent magic number.

### Q4 - UI placement and copy

**Exact component and control shape (no TBD):**

Placement: the existing credit-estimate line in `ExportButtonView.jsx:157-170`
(`data-testid="export-credit-estimate"`), driven by `ExportButtonContainer.jsx`. This is
already the Focus/export cost surface; the fps choice belongs immediately adjacent to it so
the price updates in place as the user toggles.

Control shape: a two-option segmented control (radio-group semantics) shown ONLY when
`sourceFps >= 31` (else the existing single line renders unchanged):

```
Your video was recorded at 50fps.
[ 30fps - recommended    18 credits ]   <- default selected
[ Native 50fps           30 credits ]
30fps looks just as smooth for most viewers and costs fewer credits.
                              balance 44
```

- Default selection: 30fps (the cheaper, recommended side).
- Each option shows its own credit figure computed from the SAME estimate helper (Q1 formula)
  - no second derivation path.
- Selecting an option is a GESTURE: onClick writes the chosen fps to local component state (or
  the export store slice), which the `estimatedCredits` memo and the export dispatch both read.
  This is NOT a reactive effect watching source fps (T350/T5790 doctrine - see Risks).
- States: default (30 selected), native-selected, insufficient-balance (reuse the existing
  amber `insufficientForEstimate` styling per the selected option's cost),
  loading-source-fps (before the fps probe resolves - render the existing single line as the
  fallback so the control only appears once fps is known).
- IMPORTANT scope note (the un-flagged gap): the frontend does NOT currently know source fps.
  A path to surface it is required (see Q4a). Until the probe resolves, show today's single
  line; do not block export on it.

For Option B (recommended), the copy and control are the same, but the "Native 50fps" option
is NOT offered as a delivered file - instead the panel shows a single recommended framing:
either (B-simple) no toggle at all, just the existing line with the cheaper price plus a one-
line note "Recorded at 50fps; exported at 30fps for a smaller, cheaper file", OR (B-toggle)
the two-option control where "Native" is present but explicitly labelled "coming soon /
higher smoothness" and disabled. **Recommend B-simple** for this task (one price, one note,
zero dead controls); add the live toggle when native delivery ships. The two-price segmented
control above is the Option-A shape.

**ui-designer pass:** the control shape, states, and copy are specified above and are
sufficient to implement. A dedicated ui-designer pass is OPTIONAL and only warranted if the
user picks Option A (a real two-price pricing surface benefits from visual polish); for
Option B-simple the single note line needs no separate design pass.

### Q4a - How the frontend learns source fps (required by Q4, un-flagged in the task)

There is no pre-export fps preview today. Two candidate mechanisms:

| Option | Mechanism | Tradeoff |
|--------|-----------|----------|
| Expose stored fps | Surface `working_clips.fps`/`game_videos.fps` (already read on the multi-clip path, multi_clip.py:2320) to the client via the existing clip/project payload | Zero new endpoint; fps is already in the DB for stored clips. Preferred when the value is already loaded client-side. May be NULL for legacy clips. |
| Lightweight fps probe endpoint | New `GET` that ffprobes the source (reuse `get_video_info`, framing.py:594-604) and returns `{fps}` | Authoritative, works when stored fps is NULL, but adds a round-trip and a new route. |

**Decision: prefer exposing the stored `fps` in the payload the Focus screen already loads**
(no new endpoint, no round-trip; the value already exists in `working_clips`/`game_videos`).
Fall back to a probe ONLY if the stored value is reliably NULL for the target cohort. If
stored fps is NULL, treat as "< 31" (no prompt) rather than probing eagerly - fail safe to
today's behavior. This keeps the change to a data-exposure, not a new synchronous probe on
every Focus load.

### Q5 - Does the user's choice persist?

**Decision: NO. Ask per export (a per-request param), do not persist.**

**Reasoning:** the choice is inherently per-clip - it only appears when a given source is
`>= 31` fps, which varies clip to clip. A persisted account/project default would apply a
"native" preference to a 30fps clip where it is meaningless, or silently bill a returning user
the native premium on a new high-fps clip they did not consciously choose for. `target_fps` is
ALREADY a per-request param end-to-end (finding 7); the cheapest correct design is to keep it
per-request with a default of 30 (the recommended/cheaper side). No account state to remember.

**Consequence: NO schema change. The Migration agent is NOT required** (see section 6). If the
user later wants a remembered default, that is a separate follow-up with its own schema/
migration decision; it is explicitly out of scope here.

---

## 4. Implementation Plan (staged, separable)

Stages are independently reviewable and land in order. For the RECOMMENDED Option B, Stage 4
ships as B-simple (single price + note). For Option A, Stage 0 (the follow-up) is a hard
predecessor and Stage 4 ships the two-price control.

### Stage 0 (Option A ONLY) - highlight_transform fps-units split (SEPARATE TASK, land first)

Not part of T8280's diff. Filed and landed as its own task per the follow-up doc before any
native-fps delivery work. Scope defined there: add `working_framerate: float =
SNAPSHOT_FRAMERATE` to `transform_all_regions_to_working`, make `framerate` mean source-fps
only, thread `clip.source_fps` into `_build_framing_snapshot` "fps", relax the
`SNAPSHOT_FRAMERATE`-is-always-30 invariant (docstring + export-pipeline.md), verify no
spurious carry `dropped:n` on 50/60/29.97 re-exports. NOT started here.

### Stage 1 - Backend read-loop frame-skip (the real GPU win)

File: `src/backend/app/modal_functions/video_processing.py`

- In `process_clips_ai` read loop (2845-2929): when down-sampling to `fps` (target < source),
  decode every frame (`cap.read()` stays at 2846 - you cannot seek a GAN pipeline cheaply and
  crop interpolation needs frame_time continuity) but only `enhance()` (2896) + `imwrite`
  (2906) frames that fall on the target grid. Grid membership: emit a frame when
  `int(frame_num * fps / original_fps)` advances (standard integer-cadence resampler) - this
  yields exactly the frames ffmpeg's `-r 30` would have kept, but the discard now happens
  BEFORE the expensive `enhance()` call.
- Fix the silent fallback at 2808 (`or fps`): log loudly if `cap.get(CAP_PROP_FPS)` returns
  0/NaN rather than silently substituting target fps (coding-standards: no silent fallback for
  internal data).
- Downstream consumers now key off the ACTUAL emitted-png count, not source frame count:
  - `output_duration = output_frame_idx / original_fps` (2973) becomes
    `output_frame_idx / target_fps` (the pngs are now at target cadence).
  - `_build_simple_ffmpeg_cmd` `input_fps` at the down-sample call sites (3029-3033,
    3037-3041) becomes `fps` (target), not `original_fps` - the pngs ARE 30fps now; audio
    `-t frame_count/input_fps` stays correct because `input_fps` now == 30 and frame_count is
    the reduced count.
  - `-framerate` declaration follows `input_fps` (=30 in the down-sample path).
- The NATIVE path (target == source, or `fps >= source`) is unchanged: today's behavior,
  `input_fps=original_fps`, `-r fps`. This is the SAME function with the cadence gate as a
  no-op, not a parallel code path.
- Speed-change branch (`_build_speed_change_ffmpeg_cmd`, PTS math 2963-3025): HIGHEST RISK.
  The PTS math is against `original_fps`; with a down-sampled read the pngs are at target
  cadence, so the branch's frame-count -> duration math and `-framerate` must switch to the
  target base consistently (mirror the simple-builder change). See Risks.

### Stage 2 - Backend credit formula (fps term)

Files: `src/backend/app/routers/export/framing.py:492-493`,
`src/backend/app/routers/export/multi_clip.py:2149-2155`

- Introduce a shared helper (DRY - the two formulas are duplicated today): given
  `video_seconds`, `source_fps`, and chosen `target_fps`, return
  `ceil(video_seconds * max(1, source_fps / target_fps))`. For the default 30fps choice with
  `target_fps=30` this reduces to `ceil(video_seconds)` (unchanged - existing tests stay
  green). Place near `get_output_duration` (a natural home for output-cost math).
- Both call sites call the one helper (single code path). Add `HIGH_FPS_THRESHOLD = 31` as a
  named constant shared with the frontend contract (Q3).

### Stage 3 - Surface source fps to the client (Q4a)

- Include the clip's stored `fps` (`working_clips.fps` / `game_videos.fps`) in the payload the
  Focus screen already loads. NULL -> client treats as < 31 (no prompt). No new endpoint.

### Stage 4 - Frontend UI + gesture toggle

Files: `src/frontend/.../ExportButtonView.jsx`, `ExportButtonContainer.jsx`,
`CompareModelsButton.jsx`

- Option B-simple (RECOMMENDED): when `sourceFps >= 31`, the credit estimate uses the
  down-sample price (Q1 with target 30) and shows the one-line note (Q4). `target_fps` stays
  30 at both dispatch sites (605, 644). No dead controls.
- Option A: render the two-option segmented control (Q4). Selecting an option writes the
  chosen fps to local/store state ON CLICK (gesture); the `estimatedCredits` memo (1015-1022)
  and BOTH dispatch sites (605, 644) plus `CompareModelsButton.jsx:133` read that single
  source instead of the hard-coded '30'. Never a reactive effect (Risks).
- Both prices derive from ONE estimate helper (mirror of the backend helper, or the existing
  `estimateExportCredits` extended with an fps arg) - single derivation path.

### Stage 5 - Tests (real-ffmpeg reproduction, mirroring tests/test_tbug49p_export_fps.py)

- Build a real non-30fps test video (e.g. 50fps and 60fps) as the existing Tbug49p test does.
- Assert for the 30fps-choice (down-sample) path: output `r_frame_rate == 30/1`, output
  `duration == source_duration +/- 1 frame`, AND emitted frame count == round(source_duration
  * 30) (proves the skip actually happened - the GPU-win is structurally verified, not just
  the duration).
- Assert for the native path (Option A, or as a today's-behavior regression under Option B):
  correct duration/speed at the chosen output rate.
- Cover the speed-change branch on a non-30fps source at BOTH choices (0.5x etc.): duration
  AND frame count. This is the branch with zero prior coverage that Tbug49p had to extract for
  testability; it is the highest-risk interaction.
- Credit-formula unit tests: `target_fps=30` on a 30fps clip == today's `ceil(seconds)`
  (regression); `target_fps=30` on a 50fps native price == `ceil(seconds*1.667)`; sub-30
  clamp == `ceil(seconds)`.
- Frontend unit test: toggle click updates the displayed price and the submitted `target_fps`;
  no effect fires on source-fps change (assert the store write traces to the click handler).
- The real-Modal GPU-seconds verification (Q1 gate) is a supervisor staging step, NOT a
  container test (Modal is off in /dotask, T4180) - documented as a rollout gate, mirroring
  Tbug49p's Rollout section.

### Rollout gate (mirrors Tbug49p)

- `modal deploy` is REQUIRED after merge - the read-loop change is inert until the Modal app
  is redeployed (staging auto-deploy does NOT touch Modal). Flag to supervisor.
- Run the Q1 real-GPU-seconds measurement before enabling the native price number (Option A)
  or before publishing the "cheaper" claim's magnitude (Option B).

---

## 5. Risks

| Risk | Mitigation |
|------|------------|
| Speed-change filtergraph PTS math breaks under frame-skip | `_build_speed_change_ffmpeg_cmd`'s PTS/duration math is against `original_fps`; down-sampled pngs are at target cadence. Switch its frame-base consistently and cover BOTH choices x speed-change in the real-ffmpeg test (the branch had zero coverage pre-Tbug49p). Treat as the top test priority. |
| Modal redeploy gate forgotten | Explicit rollout step; the code is inert until `modal deploy`. Verify on staging with a real non-30fps upload + ffprobe before prod, exactly as Tbug49p did. |
| Native delivery silently trips the 30fps-CFR invariant | Only relevant under Option A. Section 1.3 lists the 8+ sites; the highlight_transform fps-units follow-up is a HARD landed-first prerequisite (see section 7). Under recommended Option B this risk does not arise (working video stays 30fps CFR). |
| No pre-export fps preview exists today | Stage 3 surfaces stored fps; NULL fails safe to "< 31 / no prompt / 30fps" (today's behavior). No eager probe on every Focus load. |
| Reactive-persistence trap on the frontend toggle | The credit estimate is a PURE render-time derivation (T350/T5790). The fps toggle MUST write to store/local state IN the click handler; NEVER a `useEffect` watching source fps or selection. Enforced by a test asserting no effect fires. This is the single most likely place to regress the doctrine. |
| Q1 formula ships without real billing verification | Explicit pre-launch gate: measure real Modal GPU-seconds for one native vs one 30fps render of equal duration; adjust the multiplier if the ratio deviates materially. Do not launch on the formula alone (Acceptance Criterion 5). |
| Silent fps fallback (video_processing.py:2808) masks corrupt source fps | Fix loudly while in this loop (log + fail visibly), per coding-standards; do not extend the silent `or fps`. |

---

## 6. Migration Agent

**NOT required.** Q5 resolves to no persistence, hence no schema change on any track
(`user_db`, `profile_db`, `postgres`). If the user later wants a remembered fps default, that
is a separate task that would then include the Migration agent and a track decision. No
`_SCHEMA_DDL` / `_USER_DB_SCHEMA` change in T8280.

---

## 7. Prerequisite Dependency (explicit)

Whether the highlight_transform fps-units follow-up
(`Tbug49p-followup-highlight-transform-fps-units.md`, Status TODO) is a BLOCKING prerequisite
depends entirely on the Q2 choice:

- **Under Option B (RECOMMENDED - ship 30fps cost choice only):** NOT a prerequisite. The
  working video stays 30fps CFR, so none of the section-1.3 assumptions are violated. T8280
  proceeds independently. The follow-up remains TODO and becomes a prerequisite only for the
  LATER "true native delivery" feature.

- **Under Option A (ship true native-fps delivery now):** IT IS A HARD BLOCKING PREREQUISITE.
  The follow-up MUST be filed as its own task and LANDED FIRST, before any native-fps delivery
  work in T8280. Its fix (the source/working-fps param split) is NOT to be folded into T8280 -
  it carries its own blast radius (every 29.97fps project's verbatim-carry fast path,
  `resolve_carried_highlights` Rule 2) and its own verification (re-export 50/60/29.97 projects
  with carried highlights, confirm no spurious `dropped:n`). Folding it in would violate the
  "moves are mechanical, don't mix behavior change" and reviewable-unit-size refactoring rules.

The user's Q2 answer therefore determines both the scope AND whether a predecessor task must
be filed and completed first.

---

## 8. Design Decisions Summary

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Delivered native fps now? | A native / B 30-choice-only / C fake-native | B (recommend) | Real GPU win, no fps-units-bug dependency, honest pricing |
| Credit formula | flat / fps-scaled | `ceil(seconds*max(1,fps/30))` | Matches per-frame GAN cost + E6 anchors; verify vs real billing before launch |
| Threshold | `!=30` / band / `>=31` | `>=31` single constant | Excludes 29.97 majority; sub-30 unaffected |
| Source fps to client | stored payload / probe endpoint | stored payload, NULL->no prompt | No new endpoint/round-trip; fail safe |
| Persist choice | yes / no | no (per-request) | Choice is per-clip; target_fps already per-request; no schema change |
| Read-loop shape | parallel path / gated single path | gated single path | One code path; native = no-op gate |

---

## 9. Open Questions for the User (approval gate)

1. **Q2 is yours to decide:** Option B (recommended - ship the 30fps cost-saving choice now,
   defer true native delivery) or Option A (ship native delivery now, which requires filing +
   landing the highlight_transform fps-units follow-up as a blocking predecessor task first)?
2. Confirm you are comfortable that the Q1 credit multiplier ships behind a real-Modal
   GPU-seconds verification gate (one native vs one 30fps render measured on staging), not on
   the formula alone.
3. Confirm the threshold `fps >= 31` (29.97 and sub-30 sources unchanged, no prompt).
