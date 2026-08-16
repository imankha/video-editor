# T7090: Intro cards silently drop on OOM — move download-time compose to Modal

**Status:** DONE — deployed 2026-08-16 prod. `compose_serve_time_modal` deployed to Modal same
day; verified working on staging (intro cards downloading correctly via Modal dispatch) before
promotion.
**Impact:** 8
**Complexity:** 7
**Created:** 2026-08-16
**Updated:** 2026-08-16

## Problem

Found live on staging 2026-08-15/16 while manually testing the T4947/T6240/T6760/T6360
promotion: a reel with a player intro card downloaded successfully (200 OK) but the intro
card was **missing** from the file, with zero error surfaced anywhere. Playback in-app showed
the intro correctly, which briefly looked like a two-sources-of-truth bug — it isn't. Both
paths read the same `final_videos.intro_card_id` column through the same resolver
(`resolve_intro_for_reel` / `resolve_intro_card_id`). Playback only presigns a URL to the card
image and renders it client-side; only the **download** path actually burns the card into
video via ffmpeg, and only the download path can fail this way.

**Root cause, confirmed by live staging log + reproduction on a matched Docker image**
(`python:3.11-slim` + ffmpeg 7.1.5, `--memory=1024m --cpuset-cpus=0`, matching
`fly.staging.toml`/`fly.production.toml` exactly — both are `cpu_kind=shared, cpus=1,
memory_mb=1024`):

The kernel OOM-killed the intro-card ffmpeg subprocess mid-render:
```
Out of memory: Killed process 887 (ffmpeg) total-vm:1304736kB, anon-rss:558776kB,
file-rss:128kB, shmem-rss:0kB, UID:0 pgtables:1660kB oom_score_adj:0
```
This happened on a **~20 second** reel — clip length is not the driver. `player_intro.py`'s
`_build_card` feeds ffmpeg one separate `-loop 1 -framerate F -t D -i <full-frame RGBA PNG>`
input **per visual layer** (background, photo/zoompan, tint, vignette, seam, scrim, band, plus
**one full-frame image per text element** — title/subtitle/each fact line all render as
full-frame PNGs via `text_render.py::render_text_layer`, even though the actual text occupies
a small fraction of the frame). Measured cost is ~150MB peak RSS per extra looped full-frame
input, independent of clip duration:

| Case | Peak RSS |
|---|---|
| bg input -> x264 only | 304 MB |
| + zoompan photo | 326 MB (+22) |
| + 1 extra looped full-frame input | 456 MB (+152) |
| + 5 looped *small* (1080x150) inputs | 538 MB (+47 each) |
| **Real card graph (8 inputs measured, 11 typical)** | **OOM-killed at 1,037-1,058 MB** |

A typical card (photo + title + subtitle + 3 facts = 11 inputs / 9 overlays) extrapolates to
**~1.7GB demanded on a 1GB box.** `-threads 1` / `-filter_complex_threads 1` /
`-thread_queue_size 1` were tested — no meaningful effect. This reproduces on **production's
identical 1GB machine**, not just staging — it is not a staging-under-provisioning issue.

**Ruled out:** the app's `torch`/`torchvision` import (visible in local-dev boot logs) is
**not** in the production image at all — `requirements.prod.txt:2`: "GPU processing is
handled by Modal - no torch/CUDA needed". Concurrency was also ruled out (log shows a single
in-flight download at the time of the kill).

**Compounding bug:** the SIGKILL (`returncode == -9`) is swallowed into a plain `False` by
`_get_or_build_card` (`player_intro.py`) and `_try_build_intro_card`
(`serve_time_video.py:30-41`) degrades to "no intro" exactly like any other card-build miss
(e.g. a genuinely absent card). `compose_serve_time` still returns `True`, so the download
ships a 200 with silently missing content. An infrastructure kill is indistinguishable from an
ordinary "this reel has no intro" case in the logs today.

## Solution

Three independent fixes, sequenced by what unblocks what. User has explicitly decided
direction on (1): **download-time compose must not run local ffmpeg on the Fly web machine at
all** — this is the exact pattern already decided for T7020's upload-time remux (Modal-dispatch
mirroring T4945's `stitch_members`, [T7020's design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c)
is a directly reusable comparison/reference for the tradeoffs below).

