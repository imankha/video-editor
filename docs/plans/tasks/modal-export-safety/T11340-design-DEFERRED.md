# T11340 — Parallelize SINGLE-CLIP Export Across GPUs (time-chunking) — Design

**Status:** BLOCKED — awaiting user approval of the REVISED (Revision 2) design below.
**Tier:** L (new pattern in a production GPU pipeline, real cost/latency tradeoffs, Modal redeploy).
**Task file:** `docs/plans/tasks/modal-export-safety/T11340-modal-multiclip-parallel-chunking.md`
**Knowledge docs:** `.claude/knowledge/modal-gpu.md`, `docs/plans/tasks/single-clip-editor/EPIC.md`

> **REVISION 2 (AUTHORITATIVE, 2026-09-26) supersedes Revision 1.** The product is removing
> multi-clip export entirely (single-clip-editor epic, T11250 deletes the export N>1 branches;
> "one project = one clip = one highlight"). Revision 1's design parallelized *N clips across K
> workers by bin-packing* — it targets code scheduled for deletion, so it is **discarded**.
> Revision 2 parallelizes **ONE long clip via TIME-based chunking**, which is safe regardless of
> when the multi-clip-removal epic lands because it targets the SURVIVING single-clip path.
> Revision 1 is preserved verbatim at the bottom under "Revision 1 — SUPERSEDED" for the record
> (this file is untracked, so git has no copy).

---

# Revision 2 — Single-clip time-chunking (AUTHORITATIVE)

## R2.1 Scope & framing

Parallelize the export of **one clip** by splitting its frame range into up to 8 time segments,
one T4 worker per segment, then concatenating the segments in order. This lives in the **export
path** (`process_clips_ai`, `video_processing.py:2789`) — the path used by single-clip `/render`
(and, until T11250, multi-clip). It does **not** touch, and does not depend on, the N>1 branches
the single-clip-editor epic deletes.

**Why this is the right target now.** `process_clips_ai` has *no chunking at all* today —
sequential at any clip count, one T4, hard `timeout=3600`. The framing-only path already solved
time-chunking (`process_framing_ai_parallel`/`_chunk`) but per `modal-gpu.md` that is **not** the
export path. So the job is: **port `process_framing_ai_chunk`'s time-chunk mechanics into the
export path, carrying `process_clips_ai`'s full per-clip feature set** (keyframe crop OR
smart-center-crop, rotation, the T8280 down-sample cadence gate, audio, and — the hard part —
`segment_data`/speed changes, which `process_framing_ai_chunk` deliberately does NOT support).

## R2.2 Chunking mechanics (by-time, one clip)

Today the export per-clip body derives, in scratch-relative space (scratch frame 0 == the clip's
`source_start`): trim window `[trim_start_rel, trim_end_rel]` → `start_frame..end_frame` at
`original_fps`, then GAN-upscales `[start_frame, end_frame)` on the target-fps cadence grid
(T8280), encoding one MP4 with audio + speed.

Time-chunked variant:

1. **Orchestrator** (`process_export_ai_parallel`, new `@app.function(gpu=None, timeout=3600)`
   generator — the export analog of `process_framing_ai_parallel`): probe source fps/duration,
   resolve the clip's trim window → global `start_frame..end_frame`, compute `K` (§R2.4), split
   the frame range into K contiguous segments
   `seg_i = [start_frame + i*span, start_frame + (i+1)*span)` where
   `span = ceil((end_frame - start_frame) / K)` (last segment absorbs the remainder).
2. **Worker** (`process_export_ai_chunk`, new `@app.function(gpu="T4", timeout=3600)`): given its
   segment's source-absolute time range, scratch-extracts only those bytes from R2 (presigned URL
   + pre-input `-ss/-to -c copy`, exactly like `process_framing_ai_chunk`), decodes, and for each
   frame maps its local index back to a **clip-relative time** to interpolate the crop
   (`source_time - source_start_time`, the mapping `process_framing_ai_chunk` already does),
   applies rotation, GAN-upscales, writes PNGs at crf 18, uploads a **video-only** chunk to an
   **index-named** key `temp_export_chunks/{job_id}/chunk_{i}.mp4`, returns
   `{status, chunk_index, output_chunk_key, frames}`.
3. **Orchestrator finalize**: collect all worker results, **sort by `chunk_index`**, download in
   order, stream-copy concat (the framing-parallel path's proven step), then **remux the clip's
   audio** once over the whole concatenated video (range-extract the clip's audio from source like
   `process_framing_ai_parallel:2548`), upload to `output_key`, delete `temp_export_chunks/`.

**Reuse discipline (avoid a 5th crop-math copy — `modal-gpu.md` landmine E4).** Extract
`process_clips_ai`'s per-**frame** body (crop/smart-center-crop → rotate → GAN → cadence-gate →
PNG) into a shared helper used by BOTH the sequential loop and the new chunk worker. This is the
strangler-fig discipline from Revision 1, now at frame-range granularity instead of clip
granularity, and it's what makes the concat byte-identity criterion cheaply achievable.

