# T5650 — DJI 8K ingest reduction study (empirical)

**Date:** 2026-07-20
**Author:** hands-on measurement pass (ffmpeg) on the real footage
**Source:** `C:\Users\imank\projects\video-editor\formal annotations\ECNL Test - DJI Action 6`
**Feeds:** [Multi-File Ingest & Prep epic](../tasks/prepare-stage/EPIC.md)
**Related:** [T5640 — Framing rotation / horizon straighten](../tasks/T5640-framing-rotation-horizon-straighten.md)

---

## TL;DR

For what the app actually needs, the **50 GB of 8K drops to under 1 GB of "relevant" video —
a 50–200× reduction — with no exotic codec, no SVC, no AI background modeling.** The three
levers that do all the work, in order of impact:

1. **Edit on a proxy, not the master.** DJI already ships a frame-accurate 720p proxy (`.LRF`)
   next to every `.MP4` — **13× smaller, free, already on disk.** For cameras that don't ship one,
   we generate it once on ingest.
2. **Trim temporally.** ~23 of the 68.5 min is warm-up/dead; a behind-goal highlight camera only
   "matters" for a fraction of play. Trimming is the single biggest byte lever.
3. **Conform the crop from the master only at export.** A tight 1920×1080 crop of the 8K frame is
   broadcast-crisp with **zero upscaling** (see [`roi_crop_native_1080.jpg`](dji-study-assets/roi_crop_native_1080.jpg)).
   You only ever need full-res pixels for the chosen crop × the chosen clip windows.