1. **Move the download-time compose pipeline to Modal.** Today `compose_serve_time`
   (`serve_time_video.py`) runs three stacked local ffmpeg passes synchronously inside the
   request handler across all three download egress points (`downloads.py::download_file`,
   `shares.py::download_shared_video`, `collections.py::download_collection`): intro card
   build + concat (T5210/T5220), branded outro append (T3950), and T6360's metadata/cover-art
   stamp. All of it should move off the Fly machine.
   **Real tradeoff the Architect must resolve, NOT present in T7020's case:** T7020's upload
   remux could be genuine fire-and-forget (the client doesn't wait for bytes back). A
   *download* fundamentally must return the video bytes to the browser — dispatching compose
   to Modal means the backend calls Modal and **waits** for the result before it can stream
   anything, trading OOM risk for added round-trip latency on every single download. Modal has
   far more headroom so it won't OOM, but the latency shape (synchronous call-and-wait vs.
   some poll/webhook pattern vs. Modal writing to R2 and the backend redirecting to a
   presigned URL) needs a real design pass, not an assumption.
2. **Fix the intro-card layer-compositing waste**, independent of where ffmpeg runs — a
   pathological card (many text facts) could still be wasteful on Modal:
   - Collapse the static PIL layers (`_render_tint`/`_render_vignette`/`_render_seam_fade`/
     `_render_scrim`/`_render_band` in `player_intro.py` already return PIL RGBA images) into
     ONE `alpha_composite`d "above-photo" image before handing to ffmpeg — 6 looped inputs
     become 2. Estimated savings: ~600MB.
   - Crop each text layer to its non-zero bounding box (`text_render.py::render_text_layer`)
     instead of returning a full-frame image, and overlay with an explicit `x=x0:y=y0` offset
     instead of `x=0:y=0` on a mostly-transparent full frame. ~152MB -> ~47MB per element.
3. **Stop swallowing SIGKILL into an ordinary card-build miss.** `_get_or_build_card` /
   `_try_build_intro_card` must distinguish `returncode == -9` (or any signal-terminated
   subprocess) from an ordinary failure, log it at CRITICAL (not the current silent path), and
   surface a degraded-download signal to the caller — mirrors the `report[full_fidelity]`
   out-dict pattern T4947/T6360 already established on `compose_serve_time` for exactly this
   kind of "shipped but degraded" case.

