# T7090 — Design: Intro cards silently drop on OOM — move download-time compose to Modal

**Status:** DESIGN — awaiting user approval (HARD GATE)
**Task file:** `docs/plans/tasks/T7090-intro-card-oom-modal-dispatch.md`
**Tier:** L (new Modal function + image, 3 egress points, cache contract, phased)
**Author:** Architect (Stage 2)

---

## 0. TL;DR — what I recommend you approve

1. **Land fix #3 (SIGKILL → CRITICAL + degraded signal) and fix #2 (layer collapse + bbox-crop text) FIRST**, as two small independent PRs, before touching Modal. Fix #3 stops the *silent* failure immediately (the worst part of the bug: a 200 with missing content nobody can see). Fix #2 is expected to bring a **typical** card (~11 inputs → ~4-5 inputs, ~1.7GB → well under 1GB) inside the 1GB box on its own.
2. **Take the `memory_mb = 2048` stopgap NOW** (one-line change to both fly TOMLs), in the same PR as fix #3, so live staging/prod stops dropping cards the moment fix #3 ships — before fix #2 or Modal land. It is cheap insurance for the design/build window, not a fix.
3. **For the Modal migration: move only the ffmpeg compose/concat/outro to Modal, NOT the card render.** Cards stay rendered app-side as PIL (small, bounded memory after fix #2). This avoids packaging the whole render stack (PIL + fonts + geometry + app code) into a Modal image. The heavy, OOM-prone step is the **ffmpeg burn** (looped full-frame inputs), not the PIL rasterisation — moving the burn is what buys the reliability.
4. **Modal dispatch shape: synchronous call-and-wait that writes the composed file to R2, then the backend downloads it and streams it** — mirroring exactly the `call_modal_stitch_members` precedent the collection path already uses. NOT a 302-redirect-to-presigned-URL (rejected below: breaks stamping, cache, and the `attachment` download semantics). This makes all three egress points converge on the collection path's already-proven eager-compute-before-stream model.
5. **T6360's `-c copy` metadata stamp STAYS LOCAL** at the router. It is near-zero RSS, non-fatal, and per-request by design (T4947 cache correctness depends on it being applied on read). Moving it to Modal would break the "cache stores unstamped bytes" contract for no memory benefit.
6. **T4947 cache: key and contract UNCHANGED.** Modal writes the composed MP4 to an R2 scratch key; the backend downloads it, that local file is what gets cached (gated on `full_fidelity`) and what this request streams. `full_fidelity` is returned by the Modal function in its result dict instead of an out-param.

**The gate:** Sections 6 (open questions) and 8 (verification gap — live Modal is not exercisable in-container, exactly like T6360) are the two things I need your explicit sign-off on.

---

## 1. Current State Analysis

### 1.1 The three download egress points

All three resolve intro/metadata inputs while the request DB connection is alive (T5220 teardown gotcha), then run `compose_serve_time` + T6360 stamp. But they have **two structurally different shapes**:

| Egress | Handler | Compose runs… | Passes `report=`? | T4947 cache? |
|---|---|---|---|---|
| Owner download | `downloads.py::download_file` (:689) | **inside** the `StreamingResponse` generator (`_stream_composed_r2` :775, `_stream_composed_local` :846) | No | No |
| Share download | `shares.py::download_shared_video` (:908) | **inside** the generator (`_stream_shared_composed` :939) | No | No |
| Collection download | `collections.py::download_collection` (:976) | **EAGERLY in the handler body** before returning the response (:1119-1231); only the byte-pump is deferred | **Yes** (:1161) | **Yes** (HEAD :1092, write :1209) |

The collection path is the T7040-hardened model: everything that can fail runs before the 200 is committed, so a failure raises a real 500 instead of a mid-stream `TypeError: Failed to fetch`. The owner/share paths still compose *inside* the generator — a failure there fires after headers are committed. **This task should converge all three on the collection model** (eager compose, then stream), because the Modal call is exactly the kind of failure-prone work that must not run post-200.

### 1.2 The OOM chain (`player_intro.py::_build_card` :383-565)

`_build_card` adds **one `-loop 1 -framerate F -t D -i <full-frame RGBA PNG>` ffmpeg input per visual layer AND per text element**, each with its own serial `overlay` in the filter graph:

```
inputs = [ bg ]                                    # 1
  + [ photo ]              (zoompan)               # 2
  + [ tint ] [ vignette ]  (photo grade, :451)     # 3-4   ← static PIL, full-frame
  + [ seam ]               (:472)                  # 5     ← static PIL, full-frame
  + [ scrim ] [ band ]     (:490,:499)             # 6-7   ← static PIL, full-frame
  + [ el_0 ] [ el_1 ] ...  (one per text element)  # 8..N  ← full-frame RGBA per text line
```

Measured: ~150MB peak RSS **per extra looped full-frame input**, duration-independent. A typical card (photo + title + subtitle + 3 facts = 11 inputs / 9 overlays) extrapolates to ~1.7GB demand on a 1GB box → kernel OOM-kill.

### 1.3 The SIGKILL swallow chain (fix #3 target)

```
_build_card → _run (subprocess.run(check=True))
  → kernel -9 → CalledProcessError(returncode=-9)
  → _get_or_build_card except Exception (player_intro.py:599-607)
      → logs "card build failed", returns None        ← e.returncode == -9 available but NEVER inspected
  → build_intro_card (:613) turns None → False
  → serve_time_video._try_build_intro_card (:30-41) → None, identical to "no card configured"
  → compose_serve_time still returns True → 200 OK, intro silently missing
```

An infrastructure OOM-kill is **indistinguishable in the logs from an ordinary "this reel has no intro"**. This is the silent-failure core of the bug.

### 1.4 The compose contract (`compose_serve_time`, `serve_time_video.py:80-166`)

- **HTTP-200-always / never-raises.** Returns True whenever the reel is playable, even if intro/outro/concat all degraded.
- `report["full_fidelity"]` set True only if `concat_ok AND intro landed-or-none AND outro landed-or-none` (:160-165). T4947 caches only when full-fidelity.
- `report=` is optional; **downloads/shares don't pass one** — so any degraded-signal that lives only in the report is invisible to two of three egress points.

### 1.5 The Modal precedent (`call_modal_stitch_members`, `modal_client.py:491-511`)

```python
async def call_modal_stitch_members(user_prefix, input_keys, output_key) -> dict:
    fn = _get_stitch_members_fn()            # lazy modal.Function.from_name; RuntimeError if undeployed
    return await asyncio.to_thread(fn.remote, user_prefix, input_keys, output_key)  # blocking .remote, off-loop
```

Modal fn `stitch_members` (`video_processing.py:3186`): `@app.function(image=image, gpu=None, timeout=1800, secrets=[r2-credentials])` — the **bare ffmpeg+boto3 image**, no torch/PIL/fonts/app code. Reads `{user_id}/{key}` from R2, concats, uploads `{user_id}/{output_key}`, returns `{output_key, duration}`. The collection handler branches on `modal_enabled()` with an app-side `_stitch_members_local` fallback. **This is the exact template.**

### 1.6 Fly memory & image facts

- `fly.staging.toml:31-33` and `fly.production.toml:31-33` are **both** `cpu_kind=shared, cpus=1, memory_mb=1024`. Not a staging-only under-provision.
- `requirements.prod.txt:2` — no torch in the prod image.

---

## 2. Target Architecture

### 2.1 What runs where (the packaging decision — Q2)

> **Card RENDER stays app-side (PIL). Only the ffmpeg compose/concat/outro moves to Modal.**

Rationale:
- The OOM is caused by the **ffmpeg burn** (looped full-frame inputs decoded into RAM), not the PIL rasterisation. PIL renders each layer to a PNG at bounded cost; the explosion is ffmpeg holding N full-frame decoded buffers simultaneously.
- Moving the *render* to Modal would require the whole render stack — `player_intro.py`, `text_render.py`, geometry modules, bundled fonts, PIL — inside a new Modal image. Large image delta, font-bundling risk, and app-code drift between the Fly image and the Modal image.
- Moving only the *compose* keeps the new Modal function on the **same bare ffmpeg+boto3 image `stitch_members` already uses** (possibly the identical function, extended — see §2.2). Minimal image surface.
- After **fix #2**, app-side PIL render of even a pathological card is bounded (each layer is one PNG; collapsing 6 static layers → 1 and cropping text to bbox removes the full-frame-buffer multiplication that hurt ffmpeg — but PIL never had the ffmpeg multiplication problem in the first place; it composites sequentially).

**Concretely, the new download compose flow (all three egress points):**

```
[handler body, request conn alive]
  resolve IntroSpec (card row, field_values, downloaded image) — app-side, PIL
  render intro card PNG layers → build intro card MP4  ← app-side PIL + ffmpeg burn? SEE §2.1a
  resolve metadata map + poster ref (T6360)
[eager, before 200]
  dispatch Modal compose:  reel + intro-card + outro → composed.mp4 on R2 scratch key
  download composed.mp4 from R2 → local tmp
  (collection only) cache-write gated on full_fidelity
  stamp metadata locally (-c copy, T6360)          ← STAYS LOCAL
[return StreamingResponse → pump bytes]
```

#### 2.1a The subtle part: where does the intro-card *burn* happen?

The intro card itself is built by an ffmpeg pass (`_build_card`) — the very pass that OOMs. Two clean options:

- **Option A (recommended): the Modal compose function does the whole card burn + concat + outro.** The backend sends Modal the *card ingredients* (the rendered PNG layers + the filter recipe) OR — simpler — the backend renders the PNGs app-side (cheap PIL), uploads them to an R2 scratch prefix, and Modal runs the `_build_card` ffmpeg graph + concat + outro. This moves the OOM-prone ffmpeg entirely off Fly. Requires the `_build_card` ffmpeg-graph construction logic (NOT the PIL render) to live in the Modal function — a moderate amount of code (the filter_complex builder), but no PIL/fonts.
- **Option B: keep `_build_card` (PIL render + ffmpeg burn) app-side, dispatch only the final `[intro][reel][outro]` concat to Modal.** Smaller Modal surface (concat only, ~ what `stitch_members` already does). BUT the OOM is *inside `_build_card`'s* burn, which stays on Fly — so Option B only works **if fix #2 alone makes `_build_card` fit in 1GB**. Fix #2's own estimate says a typical card drops to ~4-5 inputs / well under 1GB; a *pathological* card (many facts) is the residual risk the task's acceptance criteria call out.

**Recommendation: Option A**, because the acceptance criteria demand reliability "regardless of card complexity (many text facts)". Option B leaves the pathological card on Fly. Option A moves every ffmpeg buffer off Fly. The PNG-layer render stays app-side PIL (cheap, bounded); Modal receives PNGs + the recipe and burns. This is the **decisive answer to Q2: PIL render app-side, all ffmpeg (card burn + concat + outro) on Modal.**

> **Open question O2 for you:** Option A requires porting the `_build_card` *filter-graph builder* (not the PIL render) into the Modal function, and defining the wire contract (PNG layers + motion params + probe → Modal). That is more code than Option B. If you would rather ship Option B and accept that a pathological many-facts card is only protected by fix #2's layer-collapse (not by Modal), say so — it is a smaller task with a residual tail risk. **My default is A.**

### 2.2 The new Modal function

Add `compose_serve_time_modal` to `video_processing.py`, on the **existing bare `image`** (ffmpeg+boto3, no torch/PIL):

```
@app.function(image=image, gpu=None, timeout=1800, secrets=[Secret.from_name("r2-credentials")])
def compose_serve_time_modal(user_prefix, reel_key, intro_layer_keys, motion_params,
                             probe, outro_enabled, out_key) -> dict:
    # download reel + intro PNG layers from R2 {user_prefix}/{key}
    # build the intro-card ffmpeg graph (ported _build_card filter builder) → intro.mp4   [Option A]
    # build/attach branded outro (ported branded_outro card build, or precomputed) 
    # concat [intro?][reel][outro?] in ONE pass → composed.mp4
    # upload composed.mp4 → {user_prefix}/{out_key}
    return {"out_key", "duration", "full_fidelity": <bool>, "degraded_reason": <str|None>}
```

Client wrapper mirrors `call_modal_stitch_members`:

```python
async def call_modal_compose(user_prefix, reel_key, intro_layer_keys, motion_params,
                             probe, outro_enabled, out_key) -> dict:
    fn = _get_compose_fn()  # lazy from_name; RuntimeError if undeployed → caller degrades
    return await asyncio.to_thread(fn.remote, ...)  # blocking .remote off the loop (T7040)
```

`full_fidelity` and `degraded_reason` come back **in the result dict** (replacing the local `report` out-param). `degraded_reason` distinguishes an OOM-equivalent on Modal from an ordinary "no intro" — feeding fix #3's CRITICAL log even for the Modal path.

### 2.3 Dispatch shape decision (Q1) — call-and-wait writing to R2, backend streams

I evaluated three shapes. Latency components: **Modal cold-start + control-plane RTT + compose time + R2 in/out.**

| Shape | Flow | Latency estimate | Verdict |
|---|---|---|---|
| **(a) sync call-and-wait, Modal writes R2, backend downloads + streams** | backend blocks on `fn.remote`, Modal composes → R2, backend GETs → streams | cold-start 3-8s (CPU image, no torch — fast end) **or** ~0.5s warm; control-plane RTT ~0.3s; compose ~3-10s (ffmpeg concat + card burn, ~20-60s reel); reel download to Modal + composed upload/redownload via R2 ~2-6s each way. **Total ~8-25s cold, ~6-15s warm, pre-first-byte.** | **CHOSEN** |
| (b) Modal writes R2, backend 302-redirects client to a presigned URL (no bytes through Fly) | Modal composes → R2, backend returns 302 to presigned GET | Same compose latency, but saves one R2 round-trip through Fly (~2-6s). | **REJECTED** — see below |
| (c) poll / webhook | dispatch, return job id, client polls | Adds client-side poll loop + a status endpoint; no webhook exists (modal-gpu.md: "no Modal→backend callback"). | **REJECTED** — heaviest, no infra |

**Why (b) is rejected** despite lower latency:
- The T6360 metadata stamp **must** be applied per-request (cache correctness — a rename-able `artist` must not freeze in R2). A 302 to the raw composed object serves **unstamped** bytes. Stamping would have to move to Modal too, poisoning the T4947 cache contract (Q3/Q4).
- The download is an `attachment; filename="..."` response with `Content-Disposition`. A 302 to a presigned R2 URL loses the filename header (R2 would need response-content-disposition query params — brittle, per-object).
- Share/owner downloads have no cache and would 302 to a scratch object with a lifetime problem (when is it safe to delete?).
- It splits the three egress points into two error/latency shapes again — the opposite of the convergence goal.

**Why (a) over (c):** (c) needs a new poll endpoint + client changes across three UIs and there is no webhook path in this codebase. (a) reuses the exact `stitch_members` pattern the collection path already runs in production, and the collection path **already pays full build latency pre-first-byte** (T7040 eager compute) — so for collections this is zero latency-shape change. Owner/share downloads currently stream-as-they-compose (no pre-built model); (a) **does change their latency shape** to pre-first-byte-wait — this is the honest cost and is called out in Risks (§7).

**Cold-start note (explicit):** the compose image is the bare ffmpeg+boto3 image (no torch, no weights) so cold-start is on the *fast* end (single-digit seconds), unlike the framing/upscale images. Warm containers reduce this to sub-second. Still, a cold download can wait ~8-25s before the first byte — acceptable for a download (browser shows a spinner; collections already do exactly this per T7050), and the user explicitly chose "don't run heavy ffmpeg on Fly" over latency in the task decision.

### 2.4 Fix #2 — layer-compositing waste (independent of Modal)

Two sub-changes, both in the PIL/render layer:

1. **Collapse static PIL layers into ONE `alpha_composite`d "above-photo" PNG.** `_render_tint`, `_render_vignette`, `_render_seam_fade`, `_render_scrim`, `_render_band` already return PIL RGBA images. Composite them (respecting their photo-rect offsets vs. full-frame offsets) into a single PNG before handing to ffmpeg. **6 looped inputs → ~2.** Est. ~600MB saved. (Note the overlays currently use two different offsets: photo-rect `x=px:y=py` for tint/vignette/seam, `x=0:y=0` for scrim/band — the collapse must composite each at its correct offset onto one full-frame canvas, then overlay that canvas at `x=0:y=0`.)
2. **Crop each text layer to its union bbox.** `render_text_layer` (:125) returns a full-frame RGBA (:179). Change it to return `(cropped_img, (x0, y0))` where the crop is the union bbox of fill + stroke + blurred-shadow inflation (blur adds `~3*blur_px` margin). Overlay at `x=x0:y=y0` (:526) instead of `x=0`, folding `y0` into the rise `yexpr` (:521-524). ~152MB → ~47MB per element. Only caller is `player_intro.py:515`.

These are **memory-only render changes, no behavior/pixel change** (the composited output is pixel-identical; the crop+offset must reproduce the same final position). Per refactoring rule #3, these are near-mechanical and should ship with a characterization test proving pixel-identity (§8).

### 2.5 Fix #3 — stop swallowing SIGKILL

The CRITICAL log must fire **even when no `report` is passed** (owner/share don't pass one). So it belongs at the **card-build layer**, not only in the report write:

- In `_get_or_build_card` (`player_intro.py:599`): inspect `e.returncode`. If it is negative (signal-terminated; `-9` = SIGKILL/OOM), log at **CRITICAL** with the reel/card id and a distinct marker (e.g. `INTRO_CARD_OOM`), not the current `logger.error("card build failed")`. Return a sentinel that the caller can distinguish, OR set a module-level/threaded degraded flag surfaced through the return.
- Thread a `degraded_reason` up through `build_intro_card` → `_try_build_intro_card` → `compose_serve_time`'s `report` (when present). The report path stays the machine-readable signal for T4947; the CRITICAL log is the always-on signal for ops.
- For the **Modal path**, the equivalent OOM signal is `degraded_reason` in the Modal result dict (§2.2) — the client logs CRITICAL when the reel expected an intro but Modal reported it dropped.

Acceptance criterion satisfied: an infra-level render failure is CRITICAL-logged and distinguishable from "no intro configured".

### 2.6 Target diagram

```mermaid
flowchart TD
    subgraph Fly[Fly web machine 1GB]
      H[download handler] --> R[resolve IntroSpec + metadata, conn alive]
      R --> P[PIL render card layers to PNGs - bounded after fix #2]
      P --> UP[upload reel key + layer PNGs refs to R2 scratch]
      UP --> D[call_modal_compose - asyncio.to_thread, off-loop]
      D --> DL[download composed.mp4 from R2]
      DL --> C{collection?}
      C -->|yes, full_fidelity| CW[cache-write R2 T4947]
      C --> S[stamp -c copy metadata LOCAL T6360]
      CW --> S
      S --> ST[StreamingResponse pump]
    end
    subgraph Modal[Modal CPU, bare ffmpeg image, headroom]
      D -.fn.remote.-> MC[build card ffmpeg graph + concat intro/reel/outro]
      MC -.-> MR[(R2 scratch: composed.mp4)]
    end
    MR -.GET.-> DL
```

---

## 3. Refactoring / Implementation Plan (phased per Q5)

The three fixes are independent and should land as **separate, sequenced PRs**, smallest/highest-value-first.

### Phase 0 — Stopgap (ship with Phase 1) — ~2 LOC
- `fly.staging.toml` + `fly.production.toml`: `memory_mb = 1024 → 2048`.
- **Why now:** it is the only thing that stops live card-drops *before* fix #2/Modal land. It is not a fix (doesn't address waste or the Fly-vs-Modal decision) but it is cheap insurance for the build window. Fly cost delta for a shared-cpu 2GB box is small.
- **Revisit at Phase 3:** once compose is on Modal and fix #2 has shrunk app-side render, decide whether to revert to 1024 (the memory pressure source is gone). Leave a task note.

### Phase 1 — Fix #3: SIGKILL → CRITICAL + degraded signal (smallest, highest value)
- `player_intro.py::_get_or_build_card`: inspect `e.returncode`, CRITICAL-log signal-kills distinctly, thread `degraded_reason`.
- `build_intro_card` / `serve_time_video._try_build_intro_card` / `compose_serve_time`: propagate `degraded_reason` into `report` (when present).
- **Independently buys:** the silent 200-with-missing-content becomes a CRITICAL log ops can alert on — the single worst symptom is gone even before any memory fix. No behavior change to successful downloads.
- Ships with Phase 0.

### Phase 2 — Fix #2: layer collapse + bbox-cropped text (independent, memory-only)
- `player_intro.py`: composite the 5 static PIL layers → 1 PNG at correct offsets (:451-507).
- `text_render.py::render_text_layer`: return `(cropped_img, (x0,y0))`; update the sole caller (:515-526) to overlay at the offset and fold `y0` into `yexpr`.
- Characterization test FIRST (pixel-identity of composed card frame; a counterfactual test proving the old per-full-frame-input graph would exceed budget — see acceptance criterion + §8).
- **Independently buys:** a **typical** card (~11 → ~4-5 inputs) fits comfortably in 1GB. Likely resolves OOM for the vast majority of real cards **without Modal at all**. Pathological many-facts cards may still be tight → that residual is what Phase 3 closes.

### Phase 3 — Fix #1: Modal-dispatch the compose (largest, depends on nothing but benefits from #2)
- New Modal fn `compose_serve_time_modal` (bare `image`, `gpu=None`) + `call_modal_compose` client wrapper (mirror `stitch_members`). **Requires a manual Modal redeploy — ask the user (modal-gpu.md invariant #3).**
- Extract a shared `compose_and_stream` helper the three egress points call, so owner/share converge on the collection's eager-compute-before-stream model (fixes their post-200 failure shape as a bonus).
- `modal_enabled()` branch with the app-side `compose_serve_time` as the local fallback (matches the collection stitch pattern exactly — in-container verification runs the local branch, T4180).
- T6360 stamp stays local at the router (Q3). T4947 cache key unchanged; `full_fidelity` now sourced from the Modal result dict (Q4).
- Update `.claude/knowledge/export-pipeline.md` (stale duration-gate line per task §5; new compose-dispatch note) + `modal-gpu.md` (new function row) in the same PR.

**Sequencing rationale (Q5):** #3 and #2 are strictly smaller, lower-risk, independently valuable, and don't touch Modal or the cache contract — landing them first shrinks the blast radius and means the Modal PR is a pure dispatch move over an already-de-risked render. #2 may make #1 *optional for most cards*, but the acceptance criteria's "regardless of complexity" bar means #1 still ships to cover the pathological tail (and to honor the user's explicit "no heavy ffmpeg on Fly" decision).

---

## 4. Design Decisions

| Decision | Options | Choice | Rationale |
|---|---|---|---|
| Dispatch shape (Q1) | (a) sync call-and-wait + R2 + backend stream; (b) 302 to presigned; (c) poll/webhook | **(a)** | Mirrors proven `stitch_members`; preserves per-request stamping + cache + `attachment` header; (b) breaks stamping/cache/filename, (c) no webhook infra + 3 UI changes |
| Render vs compose to Modal (Q2) | render+compose on Modal; compose-only | **compose-only; PIL render app-side** | OOM is in ffmpeg burn, not PIL; avoids packaging fonts/PIL/app-code into a Modal image |
| Card burn location (§2.1a) | A: burn on Modal; B: burn app-side, concat-only on Modal | **A** | Acceptance demands reliability for pathological cards; B leaves the burn on Fly | 
| T6360 stamp (Q3) | move to Modal; stay local | **stay local** | near-zero RSS `-c copy`; per-request-on-read is required for T4947 cache correctness |
| Cache key (Q4) | change; keep | **keep unchanged** | Modal composes the same bytes; `full_fidelity` moves from out-param to result dict, nothing in the fingerprint changes |
| Stopgap memory bump | now; skip | **now (Phase 0)** | only thing that stops live drops during the build window; revert candidate after Phase 3 |
| Fix ordering (Q5) | Modal-first; fixes-first | **#3 → #2 → #1** | smallest/safest first; #3 kills the silent symptom immediately; #2 may resolve most cards; #1 covers the tail |

---

## 5. T4947 cache contract — precise preservation (Q4)

Today (collection path):
1. Compute `cache_key` from the fingerprint (member ids+filenames, resolved card id, card content hash, burned facts, `outro_enabled()`, `budget_sec`). **UNCHANGED.**
2. HEAD `cache_key`; on hit, download the **unstamped** cached bytes, stamp per-request, stream.
3. On miss: build (stitch + compose), get `compose_report["full_fidelity"]`, cache-write **only if full_fidelity**, then stamp locally and stream **this request's own `serve_path`** (never the just-written key).

With Modal compose:
1. Cache key: **identical fingerprint, identical key.** Modal composes the same logical bytes from the same inputs; nothing observable changes.
2. HEAD/hit path: **completely unchanged** — the cache stores unstamped composed bytes; a hit never dispatches Modal at all.
3. Miss path: Modal writes the composed MP4 to an R2 **scratch** key (disposable, `temp/…`, torn down with the account, like the stitch scratch). Backend downloads it to a **local** `serve_path`. Then:
   - `full_fidelity` now comes from the **Modal result dict** (§2.2) instead of the local `report`.
   - Cache-write (gated on `full_fidelity`) uploads the **local** `serve_path` to `cache_key` — same as today.
   - **Race invariant preserved:** this request streams its OWN local `serve_path`, never the `cache_key` it may have just written (an R2 PUT is atomic; a concurrent request either misses-and-rebuilds or hits a byte-complete object). The scratch key ≠ the cache key; scratch is best-effort deleted after download (existing pattern at :1188).
   - **Stamp stays local, after the cache-write** (unchanged) — cache holds unstamped bytes, this caller streams stamped bytes.

**Net:** the cache key is unchanged, "cache stores unstamped bytes" is unchanged, "stream your own bytes not the cache key" is unchanged. The only delta is *where the compose ran* and *where `full_fidelity` is read from*. This is a deliberate, minimal revision, not a silent break.

---

## 6. Open Questions for the user (approve / redirect)

- **O1 (dispatch shape).** Confirm shape **(a)** — synchronous call-and-wait, Modal writes R2, backend downloads + streams — and accept that **owner/share downloads gain a pre-first-byte wait** (they currently stream-as-they-compose). Collections already work this way (T7040/T7050), so their UX is unchanged; owner/share will show a spinner during compose. OK?
- **O2 (card burn location — §2.1a).** My default is **Option A**: PIL render app-side, but the intro-card ffmpeg *burn* runs on Modal too (moves every ffmpeg buffer off Fly, covers pathological cards). This costs porting the `_build_card` filter-graph builder into the Modal function. The lighter **Option B** (burn stays app-side, only the final concat goes to Modal) is smaller but leaves a pathological many-facts card protected only by fix #2. **A or B?**
- **O3 (stopgap).** Approve the immediate `memory_mb = 2048` bump on both fly TOMLs shipped with Phase 1, revisited for revert after Phase 3? (Small ongoing cost; buys safety during the build window.)
- **O4 (scope of the Modal move).** The task says "download-time compose no longer runs local ffmpeg on the Fly web machine." The **local fallback** (`compose_serve_time` app-side when `MODAL_ENABLED=false`) must remain for in-container verification (T4180) and as a degrade path. Confirm "no local ffmpeg on Fly" means **when Modal is enabled** (prod/staging), with the local path retained for containers/dev — mirroring `stitch_members`.
- **O5 (Phase independence / partial ship).** If fix #2 (Phase 2) is measured on staging to bring even pathological cards inside 2GB, are you open to *deferring* Phase 3 (the Modal move) to a follow-up, or is the "no heavy ffmpeg on Fly" decision firm regardless? (This affects whether Phase 3 is in-scope for T7090 or spun out.)

---

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Owner/share downloads gain pre-first-byte latency (new wait) | Spinner UX (collections already do this, T7050); Modal compose image is cold-start-fast (no torch); warm containers sub-second. Called out in O1. |
| Modal cold-start on an infrequently-hit compose fn adds seconds | Bare ffmpeg image = fast cold-start; acceptable for a download; user chose reliability over latency in the task decision. |
| Modal `compose_serve_time_modal` undeployed → `RuntimeError` at dispatch | Same as `stitch_members`: lazy `from_name` raises, the `modal_enabled()` branch's local `compose_serve_time` is the fallback; never a hard download failure. **Manual redeploy required (ask user).** |
| Porting `_build_card` filter-graph to Modal drifts from the app-side copy (Option A) | Keep the *filter builder* as one shared pure function importable by both the router (local fallback) and the Modal function; only the PIL render differs. Characterization/fixture parity test (§8). |
| Fix #2 crop+offset changes card pixel position (regression) | Characterization test asserting pixel-identity of the composed card frame BEFORE the change; strangler-fig, mechanical commit. |
| T4947 cache poisoned by a degraded Modal compose | `full_fidelity` from the Modal result dict still gates the cache write (unchanged invariant). |
| Scratch R2 key leaks | Best-effort delete after download (existing collection pattern :1188); scratch is disposable, torn down with the account. |
| Scope creep (converging owner/share onto the collection model touches 3 routers) | Extract ONE `compose_and_stream` helper; keep the diff per PR < ~200 meaningful lines (refactoring rule #4); the convergence is a direct enabler of the Modal move, not gratuitous. |

---

## 8. Verification Plan

### Testable in-container (Modal OFF, `MODAL_ENABLED=false` — T4120/T4180 local-render mode)
- **Fix #3 (Phase 1):** unit test simulating a signal-killed subprocess (mock `_run` to raise `CalledProcessError(returncode=-9)`) → assert CRITICAL log with the OOM marker AND `report["degraded_reason"]` distinct from an ordinary None-card miss. Assert a genuinely-absent card does NOT log CRITICAL.
- **Fix #2 (Phase 2):** characterization test — render a representative card frame before/after and assert pixel-identity (composited-static-layer PNG and bbox-cropped-text-at-offset produce the same final frame). **Counterfactual test** (acceptance criterion): assert the *old* per-layer-full-frame-input graph would exceed a memory/ input-count budget that the new collapsed graph satisfies (input-count assertion is deterministic and container-safe; a live RSS measurement is not).
- **Fix #1 (Phase 3):** the `modal_enabled()`-false local branch runs `compose_serve_time` exactly as today — existing `test_t4947_*`, share/owner download tests, and a new test asserting the three egress points call the shared `compose_and_stream` helper and that the cache key/contract is unchanged. Mock `call_modal_compose` to assert the wire contract (inputs resolved pre-teardown, `.remote` off-loop, result-dict `full_fidelity` gates cache-write) without a live Modal.

### Requires live staging (explicit verification GAP — same posture as T6360)
- **Modal is OFF by default in containers (T4180)** — live cost, latency (cold-start + compose + R2 round-trips), and the actual OOM-avoidance on Modal's headroom **cannot be exercised in-container.** These are a **staging follow-up**, exactly as T6360 flagged its live-download verification.
- Live checks (staging, with a real account holding a published reel + intro card — `e2e@test.local` is empty per the task file): (1) a pathological many-facts card downloads WITH the intro; (2) measured pre-first-byte latency for owner/share/collection downloads; (3) confirm the Fly box no longer OOM-kills (RSS stays bounded now that compose is off-box); (4) after Phase 3, decide whether to revert `memory_mb` to 1024.
- **Call this out to the user as a known gap:** the design is verified in-container only through the local-render path and mocked Modal contract; the Modal reliability/latency claims are validated on staging post-deploy, not in CI.

---

## 9. Approval Gate

**This is a HARD approval gate. No implementation begins until you approve.**

Please review and respond with either:
- **"Approved"** (optionally with answers to O1-O5; my defaults are: O1=(a), O2=Option A, O3=yes, O4=Modal-on-prod with local fallback retained, O5=Phase 3 in-scope), or
- **redirects** on any of the decisions in §4 / open questions in §6.

On approval I proceed to Phase 1 (fix #3 + stopgap) → Phase 2 (fix #2) → Phase 3 (Modal), each with Test-First per Stage 3.