## R2.3 T8280 cadence-grid continuity across seams (the central correctness risk)

The cadence gate emits source frame `i` iff `int(i*target_fps/original_fps) >
int((i-1)*target_fps/original_fps)`, where `i = frame_num_rel` is **0-based within the clip's
trim window**. If each worker restarts `frame_num_rel` at 0 relative to *its own* segment start,
the grid resets at every seam → the emitted-frame pattern diverges from the sequential path at
boundaries → **dropped or duplicated frames at seams, A/V drift, and non-byte-identical output.**

**Design requirement:** each worker computes `frame_num_rel` relative to the **clip's global trim
start**, i.e. `frame_num_rel = (segment_start_frame - start_frame) + local_idx`, and seeds
`last_emitted_grid_idx` to the grid index of the frame *just before* its first frame. Then the
global cadence is reproduced seamlessly and the union of workers' emitted frames == the sequential
path's emitted frames, frame-for-frame. This is the subtlest point in the design and gets a
dedicated test (emitted-frame set: sequential vs K-chunked, must be identical). (Alternative —
snap segment boundaries onto grid points — is also correct but needs boundary math; the
global-index approach needs none, so it's recommended.)

## R2.4 GPU-count formula (per single clip)

Reuse T11320's `estimate_export_cost` for the ONE clip → its `estimated_gpu_seconds`. Then:

```
PER_WORKER_BUDGET = 2880          # user-confirmed (Q2): 80% of the 3600s worker timeout
MAX_WORKERS       = 8             # user-confirmed (Q1), applied PER CLIP now
K = min(MAX_WORKERS, max(1, ceil(estimated_gpu_seconds / PER_WORKER_BUDGET)))
```

- `K == 1` → **sequential `process_clips_ai`, unchanged & byte-identical to today** (short clips).
- `K > 1` → the new orchestrator; each worker's wall-clock ≈ `estimated/K` ≤ 2880 by construction.
- Illustration: a full-frame 1920×1080 input crop costs ~2.72 GPU-s/frame; the max chunkable clip
  at K=8 is `8×2880 / 2.72 ≈ 8470 frames ≈ 282s` (~4.7 min) — well past any realistic highlight.
- **A single source of truth** `plan_export_chunks(clip, fps) -> K` is used by BOTH the router and
  the orchestrator, so they never disagree about how many workers a clip gets.

## R2.5 Concat-ordering guarantee

Identical principle to Revision 1, now on **chunk-index** instead of clip-index: index-named keys
`temp_export_chunks/{job_id}/chunk_{i}.mp4`; `.starmap` returns in input order (already relied on
at `video_processing.py:2487`); the orchestrator flattens all results and **sorts by
`chunk_index`** before writing the concat list — never append-as-you-go; any chunk with `status !=
success` aborts the whole export loudly (mirrors `failed_chunks`, `:2507`). Concat is stream-copy
(the chunks are already crf-18 encoded), matching the framing-parallel path; audio is remuxed once
afterward. Frame-accurate seams rely on stream-copy of crf-18 chunks — proven by
`process_framing_ai_parallel`, but re-verified here with the export feature set + trailing audio
remux (Risk R7).

## R2.6 Speed-segment handling (addressed head-on — now central, not an edge case)

`process_clips_ai` builds ONE filtergraph over the whole clip's emitted PNGs + the whole scratch
audio: per segment `[seg.start, seg.end]` (clip-relative, trim-offset) it `trim`/`setpts` the
video and `atrim`/`atempo` the audio, then `concat`s the segments (`video_processing.py:3136–3221`).
This graph **spans the entire clip** and assumes all emitted frames live in one PNG sequence and
the audio is one input. Time-chunking breaks all three assumptions (frames split across K MP4s;
segment boundaries don't align with chunk boundaries; `atempo`/`setpts` need contiguous ranges).

Two options, presented for decision:

- **Option A — recommended for v1: a clip WITH speed changes stays on the sequential (unchunked)
  path.** `plan_export_chunks` returns `K=1` whenever `has_speed_changes` is true, so speed clips
  run today's proven `process_clips_ai`. Rationale: correctness-first; speed segments are exactly
  where naive time-splitting corrupts output; and the framing-parallel path *already* refuses
  `segment_data` (`num_chunks>1 and segment_data is None`, `modal_client.py:765`) — so this is a
  consistent, already-proven restriction, not new under-handling. **Known limitation:** a long,
  heavily-slowed clip can't be parallelized and could still hit the guard ceiling (§R2.7) — stated
  plainly, not hidden. This is Open Question Q1.
- **Option B — deferred follow-up: parallelize only the GAN phase, apply speed whole.** The GAN
  (the expensive part) is **speed-agnostic** — speed is applied *after* the GAN via `setpts`/`atempo`
  (T11320's own docstring: "slow-mo/speed segments apply AFTER the GAN and add no GAN frames"). So
  workers could produce the full upscaled PNG set (or native-cadence sub-clips) in parallel, and a
  final single container runs the whole-clip speed filtergraph + audio over the reassembled frames.
  This keeps the whole-clip filtergraph intact while still parallelizing the costly work, at the
  price of a heavier finalize pass and workers that emit frames rather than finished sub-clips.
  Recommended only if Option A's limitation proves painful in practice.

## R2.7 T11320 guard interaction (re-derived for single-clip time-chunking)

Today the guard rejects when the clip's `estimated_gpu_seconds > 2880` (single-GPU wall clock).
After chunking, a **chunkable** clip can use up to 8 workers, so its ceiling rises — but a
**non-chunkable** clip's ceiling must stay at 2880, or the guard will accept a clip the dispatcher
then runs sequentially for the full hour and kills. So the guard must share the router's
chunk-decision:

```
K            = plan_export_chunks(clip, fps)      # single source of truth, also used by the router
ceiling      = K * PER_WORKER_BUDGET              # == 2880 when K==1 (speed/no-keyframe), up to 23040 when chunkable
feasible     = estimated_gpu_seconds <= ceiling   # reject otherwise, same structured payload
```

Because K already caps at 8 and returns 1 for speed-changed / no-keyframe clips, `ceiling`
automatically degrades to today's 2880 exactly when parallelism is unavailable, and rises to
`8×2880 = 23040` exactly when it is. The structured rejection (`to_error_detail`,
`biggest_contributors`) is unchanged — with one clip it names that clip. This is a **guard-logic
change (chunk-aware ceiling), not just a constant bump** — the key difference from Revision 1.
The guard already loops over a clip list, so a one-element list (the post-T11250 steady state) is
fine; T11340's guard change is written independent of whether multi-clip code still exists (Q5).

## R2.8 Cost-measurement plan (verify on staging, don't assert)

**Hypothesis (to prove):** each frame is GAN-upscaled exactly once whether sequential or chunked
(no redundant work — unlike E7's 3–4× overlay result), so total billed GPU-seconds ≈ **1× +
overhead**, where overhead = `(K−1)` extra Real-ESRGAN model loads + `K` container cold-starts + K
scratch-extracts (minor re-decode of overlapping GOP bytes at seams). Wall-clock drops ~`K×`.

**Method (staging, Modal on — off in /dotask per T4180, so this is a post-impl gate):**
1. Deploy branch to the **staging** Modal app.
2. Fixture A — one **long single clip** (~90–120s at a real crop) that the **sequential** path
   *can* finish under 3600s (unlike Bug 58p, we pick a clip both paths complete). Run K=1 vs K=4;
   record **summed billed GPU-seconds** (Modal dashboard/logs) + wall-clock. Ratio =
   real overhead multiplier.
3. **Seam integrity** (time-chunk-specific): ffprobe the chunked output's duration + frame count
   vs the sequential output — must match exactly (proves no dropped/dup frame at seams, no A/V
   drift); spot-check the boundary frames for no flash/repeat.
4. Fixture B — a **non-30fps** upload, to exercise the T8280 cadence gate *across seams* (§R2.3).
5. **Report to user**: Δ billed GPU-seconds, wall-clock speedup, cost-per-export before/after, and
   seam-integrity result. **Present the tradeoff for go/no-go before prod** — never ship on the
   assumption it's free (acceptance criterion "cost measured, not assumed").

## R2.9 Deploy plan

Editing `video_processing.py` requires a manual, per-environment Modal deploy (T8270; backend
CLAUDE.md), offered to the user — **no deploy without explicit approval, after implementation +
review**: `deploy.py` → **staging** → verify (Fixtures A/B + seam check + Bug-58p-style long-clip
repro + non-30fps ffprobe) → **report cost** → user go/no-go → `deploy.py --prod`. Then update
`modal-gpu.md` (function table: new `process_export_ai_chunk` + `process_export_ai_parallel` rows
with GPU/timeout; GPU-selection section; the time-chunk-vs-E7-overlay cost distinction). This is a
**separate redeploy** from the single-clip-editor epic (its R10 deliberately avoided a redeploy;
T11340 owns its own).

## R2.10 Implementation plan (for the later Stage-4 gate — NOT executed now)

1. **Extract** the per-frame body of `process_clips_ai` into a shared helper (mechanical commit +
   characterization test: sequential output byte-identical pre/post extract).
2. **Add** `process_export_ai_chunk` (carries smart-center-crop, rotation, T8280 global-index
   cadence, keyframe interpolation via the shared helper; video-only, crf 18, index-named upload).
3. **Add** `process_export_ai_parallel` (orchestrator: probe, `plan_export_chunks`, `.starmap`,
   sort-by-index, concat, audio remux, cleanup, `modal_call_id` as first stream item).
4. **Add** `plan_export_chunks` + route in `call_modal_clips_ai` on K (K==1 → today's path).
5. **Change** the guard to a chunk-aware ceiling (§R2.7); update its tests.
6. **Tester** (Stage 3): failing tests first — (a) emitted-frame set identical sequential vs
   K-chunked (T8280 seam continuity), (b) concat order deterministic under simulated out-of-order
   chunk completion, (c) K formula (short→1, long→ceil, cap 8, speed→1, no-keyframe→1),
   (d) guard accept/reject at the chunk-aware ceiling, (e) `modal_call_id` first-yield preserved.
7. **Reviewer** (Stage 4.5); then the staging cost + seam gate (§R2.8); then deploy.

## R2.11 Risks

- **R1 — T8280 seam cadence continuity** (§R2.3): grid reset at chunk boundaries would drop/dup
  frames. Mitigated by global-frame-index in the worker + a dedicated emitted-frame-set test. The
  single subtlest correctness risk.
- **R2 — Byte-identity across containers** (GAN determinism on T4). Same code + same concat maximize
  it; fallback to SSIM≈1.0 + identical frame-count/order with user sign-off (Q3).
- **R3 — Speed-segment clips can't parallelize** under Option A (§R2.6) — known limitation (Q1).
- **R4 — No-keyframe (smart-center-crop) clips** are excluded from T11320's estimate, so K=1 and
  they stay sequential — safe (no worse than today) but not parallelized (Q2).
- **R5 — Recovery:** orchestrator must emit `modal.current_function_call_id()` as its first stream
  item, or R2-first + `get_call_graph` recovery breaks for chunked jobs. Reuse the identical
  first-yield contract; explicit test.
- **R6 — Temp-chunk cleanup on failure** must delete `temp_export_chunks/{job_id}/` even on abort
  (mirror the framing-parallel cleanup) — no leaked chunk MP4s.
- **R7 — Stream-copy concat of crf-18 chunks** + trailing audio remux: GOP/keyframe alignment at
  seams. Proven for the framing path; re-verify with the export feature set (§R2.8 step 3).
- **R8 — Progress granularity:** `.starmap` blocks, so progress becomes per-chunk ticks, not
  per-frame (same as the framing-parallel path). Acceptable; mitigate by yielding as results arrive.
- **R9 — Crop-math duplication** (E4 landmine) — mitigated by the shared frame-range helper (R2.2).
- **R10 — Guard/dispatcher ceiling agreement** — single `plan_export_chunks` source of truth (§R2.7).

## R2.12 Open questions (need the user's judgment)

- **Q1 — Speed clips (R2.6):** is Option A (speed-changed clips stay sequential, not parallelized)
  acceptable for v1, or must Option B (parallelize GAN, apply speed in a final pass) ship first?
- **Q2 — No-keyframe clips (R4):** accept that a long smart-center-crop clip stays sequential
  (K=1, guard can't size it), or add a source-dims probe so K can be sized for it?
- **Q3 — Acceptance bar (R1/R2):** byte-identical output vs SSIM≈1.0 + identical frame-count/order,
  if cross-container GAN output isn't bit-exact.
- **Q4 — Confirm (already answered):** `PER_WORKER_BUDGET=2880`, `MAX_WORKERS=8` applied **per
  clip** (up to 8 time-chunks for one clip). Restated for the record.
- **Q5 — Sequencing with T11250:** T11340's guard/dispatch changes are written on the surviving
  single-clip path and independent of whether multi-clip code still exists — confirm there's no
  ordering constraint (either task may land first).
- **Q6 — Path convergence (optional simplification):** post-multi-clip-removal, the two single-clip
  Modal paths (`call_modal_framing_ai` recovery seam vs `call_modal_clips_ai` export) could
  converge onto one time-chunked implementation. v1 keeps a dedicated export worker/orchestrator to
  avoid destabilizing the framing recovery seam; flag convergence for the architect review.

---

# Revision 1 — SUPERSEDED (bin-packing multiple clips)

> **Discarded 2026-09-26.** This design parallelized N clips across K workers by cost-aware
> bin-packing. The product is removing multi-clip export (single-clip-editor epic / T11250), so
> this targets code scheduled for deletion. Kept verbatim below only for the historical record;
> **do not implement.** See Revision 2 above for the authoritative design.

## 1. Current State

### The path being changed
Every Focus export — single-clip `/render` (one-element list) and multi-clip alike — reaches:

```
_export_clips (routers/export/multi_clip.py:1342)
  └─ enforce_export_budget(clips_data, target_fps)      # T11320 preflight guard (:1406)
  └─ call_modal_clips_ai (modal_client.py:925)
       └─ process_clips_ai.remote_gen (video_processing.py:2789)   # ONE T4, timeout=3600
```

`process_clips_ai` is a generator on **exactly 1 T4 GPU** with a hard `timeout=3600`, regardless
of clip count or total footage. It:

1. Loads the Real-ESRGAN model **once** (`_get_realesrgan_model`, `:2894`).
2. Iterates clips **sequentially** (`:2912`). Per clip the body (`:2912–3241`) does everything:
   scratch-extract the clip's sub-range from R2 (presigned URL + pre-input `-ss/-to -c copy`),
   decode, per-frame interpolated crop (or smart-center-crop when a clip has **no keyframes**,
   `:3034`), GAN upscale (`_upscale_crop`), the T8280 down-sample cadence gate
   (`_should_emit_downsampled_frame`), per-clip encode with audio + **speed/`segment_data`**
   handling + **rotation** (`_build_simple_ffmpeg_cmd` / `_build_speed_change_ffmpeg_cmd`),
   producing one `clip_{i}.mp4` in `processed_paths`.
3. **PHASE 4** concats `processed_paths` in list order — stream-copy for `cut`, re-encode for
   other transitions (`:3243–3298`).
4. **PHASE 5** uploads the final MP4 to `output_key` (`:3300`).
5. Emits `modal_call_id` (`modal.current_function_call_id()`) as its **first stream item** — the
   sole recovery handle for `remote_gen` calls (T7210/T10360; recovery is R2-object-first,
   `get_call_graph` second).

There is **no scaling with workload.** Bug 58p (14 clips at full 1920×1080) ran the full hour
four times and died with `TIMEOUT`.

### The proven pattern this task adapts (single-clip framing)
```
call_modal_framing_ai (modal_client.py:632)   # NOTE: NOT the export path (T11210); reference only
  └─ get_framing_ai_gpu_config(duration) -> num_chunks  # <3s:1, <10s:2, else:4  (modal_client.py:447)
  └─ if num_chunks>1 and segment_data is None:
       process_framing_ai_parallel.remote_gen (video_processing.py:2362)   # CPU orchestrator, timeout=3600
         └─ process_framing_ai_chunk.starmap([...])   (video_processing.py:2166)  # T4 each, timeout=900
```

Load-bearing facts I verified in `process_framing_ai_parallel`:

- **It chunks ONE clip by TIME** (`chunk_duration = clip_duration / num_chunks`, `:2453`). Each
  chunk worker scratch-extracts only its `[c_start, c_end]` range.
- **Ordering is already deterministic and NOT append-as-you-go.** Chunk output keys are
  **index-named** (`temp_chunks/{job_id}_chunk{i}.mp4`, `:2461`), `.starmap` returns results in
  **input order** (Modal default), and the concat list is rebuilt by iterating `chunk_keys` in
  index order (`:2520`) — completion order is irrelevant. This is exactly the guarantee T11340
  needs; I adopt it verbatim.
- **It deliberately does NOT support `segment_data`/speed changes** — the router only takes this
  branch when `segment_data is None` (`modal_client.py:765`). Time-splitting a clip that has
  speed segments is unsound (the `setpts`/`atempo` filtergraph spans the whole clip).
- Chunk workers encode at **crf 18** (intermediate quality); the final concat is stream-copy.
- The orchestrator cleans up `temp_chunks/` from R2 after concat (`:2606`).

### `get_framing_ai_gpu_config` (the GPU-count selector)
`FRAMING_AI_GPU_THRESHOLDS = {3:(1,...), 10:(2,...), inf:(4,...)}` keyed on a **single clip's
duration**. Duplicated byte-for-byte at `modal_client.py:447` and `video_processing.py:171`. It
has **no multi-clip equivalent** — that is what this task must add.

### T11320 preflight guard (the ceiling this task raises)
`export_cost_guard.py` estimates GPU-seconds per clip and rejects when the total exceeds
`GPU_SECONDS_BUDGET = 0.80 × 3600 = 2880` — i.e. it assumes the **single-GPU wall-clock == total
GPU-seconds** model that is true today. `estimate_export_cost(clips, fps)` already returns a
per-clip `estimated_gpu_seconds` breakdown (`ClipCostEstimate`). **This is the "how much work is
this" metric the kickoff wants me to reuse — not invent a second one.**

### `video_processing_optimized.py` — checked, nothing to reuse
Its 8 variants are `process_framing_ai_t4/l4_{baseline,cudnn,compiled,optimized}` — all
**single-clip per-frame throughput** experiments (model-load and CUDA-graph tuning). **None
explores multi-clip fan-out or chunk reassembly.** Relevant only as a *future per-GPU speedup*
(T4420 territory), orthogonal to this task's *across-GPU* parallelism. Designing the fan-out from
`process_framing_ai_parallel` is correct; there is no closer prior art.

---

## 2. Target State

### Chunking strategy: **by-clip, cost-aware bin-packing** (primary). By-time is explicitly deferred.

Multi-clip export already has natural chunk boundaries — the clips — so **chunk by clip**, not by
time. Bug 58p is a *multi-clip* problem: 14 clips, each individually finishable, that only bust
the budget when summed on one GPU. One worker per clip (each ~1224 GPU-s for a 15s full-1080p
clip, well under the 3600 per-worker timeout) solves it directly.

But "one worker per clip" is wasteful when clips are tiny (14 GPUs for 14 one-second clips) and
insufficient framing when a few clips are huge. So the unit of work is a **bin**: pack clips into
the fewest bins such that each bin's summed `estimated_gpu_seconds` (straight from T11320's
`estimate_export_cost`) stays under a per-worker budget. Each bin → one T4 worker that runs the
**existing per-clip loop** over its clips sequentially. This:

- degenerates to **one worker** when every clip is small → routes to today's proven
  `process_clips_ai`, **byte-identical to current behavior, zero risk for the common export**;
- degenerates to **one worker per clip** when every clip is heavy (Bug 58p);
- reuses T11320's cost estimate as the packing weight (no second cost metric);
- bounds every worker's wall-clock under the timeout by construction.

**By-time sub-chunking of a single long clip is deliberately OUT OF SCOPE for v1** (open
question Q3). It is only needed when *one* clip alone exceeds the per-worker budget — a case
T11320 still (correctly) rejects — and it collides with the speed-segment restriction the
existing parallel path already imposes. v1 raises the **multi-clip** ceiling; a follow-up can
raise the **single-clip** ceiling with time-chunking if real usage demands it.

### Structure (strangler-fig — extract, don't reimplement)

The concat-byte-identity acceptance criterion is only cheaply achievable if the parallel path
runs the **same code** per clip. So:

1. **Extract** `process_clips_ai`'s per-clip body (`:2912–3241`) into a module-level helper
   `_process_one_clip(...) -> {clip_index, output_clip_key|local_path, frames}` — pure code
   motion, behavior-preserving (Refactoring Rule 3: moves are mechanical commits).
   `process_clips_ai` (sequential) keeps calling it in a loop → its output is unchanged.
2. **New GPU worker** `process_clip_ai_chunk` (`@app.function(gpu="T4", timeout=3600)`): takes a
   **bin** (list of clip specs + their source keys), loads the model once, runs
   `_process_one_clip` over its clips, uploads each encoded per-clip MP4 to an **index-named**
   temp key `temp_clip_chunks/{job_id}/clip_{global_clip_index}.mp4`, returns the list of
   `{clip_index, key, frames}`. It must carry the FULL per-clip feature set (keyframes OR
   smart-center-crop, `segment_data`/speed, rotation, audio, T8280 cadence) — which it gets for
   free by calling the extracted `_process_one_clip`. (This is why we extract rather than reuse
   `process_framing_ai_chunk`, which lacks speed/rotation/smart-crop.)
3. **New CPU orchestrator** `process_clips_ai_parallel` (`@app.function(gpu=None, timeout=3600)`,
   generator): emits `modal_call_id` first (recovery contract preserved), bin-packs, dispatches
   `process_clip_ai_chunk.starmap(bins)`, collects every `{clip_index, key}` across all bins,
   **sorts by `clip_index`**, downloads in that order, then runs the **identical PHASE 4 concat +
   PHASE 5 upload** block as `process_clips_ai` (factor that tail into a shared
   `_concat_and_upload(...)` so both paths share it), and cleans up `temp_clip_chunks/`.
4. **Route** in `call_modal_clips_ai` (`modal_client.py:925`): compute the bin count `K` from
   `estimate_export_cost`. `K == 1` → existing `process_clips_ai` (unchanged path). `K > 1` →
   `process_clips_ai_parallel`. Both are consumed by the identical `remote_gen` streaming/retry
   loop already there; both emit `modal_call_id` identically, so **recovery, retry, and the
   `connection_lost` contract are untouched.**
5. **Raise the T11320 guard ceiling** (see §5) — the one guard change, additive.

```mermaid
graph TD
  A[_export_clips] --> B[enforce_export_budget (raised ceiling)]
  B --> C[call_modal_clips_ai: K = bin_count(estimate_export_cost)]
  C -->|K==1| D[process_clips_ai  (today, unchanged)]
  C -->|K>1| E[process_clips_ai_parallel  CPU orchestrator]
  E --> F[bin-pack clips by estimated_gpu_seconds]
  F --> G[process_clip_ai_chunk.starmap  T4 x K]
  G --> H[collect keys, SORT by clip_index]
  H --> I[_concat_and_upload  (shared with D)]
```

---

## 3. Concat-Ordering Guarantee

Identical mechanism to the proven `process_framing_ai_parallel`, strengthened by an explicit sort:

1. Every per-clip output is written to an **index-named** R2 key carrying its **global**
   `clip_index`: `temp_clip_chunks/{job_id}/clip_{clip_index}.mp4`. The index is assigned from
   the clip's position in the original `clips_data` (respecting the existing `clipIndex`
   mapping), **before** dispatch.
2. `.starmap` returns bin results in **input order** (Modal default, already relied on at
   `video_processing.py:2487`). Defense-in-depth: we do **not** trust that alone — we flatten all
   returned `{clip_index, key}` records and **sort by `clip_index`** before building the concat
   list. Completion order is therefore irrelevant even if a worker retries or reorders.
3. The concat list is written strictly in sorted `clip_index` order; concat is the **same**
   stream-copy (`cut`) / re-encode (transition) command as today. **No append-as-you-go.**
4. Any bin/clip returning `status != success` fails the whole export loudly (same as
   `process_framing_ai_parallel`'s `failed_chunks` check, `:2507`) — no partial concat.

This satisfies the acceptance criterion "byte-identical in clip order for a fixture with
overlapping completion times" **provided** the GAN output is deterministic across containers (all
T4). See Risk R1 for the byte-identity caveat and its fallback verification.

---

## 4. GPU-Config Selection for Multi-Clip (the formula)

Reuse T11320's per-clip estimate as the packing weight. Greedy first-fit-decreasing bin-pack:

```python
# PER_WORKER_BUDGET = GPU_SECONDS_BUDGET (2880)  -- same 80%-of-timeout headroom, per worker.
# MAX_WORKERS = 8   <-- OPEN QUESTION Q1 (cost/quota ceiling; 8 => up to ~8x today's ceiling).

def plan_bins(clips, target_fps):
    est = estimate_export_cost(clips, target_fps)          # T11320, already exists
    per_clip = sorted(est.per_clip, key=lambda c: c.estimated_gpu_seconds, reverse=True)
    bins = []                                               # each: {seconds, clip_indices}
    for c in per_clip:
        placed = next((b for b in bins
                       if b.seconds + c.estimated_gpu_seconds <= PER_WORKER_BUDGET), None)
        if placed: placed.add(c)
        elif len(bins) < MAX_WORKERS: bins.append(Bin(c))
        else: min(bins, key=lambda b: b.seconds).add(c)    # overflow: least-full bin
    return bins                                            # K = len(bins)
```

- `K == 1` (all clips fit one bin) → **sequential path, unchanged**. Small exports never touch
  new code.
- `K == num_clips` when every clip alone nears the budget (Bug 58p).
- A clip **excluded** from the estimate (no-keyframe smart-center-crop — T11320's documented
  gap, `estimate_export_cost` skips it with a WARNING) is packed with a **conservative nominal
  weight** (e.g. treat as `PER_WORKER_BUDGET`-heavy → its own bin) so a no-crop batch still
  parallelizes rather than silently collapsing to one worker. Flag as Q4.

This is total-footage- **and** clip-count-informed (both flow through `estimated_gpu_seconds`),
exactly as the kickoff asked, without a second cost model.

---

## 5. Interaction with the T11320 Guard (additive, not a rewrite)

Today: reject if `total_gpu_seconds > 2880` (one-GPU wall clock). After parallelization the real
limit is **per-worker** wall-clock, so the guard's *budget* rises while its *mechanism, formula,
anchor, and rejection payload stay byte-identical*:

- **New effective budget** `= MAX_WORKERS × PER_WORKER_BUDGET` (e.g. `8 × 2880 = 23040` GPU-s).
- **Still reject** an export whose `K` would exceed `MAX_WORKERS` **or** that contains a **single
  clip** whose `estimated_gpu_seconds > PER_WORKER_BUDGET` (the un-splittable case v1 does not
  handle — by-time is deferred). The structured `to_error_detail()` payload and its
  `biggest_contributors` still name the offending clip, so T11330's popup keeps working
  unchanged.

This is the "pure capacity increase on top of an existing guard" the kickoff describes: one
constant (`GPU_SECONDS_BUDGET` → a workers-aware ceiling) plus one extra single-clip check. Bug
58p (~17000 GPU-s, needs `ceil(17000/2880) = 6` workers ≤ 8) now **passes** and finishes; a
genuinely infeasible export is still rejected with the same UX.

---

## 6. Cost Impact — Measurement Plan (not an assumption)

**Hypothesis (to be proven, not asserted):** unlike E7's overlay experiment (3–4× costlier
because chunks re-rendered overlapping/whole-video work), by-clip fan-out does **no redundant
frame work** — each clip's frames are GAN-upscaled exactly once whether sequential or parallel.
So total billed GPU-seconds should be **~1× + overhead**, where overhead =
`(K − 1)` extra Real-ESRGAN model loads + `K` container cold-starts (the CPU orchestrator adds a
small always-on CPU-second cost). Wall-clock drops ~`K×`. **This must be measured before prod.**

**Measurement method (staging, Modal on):**
1. Deploy the branch to the **staging** Modal app.
2. Fixture A — a **4-clip** export that BOTH paths can finish inside 3600s. Run it twice:
   forced `K=1` (sequential `process_clips_ai`) vs `K=4` (parallel). Record **summed billed
   GPU-seconds** (Modal dashboard / function logs) and wall-clock for each. The ratio
   `parallel_gpu_s / sequential_gpu_s` is the real per-worker overhead multiplier.
   > Note: the Bug-58p 14-clip shape can't be measured "sequential" — it can't finish. That is
   > why overhead is derived on a smaller fixture that both paths complete, then applied.
3. Fixture B — **Bug 58p's actual 14-clip full-1080p shape**: confirm it now completes under
   timeout in parallel, and record its billed GPU-seconds + wall-clock (parallel-only).
4. Fixture C — a **non-30fps** upload (exercise the T8280 cadence gate through the new worker).
5. **Report to the user**: `Δ` billed GPU-seconds (the overhead multiplier), wall-clock speedup,
   and cost-per-export before/after. **Present the tradeoff for approval** — do not ship on the
   assumption it's free. Acceptance criterion "cost measured, not assumed" is this step.

Modal is OFF in the /dotask container (T4180), so this is a **post-implementation staging gate**,
not something provable now — same class as T8280/T11320's calibration gates.

---

## 7. Deploy Plan

Editing `app/modal_functions/video_processing.py` requires a **manual, per-environment Modal
deploy** (T8270; backend CLAUDE.md). Rollout, offered to the user — **no deploy happens without
explicit approval, and only after implementation + review**:

1. `deploy.py` → **staging** (`reel-ballers-video-v2-staging`).
2. Verify on staging: Fixtures A/B/C above; ffprobe the outputs; the standard Bug-58p repro +
   non-30fps recipe from `modal-gpu.md` Invariant 3.
3. Report cost numbers → **user go/no-go**.
4. `deploy.py --prod` only after staging verification + user approval.
5. Update `.claude/knowledge/modal-gpu.md` (function table: new `process_clip_ai_chunk` +
   `process_clips_ai_parallel` rows with GPU/timeout; GPU-selection section; the by-clip vs
   E7-by-overlay cost distinction).

---

## 8. Implementation Plan (phased, for the later Stage-4 gate — NOT executed now)

1. **Extract** `_process_one_clip` + `_concat_and_upload` from `process_clips_ai` (mechanical
   commit; characterization test asserting sequential output byte-identical pre/post extract).
2. **Add** `process_clip_ai_chunk` (bin worker) + `process_clips_ai_parallel` (orchestrator),
   both delegating to the extracted helpers.
3. **Add** `plan_bins` + `MAX_WORKERS`/`PER_WORKER_BUDGET` constants; route in
   `call_modal_clips_ai` on `K`.
4. **Raise** the guard ceiling in `export_cost_guard.py` (workers-aware budget + single-clip
   check); update its tests.
5. **Tester** (Stage 3, dedicated per L-tier): failing tests FIRST — (a) concat-order determinism
   under simulated out-of-order bin completion, (b) `K==1` path byte-identical to today,
   (c) bin-pack correctness (tiny→1 worker, Bug-58p→6, all-huge→one-per-clip), (d) guard
   accept/reject at the new ceiling + single-clip-too-big rejection.
6. **Reviewer** (Stage 4.5) on the diff; then the staging cost-measurement gate (§6); then deploy.

---

## 9. Risks

- **R1 — Byte-identity of concat output.** The acceptance criterion asks for byte-identical
  output vs sequential. Achievable **iff** Real-ESRGAN (half-precision, T4) is deterministic
  across containers and ffmpeg encodes reproducibly. Because we run the **same** `_process_one_clip`
  code and the **same** concat command, the plan maximizes this. **Fallback if GAN proves
  non-deterministic across containers:** relax the bar to *frame-count + clip-order + visual*
  equality (SSIM ≈ 1.0), and get user sign-off on the relaxed criterion. Verify with a per-clip
  MD5 comparison on Fixture A during staging.
- **R2 — Progress granularity regression.** `.starmap` blocks; per-frame progress can't stream
  from workers (same limitation as `process_framing_ai_parallel`, which yields only coarse
  milestones). The smooth per-frame bar becomes per-clip/per-bin completion ticks for `K>1`
  exports. Acceptable + call it out; mitigate by yielding as each bin result arrives.
- **R3 — Cost overhead unknown until measured** (§6). If the overhead multiplier is
  unexpectedly high (approaching E7's 3–4×), revisit `MAX_WORKERS` or bin granularity before
  prod. This is the gating decision.
- **R4 — Recovery/`modal_call_id`.** The orchestrator must emit `current_function_call_id()` as
  its first stream item exactly like `process_clips_ai`, or the R2-first + `get_call_graph`
  recovery breaks for parallel jobs. Covered by reusing the identical first-yield contract;
  worth an explicit test.
- **R5 — Temp-object cleanup.** `temp_clip_chunks/{job_id}/` must be cleaned even on failure
  (mirror `process_framing_ai_parallel`'s cleanup). A failed export must not leak per-clip MP4s.
- **R6 — Crop-math duplication landmine.** By reusing the extracted `_process_one_clip` (not a
  new copy of the crop/upscale loop) we avoid worsening the "crop interpolation exists 4×" audit
  finding (modal-gpu.md Landmines).

---

## 10. Open Questions (need the user's judgment before implementation)

- **Q1 — `MAX_WORKERS` value.** Proposed **8** (up to ~8× today's ceiling; Bug 58p needs 6). This
  is a direct cost/quota ceiling: more workers = a higher max concurrent T4 spend and a higher
  ceiling the guard will accept. Pick the number.
- **Q2 — `PER_WORKER_BUDGET`.** Proposed reuse of `2880` (80% of the 3600 worker timeout). Keep,
  or lower for more safety margin per worker?
- **Q3 — Defer by-time single-clip sub-chunking?** Recommended **yes** for v1 (multi-clip is Bug
  58p's shape; single-clip-too-big stays rejected by the guard). Confirm, or require it in v1.
- **Q4 — No-keyframe (smart-center-crop) clips.** T11320's guard *excludes* them from the cost
  estimate. Proposed: pack each as its own bin (conservative) so no-crop batches still
  parallelize. Acceptable, or should a source-dims probe be added (larger scope)?
- **Q5 — Byte-identity vs visual-identity acceptance (R1).** If cross-container GAN output isn't
  bit-exact, is SSIM≈1.0 + identical frame-count/order an acceptable pass for AC #2?