**Counter-intuitive finding that kills the fancy-codec ideas:** cropping alone barely beats the
proxy on size (crop re-encodes land at 8.6–11.9 Mbps vs the proxy's 7.5 Mbps). **Crop is a
framing/quality operation, not a compression lever.** The compression comes from *trim* +
*edit-on-proxy*. That's exactly why SVC / AI-background-flatten aren't worth it — the boring
proxy+trim+conform stack already gets 50–200×.

---

## 0. Refined design — decisions locked (user direction 2026-07-20)

These supersede the open forks below; the rest of the doc is the evidence that led here.

1. **Drop intelligent trim → manual client-side trim.** The prototype (§9) proved auto-trim is the
   hard part (headcount and motion don't separate warm-up from play). The user knows what's junk;
   a manual trim in Prep is simpler and reliable. Auto-**crop** (which works) survives as a Framing
   assist.
2. **Dual-asset pipeline: keep BOTH proxy (LRF) and master (MP4), use each where it fits.**
   *Proxy drives every decision/scrub surface; master supplies every output-pixel surface; upscale
   only fills the gap.*

   | Stage | Asset | Why |
   |---|---|---|
   | Client Prep (pre-upload) | LRF preview | scrub/trim/mark cheaply; 8K too heavy to interact with |
   | Upload | trimmed **LRF + MP4** | proxy for editing, master for output |
   | **Annotate** (find clip in/out) | **LRF** | needs to *see the play*, not detail; fast scrub, cheap stream |
   | **Framing** — live crop-drag preview | **LRF** | don't need 8K to place a rectangle; crop = normalized coords |
   | **Framing** — export / conform | **MP4** (crop ROI, native) | seek clip window, crop ROI; full-res output |
   | **AI upscale** | only if native crop < target | 8K crop usually already ≥1080p → **upscale is the exception** |

   "Access the right parts of the MP4 during framing" = the conform step (read only crop-window ×
   clip-time from the master, never whole 8K). Optional upgrade: stream that same ROI into the
   Framing *preview* so it's sharp during adjustment.
3. **New "Multiple Files" ingest mode** (third `VideoMode` beside `PER_GAME`/`PER_HALF` in
   `gameConstants.js` + backend `constants.py`; modal `GameDetailsModal.jsx` labels "Full Game" /
   "Per Half"): pick a folder → drop into a full-screen **client-side Prep** workspace
   (progressive disclosure — the 95% clean-Veo users never see it):
   1. **Assemble** — files auto-ordered by filename timestamp, drag to reorder, one virtual timeline.
   2. **Trim** — multiple keep-ranges on the combined timeline (drop warm-up, halftime, dead time).
   3. **Preview** ("watered-down animation") — scrubbable **LRF playback** of the assembled
      timeline (720p *is* the low-fi preview; even lighter = thumbnail filmstrip + on-demand decode).
   4. **Mark** — drop "annotate this" markers on plays spotted during preview → carried into
      Annotate as pre-seeded clip candidates (the Prep→Annotate bridge).
   5. **Confirm** — client **stream-copy** trims + concatenates kept ranges from BOTH proxy and
      master (no re-encode → fast, lossless, keeps 8K), uploads both (resumable/background),
      creates the game.
4. **Proxy source:** use the camera's shipped proxy (DJI `.LRF`) when present; else generate one
   (client-side downscale, or server-side after master upload). Upload cost counts both assets but
   both are small after the manual trim.

**Becomes an epic.** Suggested child tasks: (a) `VideoMode.MULTI_FILE` + Prep workspace shell;
(b) client-side assemble/trim/concat (ffmpeg.wasm/WebCodecs, stream-copy) + resumable dual-asset
upload; (c) proxy/master pairing in the data model + storage-credit accounting; (d) Annotate reads
the proxy; (e) Framing conforms from the master + upscale-only-as-needed; (f) Prep markers →
Annotate clip candidates; (g) fisheye de-warp/level (shares T5640).

---

## 1. The footage

Four recordings, capture-ordered by filename timestamp (`DJI_YYYYMMDDHHMMSS_NNNN_D`):

| # | File (MP4 master) | Start | Duration | Master size | LRF proxy | Content (from contact sheets) |
|---|---|---|---|---|---|---|
| 0003 | `DJI_20260718105543_0003` | 10:55:43 | 23:30 | 17.18 GB | 1.30 GB | mostly **warm-up / distant** play |
| 0004 | `DJI_20260718111915_0004` | 11:19:15 | 16:53 | 12.35 GB | 0.91 GB | **live game**, active across field |
| 0005 | `DJI_20260718114459_0005` | 11:44:59 | 23:31 | 17.18 GB | 1.31 GB | **live game**, active (clouds later) |
| 0006 | `DJI_20260718120831_0006` | 12:08:31 | 04:33 | 3.33 GB | 0.25 GB | **live game**, then ends |
| | **Total** | | **68.5 min** | **~50 GB** | **3.77 GB** | |

**Master spec:** HEVC (H.265), **7680×4320 (8K)**, 29.97 fps, **~94–96 Mbps**, Main10.
**LRF spec:** H.264, **1280×720**, 29.97 fps, **~7.5 Mbps**. Frame counts match the masters
(42263 vs 42264) — the LRF is a **frame-accurate proxy**, not an approximation.

---

## 2. Key discovery: the camera already ships the proxy

DJI's `.LRF` ("Low-Resolution File") is a 720p H.264 companion to each 8K master, identical in
duration and frame count. This is *literally the proxy-and-conform workflow pre-built by the
camera.* Editing decisions (annotate = find clips, framing = choose crop) never need the 8K —
they need enough resolution to see the play, which 720p delivers.

**Design consequence (user directive 2026-07-20):** *leverage the shipped proxy when present,
generate our own when it's not* — we can't assume every camera ships an LRF. So the ingest
contract is:

```
on ingest of a video file:
  if a sibling proxy exists (DJI .LRF, or a *_proxy.mp4, etc.) and is frame-accurate:
      use it as the edit proxy            # free, instant
  else:
      generate a proxy (downscale to ~720–1080p H.264, one cheap transcode)
  keep a pointer from proxy -> master for conform-on-export
```

---

## 3. What's actually in the footage (contact-sheet analysis)

Contact sheets (1 frame/min, 720p proxy): [0003](dji-study-assets/sheet_0003.jpg) ·
[0004](dji-study-assets/sheet_0004.jpg) · [0005](dji-study-assets/sheet_0005.jpg) ·
[0006](dji-study-assets/sheet_0006.jpg). *(Yellow labels are miscomputed — real time =
tile index in minutes, row-major.)*

Observations that drive the edit requirements:

- **Fixed camera behind one goal.** The background (sky top ~35%, field mid-band, near-foreground
  bottom ~15%, the black goal-mount bar on the left) is *identical* for a whole recording. The
  useful action lives in a central horizontal band ≈ 50% of frame height.
- **The camera was re-aimed between recordings.** 0003's framing sits higher/tighter than
  0004–0006. → **the crop ROI is NOT constant across the four files**; each recording needs its
  own ROI (once).
- **Severe fisheye.** The horizon is strongly barrel-curved. This is *lens de-warp*, a **separate
  need from the T5640 tilt/rotation feature** — de-warp is a known-lens correction, tilt is a
  small arbitrary rotation.
- **Warm-up vs game.** 0003 is largely warm-up / distant knock-about; 0004–0006 are the match.
  A large temporal trim is available before any codec work.
- **Native crop quality is excellent.** A 1920×1080 window cut straight from the 8K
  ([`roi_crop_native_1080.jpg`](dji-study-assets/roi_crop_native_1080.jpg)) is sharp enough to
  read jersey numbers — **no upscaling required**, which is the entire argument for conforming
  from the master. ROI drawn on the full frame:
  [`roi_on_full_frame.jpg`](dji-study-assets/roi_on_full_frame.jpg).

---

## 4. Measured reduction (real ffmpeg numbers)

Measured on a 30 s live-play segment (0005 @ 600 s). Per-minute = ×2.

| Stage | Mbps | MB/min | vs master |
|---|---|---|---|
| **8K master** (HEVC, stream-copy, no re-encode) | 96.4 | 723 | 1× (baseline) |
| **720p LRF proxy** (stream-copy) | 7.5 | 56.5 | **12.8× smaller** |
| CROP A: field-band → 3840-wide, HEVC CRF26 | 11.9 | 89.4 | 8.1× smaller |
| CROP B: 1920×1080 **native** crop of 8K, HEVC CRF24 | 8.6 | 64.4 | 11.2× smaller |

**Read the crop rows carefully:** re-encoding a *crop* of the 8K lands at 8.6–11.9 Mbps — right
next to the 7.5 Mbps proxy, and sometimes *bigger*. Cropping does not compress; **trim and
edit-on-proxy compress.**

---

## 5. Reduction scenarios (projected to the full 68.5 min)

| Scenario | What it holds | Projected size | vs 50 GB |
|---|---|---|---|
| **Masters (do nothing)** | all 8K | 50 GB | 1× |
| **Edit proxy, as-is** | all 68.5 min @ 720p LRF | **3.77 GB** | **13×** (free, on disk) |
| **Edit proxy, trimmed to game** | ~35 min relevant @ 720p | **~2.0 GB** | ~25× |
| **Final conform source** ⭐ | the actual reels: ~10–15 clips × ~20 s of **1080-native crop** | **0.3–0.6 GB** | **80–160×** |
| Watchable full-game archive (optional) | ~45 min field-band @ 4K | ~4 GB | ~12× |

⭐ **This is the number that matters for the product.** The app renders reels, and a reel is a
handful of short crops. Everything else is scaffolding to *choose* those crops — and choosing
can happen on the 720p proxy. So the pipeline only ever moves: a ~2–3.8 GB proxy (or streams it),
plus, at export, a few hundred MB of native crops conformed from the master.

**Where the master lives** is then the only real infra decision (T5650's fork): keep it local
(desktop companion reads it for conform) vs upload once (resumable) vs never (proxy res is enough
for the crop). For a *behind-goal wide* shot the crop is small, so master-side conform is worth
it; for tighter footage the proxy may suffice.

---

## 6. Edit requirements (what a human/tool must actually do)

Derived from doing it by hand on this footage:

1. **Assemble** the 4 recordings in capture order (0003→0004→0005→0006). *Trivial* — specs match,
   so stream-copy concat, no re-encode.
2. **Trim** warm-up (most of 0003) + between-play dead time. Needs content understanding.
3. **Crop ROI per recording** — the camera was re-aimed, so the ROI must be set per file (not
   once for the whole game).
4. **De-warp + level** the fisheye (curved horizon). Known DJI lens → a fixed lens profile;
   arbitrary tilt on top → T5640.
5. **Select highlights** (which plays make the reel). This is the actual creative act.
6. **Conform** — pull the final crops from the master at full res on export.

---

## 7. Automatable vs manual

| Step | Automatable? | How / notes |
|---|---|---|
| Assemble in order | **Fully** | sort by filename timestamp; stream-copy concat (specs identical) |
| Proxy (when no LRF) | **Fully** | one downscale transcode to 720–1080p H.264 |
| Use shipped proxy | **Fully** | detect sibling `.LRF`/proxy, verify frame count vs master |
| Drop warm-up / dead time | **Semi** | coarse auto: field-band frame-difference / player-density → cut spans with no players near play. Precise highlight timing stays human/AI (that's Annotate) |
| Per-recording crop ROI | **Semi** | auto goal/field detection proposes an ROI; human confirms — this *is* Framing |
| Fisheye de-warp / level | **Fully** (known lens) | ffmpeg `lenscorrection`/`v360`; DJI lens profile is known. Unknown cameras → manual angle (T5640) |
| Highlight selection | **Human / AI-assisted** | the core product loop — Annotate + existing player/ball detection |
| Conform crop from master | **Fully** | deterministic ffmpeg crop+encode on the chosen windows |

**Punchline:** everything except *which plays to keep* is automatable — and "which plays to keep"
is exactly what Annotate already exists to do. So the "Prepare" stage is mostly **auto-assemble +
auto-proxy + coarse auto-trim**, handing a small, clean proxy to the existing pipeline, with the
master reserved for conform.

---

## 8. Libraries & tooling (per step)

All of the detection stack below is **already installed in the backend venv and already used by the
app** for spotlight player-detection — nothing new to adopt for a prototype.

| Step | Library / tool | Notes |
|---|---|---|
| **Assemble** | ffmpeg **concat demuxer** (`-f concat -c copy`) | stream-copy, no re-encode; specs match. Python: `subprocess`/`ffmpeg-python`. Client: **ffmpeg.wasm** (`@ffmpeg/ffmpeg`) or **mp4box.js** + WebCodecs (mux without transcode) |
| **Proxy detect** | `ffprobe` (frame-count verify vs master) | detect sibling `.LRF`/`*_proxy.*` |
| **Proxy generate** | ffmpeg downscale → 720–1080p H.264 | one cheap transcode when no shipped proxy |
| **Intelligent trim — detect** | **Ultralytics YOLO** (`yolov8x.pt`, in repo; person=0, **sports-ball=32**) | ball detection is the strong play/no-play signal (see §9) |
| **Intelligent trim — track** | **deep-sort-realtime** (installed) / ByteTrack (`model.track`) / Norfair | ball trajectory + team formation over time |
| **Intelligent trim — motion** | OpenCV `calcOpticalFlowFarneback`, `createBackgroundSubtractorMOG2` | cheap, but weak alone (see §9) |
| **Intelligent trim — scene** | PySceneDetect (`scenedetect`) | minor for a fixed camera |
| **Intelligent crop — detect** | **Ultralytics YOLO** boxes → action centroid / ball | reuse app's `run_player_detection_for_highlights` |
| **Intelligent crop — reframe** | Google **AutoFlip** (MediaPipe) *or* roll-our-own (as prototyped) | virtual-cameraman window from boxes |
| **Intelligent crop — smoothing** | Kalman / **1€ filter** (+ Norfair/deep-sort for temporal ID) | stops the crop from jittering frame-to-frame |
| **Fisheye de-warp / level** | OpenCV `cv2.fisheye` undistort *or* ffmpeg `lenscorrection` / `v360` | DJI lens profile known; arbitrary tilt on top → T5640 |
| **Segmentation (optional)** | **SAM2** (`sam2.1_hiera_tiny.pt`, in repo) | if per-player masking ever needed |

---

## 9. Prototype results (ran on the real test files, 2026-07-20)

Environment: RTX 4060 (CUDA), ultralytics 8.3.228, torch 2.4.1+cu121, `yolov8x.pt`. OpenCV decodes
the `.LRF` proxy directly.

### Intelligent CROP — ✅ works well
- **2×2 tiled YOLO on the native 8K** detected **31–45 field players per frame** AND **the ball in
  every tested frame** (t=600/660/900 s of 0005).
- Ball-centered 16:9 auto-reframe produced sensible action windows; annotated proof:
  [`autocrop_600_annotated.jpg`](dji-study-assets/autocrop_600_annotated.jpg) (every player boxed,
  ball circled, crop window on the action cluster) + result crops `autocrop_{600,660,900}_result.jpg`.
- **Reliable ball detection is the headline** — it's the ideal signal for BOTH auto-reframe (crop
  follows the ball) and play-detection (trim). Needs a Kalman/1€ smoother for a non-jittery virtual
  camera path; the per-frame detection itself is solid.

### Intelligent TRIM — ⚠️ harder than it looks; needs the ball, not headcount
- **Naive person-count does NOT separate warm-up from game:** YOLO found **~20–23 people/frame in
  both** 0003 (warm-up) and 0005 (game) — a fixed wide field always has ~20 people (both teams +
  benches + sideline). Headcount is a non-signal here.
- **Global optical-flow is weak too:** field-band mean flow was only **1.30× higher** in game vs
  warm-up — not a clean threshold.
- **Conclusion:** intelligent trim must be driven by **ball-in-play + player-tracking/formation**
  (is there a game ball moving in the field of play, is it near this goal), not by headcount or
  global motion. The good news: the prototype shows the **ball is reliably detectable**, so the
  right signal is available — it just needs a tracker, not a pixel-motion threshold. Precise
  highlight timing then stays with Annotate (human/AI-in-loop), which is what the app already does.

**Compute feasibility:** YOLO ran ~0.16 s/frame on the 720p proxy (GPU). At 1 frame/2 s over the
full 68.5 min that's ~2000 inferences ≈ a few minutes — cheap enough to auto-scan on ingest.

---

## 10. Why SVC / AI-background-flatten are the wrong tools (confirmed by the data)

- **SVC** targets adaptive *delivery*, adds ~10–20% bitrate overhead, is poorly tooled for
  file-based trim/crop workflows, and gives lower-res *whole frames* when we want full-res
  *sub-regions* (that's ROI/tiling, not SVC).
- **AI background-flatten** is the highest-compute option and attacks the axis that the measured
  data shows *doesn't move the needle* (whole-frame size), while risking the exact content that
  matters (small, fast, motion-blurred ball). And the proxy already exists for free.

The 50–200× is sitting in *trim + proxy + conform*, which are deterministic, well-tooled, and
debuggable. Spend the AI budget on **highlight selection** (which the app already does), not on a
custom codec.

---

## 11. Open questions to validate next

- Browser ceiling for stream-copy trim/concat on multi-GB inputs (ffmpeg.wasm / WebCodecs) vs a
  desktop companion for the master.
- Cheap client-side proxy detection + frame-accuracy check for arbitrary cameras (not just DJI).
- Coarse dead-time auto-trim accuracy (field-band motion vs player detection) — false-negative
  cost is dropping a real play.
- Master retention policy: local vs resumable-upload vs discard — per footage type.

---

## 12. Assets (in [`dji-study-assets/`](dji-study-assets/))

- `sheet_0003.jpg … sheet_0006.jpg` — 1-frame/min contact sheets of each recording.
- `roi_on_full_frame.jpg` — full 8K frame (downscaled) with a 1920×1080 highlight ROI drawn.
- `roi_crop_native_1080.jpg` — that ROI at native 8K resolution (no upscale) — quality proof.
- `autocrop_{600,660,900}_annotated.jpg` — YOLO player+ball detection with the auto-reframe crop
  window drawn (intelligent-crop prototype proof).
- `autocrop_{600,660,900}_result.jpg` — the resulting auto-reframed crop.

*Large intermediate segments (30 s master copy, crop encodes) were measured then discarded; only
sizes are recorded above.*