**Immediate stopgap available (not a fix, buys time):** bump `memory_mb` to 2048 in
`fly.staging.toml`/`fly.production.toml`. Doesn't address the underlying waste or the
Fly-vs-Modal architecture question — the Architect should decide whether to take this now
while (1)+(2) are designed/built, or skip straight to the Modal migration.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/services/player_intro.py` — `_build_card`, `_get_or_build_card`,
  `_render_tint`/`_render_vignette`/`_render_seam_fade`/`_render_scrim`/`_render_band` (all
  static PIL layers to collapse), the ffmpeg input/overlay graph construction
- `src/backend/app/services/text_render.py:125-126` — `render_text_layer`, returns full-frame
  images; needs bbox-cropped output + offset overlay instead
- `src/backend/app/services/serve_time_video.py` — `compose_serve_time`, `_try_build_intro_card`
  (`:30-41`, swallows failure to `None`), `_apply_metadata_hook` (T6360's stamping note)
- `src/backend/app/routers/downloads.py` — `download_file`, `_stamp_download` (T6360's
  post-compose pass, same file, same request lifecycle this task changes)
- `src/backend/app/routers/shares.py` — `download_shared_video`, `_stamp_shared_download`
- `src/backend/app/routers/collections.py` — `download_collection` (also interacts with the
  T4947 R2 cache — the cache stores UNSTAMPED bytes today; confirm a Modal-dispatched compose
  doesn't change that contract)
- `src/backend/app/services/download_metadata.py` — T6360's stamp pass, currently a THIRD
  local ffmpeg invocation stacked after intro+outro; decide whether it moves to Modal too or
  stays local (it's `-c copy`, much cheaper than the intro-card render — may not need to move)
- `src/backend/fly.staging.toml`, `src/backend/fly.production.toml` — both `memory_mb=1024`,
  identical spec (confirms this isn't staging-only)
- `src/backend/requirements.prod.txt:2` — confirms torch/CUDA is NOT in the prod image

### Related Tasks
- **Precedent, same pattern:** T7020 (faststart remux) — already user-decided to move from
  synchronous local ffmpeg to Modal-dispatch for the exact same reason (don't burden the Fly
  web machine with heavy ffmpeg work); its design artifact is a direct reference for comparing
  approaches, though T7020's upload case can be pure fire-and-forget where this download case
  cannot.
- **Shares the exact request lifecycle:** T6360 (download metadata/cover-art) — added the
  THIRD local ffmpeg pass on this same download path just before this bug was found; if compose
  moves to Modal, T6360's stamp pass needs an explicit decision (moves too, or stays local since
  it's cheap `-c copy`).
- **Cache contract to preserve:** T4947 (collection-download R2 cache) — caches UNSTAMPED
  compose output; a Modal-dispatched compose must not change what gets cached or when.
- Follows: T5210 (player intro card render engine — original source of the per-layer ffmpeg
  input pattern), T5215 (intro attachment), T6680 (removed the intro duration gate — confirmed
  irrelevant to this bug).

### Technical Notes
- Reproduction repro scripts exist at
  `C:\Users\imank\AppData\Local\Temp\claude\c--Users-imank-projects-video-editor\fccbed15-6f1f-41cc-b182-3534a173f10e\scratchpad\repro2.py`,
  `run3.sh`, `run4.sh` — session-scoped temp paths, may not persist; re-derive the repro
  methodology from the numbers above if they're gone (matched-memory Docker container, measure
  peak RSS per additional looped full-frame ffmpeg input).
- `.claude/knowledge/export-pipeline.md` has a stale reference to a "duration gate" in intro
  resolution (around the `is_default` note) — contradicts code (T6680 removed it); fix in the
  same commit as this task per CLAUDE.md's "docs are claims, code is truth" rule.
- Staging test account `e2e@test.local` is empty (no games/reels) — this bug can only be
  manually verified with a real account that has a published reel with an intro card attached.

## Implementation

### Steps
1. [ ] Architect: resolve the sync-latency-vs-OOM-risk tradeoff for Modal-dispatching download
       compose (call-and-wait vs poll vs R2-write-then-redirect); decide whether T6360's stamp
       pass moves too or stays local; decide stopgap (memory bump) now vs skip straight to Modal
2. [ ] Fix layer-compositing waste in `player_intro.py`/`text_render.py` (independent of #1,
       can land first as a smaller, lower-risk change)
3. [ ] Fix silent SIGKILL-swallowing in `_get_or_build_card`/`_try_build_intro_card` — CRITICAL
       log + degraded-download signal
4. [ ] Implement the Modal dispatch per the Architect's design
5. [ ] Update `.claude/knowledge/export-pipeline.md`'s stale duration-gate reference in the
       same commit

### Progress Log

**2026-08-16**: Root-caused via live staging log capture (kernel OOM-kill of the intro-card
ffmpeg process) + reproduction on a matched-memory Docker image. Ruled out clip length,
concurrency, and torch/baseline memory as causes; confirmed the cause is ffmpeg input-count
scaling in the intro-card layer graph (~150MB per extra looped full-frame input), reproducing
identically on staging and production's identical 1GB machines. User decided direction: move
download-time compose to Modal (matches T7020's precedent). Not yet designed or implemented.

## Acceptance Criteria
- [ ] A reel with an intro card downloads WITH the intro card, reliably, regardless of card
      complexity (many text facts) or reel length
- [ ] Download-time video compose no longer runs local ffmpeg on the Fly web machine (or, if
      the Architect decides otherwise for the T6360 stamp pass specifically, that decision is
      explicit and justified, not a leftover)
- [ ] An infrastructure-level render failure (OOM/SIGKILL or equivalent) is logged at CRITICAL
      and distinguishable from an ordinary "no intro configured" case
- [ ] The T4947 collection-download cache contract (caches unstamped bytes, stamps per-request)
      is preserved or deliberately revised, not silently broken
- [ ] Tests pass; a regression test proves the old per-layer-full-frame-input pattern would
      have failed (counterfactual) if layer-compositing is fixed as part of this task
