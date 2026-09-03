---
domain: modal-gpu
updated: 2026-09-03 (T8270: staging + prod are now SEPARATE Modal apps -- app name resolved from
APP_ENV via resolve_modal_app_name, deploy is per-environment, default rollout is staging-verify-then-prod
- see Entry points / Invariant 3 below); 2026-09-02 (T8280: process_clips_ai read loop now SKIPS enhance()+imwrite() for source
frames off the target-fps grid when down-sampling, ~40% fewer GPU-upscale calls on a 50fps source
- see Landmines/Active-work below); 2026-08-19 (T7210: fixed modal_call_id recovery capture, dead
since ~forever - see Recovery section); 2026-07-11 (T4240 recovery bugs fixed; T3950 branded outro
- NOT in Modal)
---
# Modal GPU / Local Render — Domain Knowledge

## Scope
- `src/backend/app/modal_functions/` — `video_processing.py` (2,930 L, the deployed app), `video_processing_optimized.py` (benchmark clone, NOT production), `deploy.py`
- `src/backend/app/services/modal_client.py` (unified dispatch), `local_processors.py` (MODAL_ENABLED=false engine), `processor_modal.py` / `processor_local.py` / `local_gpu_processor.py` / `video_processor.py` (factory layer, mostly bypassed), `modal_queue.py` (dormant), `progress_reporter.py`
- `src/backend/app/ai_upscaler/` — local Real-ESRGAN/RIFE package (`AIVideoUpscaler`, `KeyframeInterpolator`)
- Modal recovery surface in `src/backend/app/routers/exports.py` (shared with export-pipeline domain)

## Entry points
Always call the **unified interface** in `modal_client.py` (backend CLAUDE.md rule) — it routes Modal vs local internally:
- `call_modal_framing_ai` (`modal_client.py:489`) — single-clip framing+upscale. Caller: `export_helpers.py:227`.
- `call_modal_clips_ai` (`:784`) — multi-clip. Caller: `multi_clip.py:1316`. NO local fallback — raises if Modal disabled (local branch lives in `multi_clip.py:1463+` instead).
- `call_modal_overlay` (`:986`) / `call_modal_overlay_auto` (`:1200`, always sequential — parallel was 3-4x costlier, experiment E7). Callers: `export_worker.py:387`, `overlay.py:1867`.
- `call_modal_detect_players` (`:1252`) / `_batch` (`:1299`) — YOLO. Caller: `routers/detection.py`.

Deployed Modal app (T8270 — per-environment, NOT one shared app anymore): `modal.App(_resolve_modal_app_name(APP_ENV))` (`video_processing.py:56`) → `reel-ballers-video-v2` (production) or `reel-ballers-video-v2-staging` (staging), mirroring Fly's `reel-ballers-api` / `reel-ballers-api-staging` split. The name is resolved from `APP_ENV` by `resolve_modal_app_name` (`modal_client.py`, the SINGLE source of truth) and by a byte-for-byte copy at the top of `video_processing.py` (it can't import `app.*` — the Modal image doesn't mount `app`); `tests/test_modal_app_name.py` asserts the two copies agree so they can't drift. **No silent fallback:** an unrecognized `APP_ENV` RAISES rather than defaulting to the prod name (dev-family → distinct `-dev` name, Modal is off in dev anyway). Backend looks functions up lazily via `modal.Function.from_name(MODAL_APP_NAME, ...)` where `MODAL_APP_NAME = resolve_modal_app_name(APP_ENV)` (`modal_client.py:332-372,~400-540`). `@app.function`s (all use secret `modal.Secret.from_name("r2-credentials")`; no Volumes — weights baked into images):
| Function (decorator line) | GPU | Timeout | Role |
|---|---|---|---|
| `render_overlay` (:189) | T4 | 600 | highlight overlay render, generator |
| `detect_players_modal` (:797) / `_batch` (:913) | T4 | 120/300 | YOLO (`yolov8x.pt` baked into `yolo_image`) |
| `process_framing_ai` (:1150) | T4 | 1800 | sequential framing+upscale, generator |
| `process_framing_ai_l4` (:1628) | L4 | 1800 | 200-line benchmarking COPY, not wired into client (T4420 deletes) |
| `process_framing_ai_chunk` (:1840) | T4 | 900 | parallel chunk worker |
| `process_framing_ai_parallel` (:2043) | none (CPU orchestrator) | 3600 | fans out chunks |
| `process_clips_ai` (:2387) | T4 | 3600 | multi-clip framing+concat, generator |
| `stitch_members` (:3186) | none (CPU) | 1800 | T4945 collection member concat/re-encode (bare ffmpeg+boto3 `image`) |
| `compose_serve_time_modal` (:~3250) | none (CPU) | 1800 | T7090 download-time compose: intro-card BURN + `[intro?][reel][outro?]` concat + branded outro off the 1GB Fly box. `compose_image` = bare `image` + pillow/numpy/pydantic + the WHOLE `app/` tree at `/root/app` (for `card_compose_plan`/`ffmpeg_concat`/`branded_outro`/fonts; deliberately NOT player_intro/user_db — the PIL card render runs app-side, PNG layers arrive via R2). **NEEDS MANUAL DEPLOY.** |

## Data flow
```mermaid
graph LR
  RT[export routers/services] --> UC[modal_client unified fns]
  UC -->|MODAL_ENABLED=true| MG[fn.remote_gen on Modal T4/L4]
  UC -->|false| SP[_run_in_subprocess -> local_processors._framing_sync/_overlay_sync]
  SP -->|CUDA| AI[ai_upscaler.AIVideoUpscaler realesr_general_x4v3]
  SP -->|no CUDA| MOCK[MockVideoUpscaler ffmpeg crop+resize only]
  MG & AI --> R2[(R2 in/out via presigned URLs / r2-credentials)]
  MG -->|yield progress dicts| CB[progress_callback -> WS send_progress]
```
- **T3950 invariant:** The branded outro is NOT inside any Modal function. Modal produces `working_videos` (intermediate). The outro fires in `overlay.py` at `final_videos` creation — on the backend server, after Modal completes, with the R2 object rewritten in-place. No Modal redeploy needed when T3950 feature is changed.
- **Dispatch/monitoring:** Modal functions are Python generators; the backend iterates `fn.remote_gen(...)` in an executor and forwards each `{progress, phase, message}` yield to the async `progress_callback` (framing loop `modal_client.py:689-715`; clips `:897-943`; overlay `:1106-1131`).
  - There is **no webhook and no Modal→backend callback** — progress is consumed in-process, then pushed over the export WebSocket via `export_helpers.send_progress`.
  - `progress_reporter.py` is pure weighted-phase math (`DEFAULT_PHASE_WEIGHTS`, UPSCALING weight 0.50); it never talks to Modal.
- **Recovery (T7210, 2026-08-19 — corrects prior "gen.object_id" claim, which was dead code):**
  `<fn>.remote_gen(...)` returns a plain generator with no `.object_id` attribute in the installed
  SDK (1.3.1, confirmed by reading `.venv/Lib/site-packages/modal/_functions.py` +
  `synchronicity/synchronizer.py`) — `hasattr(gen, 'object_id')` was unconditionally False, so
  `export_jobs.modal_call_id` never populated for ANY generator-based export. `.spawn()` is not a
  substitute (`InvalidError` for generator functions). The supported mechanism:
  `modal.current_function_call_id()`, callable only from inside the running container. Fixed for
  `process_clips_ai`/`call_modal_clips_ai` only (the path the backend-authoritative `/render` +
  multi-clip endpoints actually use): the Modal function yields `{"modal_call_id": ...}` as its
  FIRST stream item; `modal_client.py` reads it off that item inside the existing `next(gen)`
  polling loop and fires `call_id_callback` once (`modal_client.py`'s `call_modal_clips_ai`).
  `call_modal_framing_ai`/`call_modal_overlay` still have NO working call_id capture — their "NOT
  USED with remote_gen" docstrings are accurate, not fixed by T7210.
  - Recovering a **generator** call via `FunctionCall.get(timeout=0)` returns a `GeneratorDone`
    marker, NOT the dict the function yielded as its last item (the SDK can't replay the stream)
    — `/modal-status` (`exports.py`) treats this as "Modal is done" but HEAD-probes R2
    (`file_exists_in_r2`) against the job's `output_key` before finalizing, since a caught-and-
    yielded Modal-side error is *also* `GeneratorDone` and indistinguishable from success by
    completion alone. `export_jobs.output_key` is now written at DISPATCH time (`multi_clip.py`'s
    `store_modal_call_id`), not only after upload — so its mere presence is no longer proof the
    object exists; the R2 check is the actual boundary.
  - Recovery finalizing at all (previously impossible — `modal_call_id` was always NULL) means the
    in-band export and a recovery poll can now race to finalize the SAME job concurrently.
    `export_finalize.py`'s `_claim_stage_for_finalize` is a CAS on `export_jobs.stage` gating entry
    into detect/persist — only the caller whose stage snapshot still matches the DB proceeds; the
    loser (`multi_clip.py`'s `_await_concurrent_finalize`) waits briefly for the winner's result
    instead of raising a false failure.
  - Mid-stream connection loss after job start → clips returns `{"status":"connection_lost","recoverable":True}` (`modal_client.py:908-914`).
  - Later, `GET /api/exports/{job_id}/modal-status` polls `modal.FunctionCall.from_id(call_id).get(timeout=0)` (`exports.py:843-847`; `TimeoutError` = still running) and finalizes via `finalize_modal_export` (`exports.py:191`).
  - `POST /api/exports/{job_id}/resume-progress` (`exports.py:1004`) simulates progress from elapsed time while polling Modal.
  - Job-level retry inside the client: 3 attempts, backoff 2.0, gated by `classify_modal_error` transient/deterministic (`modal_client.py:104-111,153`); user-facing error translation in `_translate_modal_error` (`:297`).
- **Modal↔R2:** Modal reads/writes R2 directly (`get_r2_client`, `video_processing.py:121`, env from the `r2-credentials` secret: `R2_ENDPOINT_URL`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`). Paths are `{user_prefix}/{key}` — `_resolve_modal_user_id` (`modal_client.py:345`) converts user_id → R2 prefix before every dispatch.
- **Local path:** `_run_in_subprocess` (`modal_client.py:74`) runs `local_processors._framing_sync`/`_overlay_sync` in a `ProcessPoolExecutor(max_workers=2)`, progress bridged via a Manager queue (T2640: keeps ffmpeg/AI off the event loop).
  - `MockVideoUpscaler` (`local_processors.py:28`) is a drop-in for `AIVideoUpscaler` doing ffmpeg crop+resize only — pipeline verification without a GPU.

## Invariants & rules
1. **`MODAL_ENABLED` is the single master switch** (default false; `modal_client.py:327`). Auth via `MODAL_TOKEN_ID`/`MODAL_TOKEN_SECRET` (read by the Modal SDK, not app code). No `USE_MODAL`/`USE_GPU` vars exist. Local GPU-vs-mock is decided by `torch.cuda.is_available()` (`local_processors.py:137-159`; `multi_clip.py:1469-1492` — CUDA→real upscaler, no-CUDA+Modal-off→Mock "pipeline verify", no-CUDA expecting GPU→503).
2. **Always route through `modal_client`'s unified functions** — routers must not import Modal functions directly. The `ProcessorFactory`/`VideoProcessor` ABC layer exists but export paths bypass it; don't build new code on the factory.
3. **Deploys are manual, per-environment, and must be offered to the user** (backend CLAUDE.md): after editing anything in `app/modal_functions/`, ask, then deploy STAGING first, verify (real non-30fps upload + ffprobe, Tbug49p repro), THEN prod — never one shared deploy (T8270). Use the wrapper, which sets `APP_ENV` for you: `python app/modal_functions/deploy.py` (staging, safe default) then `python app/modal_functions/deploy.py --prod`. Raw form must set `APP_ENV` explicitly (`APP_ENV=staging|production PYTHONUTF8=1 .venv/Scripts/python.exe -m modal deploy app/modal_functions/video_processing.py`) — `modal deploy` names the app from `APP_ENV` in the deploying shell, so forgetting it silently targets the `-dev` name. Deployed function set must stay in sync with the `modal.Function.from_name(MODAL_APP_NAME, ...)` lookups; renaming/adding a function without redeploy → `RuntimeError("Modal <fn> not available")` at dispatch. `deploy.py` is a Windows-Unicode-safe subprocess wrapper writing `deploy_result.{staging,production}.txt`. Deploys do NOT ride the Fly deploy — they are a separate step, and each env is now deployed independently.
4. **Weights bake into images at build** (no Modal Volumes). Four images in `video_processing.py`:
   - `image` (`:30`): debian_slim py3.11 + ffmpeg + boto3/opencv/numpy (overlay).
   - `yolo_image` (`:42`): + ultralytics/torch; pre-downloads `yolov8x.pt` (`:54-56`).
   - `upscale_image` (`:64`): pins `torch==2.1.0, torchvision==0.16.0, basicsr==1.4.2, realesrgan==0.3.0` (torchvision 0.17+ removed `functional_tensor` that basicsr imports, `:60-63`); pre-downloads `realesr-general-x4v3.pth` to `/root/.cache/realesrgan/weights/` (`:78-82`).
   - `_optimized.py` has its own image (benchmark only).
5. **GPU selection:** `get_framing_ai_gpu_config(duration)` (`modal_client.py:412`): <3s→1 GPU, <10s→2, else 4; parallel only when `num_chunks>1 and segment_data is None` (`:620`). Everything production runs on T4.
6. **Production upscale pipeline (ground truth, verified 2026-07-03** — `docs/plans/tasks/upscale-quality/EPIC.md`): `SRVGGNetCompact` compact model via `RealESRGANer(scale=4, tile=0, half=True, dni_weight=None)` (`_get_realesrgan_model`, `video_processing.py:1076-1112`) → crop (Catmull-Rom `_interpolate_crop:1117`) → enhance 4x → Lanczos resize to target. T4 ≈ 1.47 fps; 10s clip ≈ $0.03. Do NOT confuse with `app/ai_upscaler/` (local path + SwinIR/HAT backends, not the prod hot path).

## Landmines & history
- **Crop-interpolation math exists 4×** (audit E4 / T4420): canonical `app/interpolation.py`, `ai_upscaler/keyframe_interpolator.py`, `video_processing.py:586-1156`, `_optimized.py`. Divergence = local vs Modal exports crop differently. Fixture parity FIRST when consolidating.
- **`video_processing_optimized.py`** is a separate benchmark app (`reel-ballers-video-optimized`) with 8 T4/L4 variants — never called by the client; T4420 deletes it. `process_framing_ai_l4` is likewise an unwired copy. (T8270 re-confirmed dead vs the prod path: referenced only by itself + `experiments/e6_optimized_benchmark.py`; its distinct name can't collide with the v2 staging/prod apps, so it deliberately got NO per-env treatment — deletion stays owned by T4420.)
- **`deploy_result.txt` is stale** (old app name `reel-ballers-video`, old function list); the `local_entrypoint` example prints the old name too. Don't trust either as deploy ground truth. (T8270: `deploy.py` now writes per-env `deploy_result.staging.txt` / `deploy_result.production.txt`.)
- ~~**T4240 recovery-bug quartet** (FIXED 2026-07-11):~~ `exports.py:279` NameError was T4790 (fixed 2026-07-10). The remaining three T4240 bugs are now fixed: `check_modal_job_running` returns None on lookup error instead of treating it as "not running" (cleanup skips unknown-status jobs, no longer kills live paid jobs); fabricated `recovered_{job_id}.mp4` filename when `output_key` missing replaced with a loud failure and no DB row; `export_worker.py` except block narrowed so try-scoped vars are always in scope. Regression tests: `test_t4240_export_recovery.py`.
- **Two `LocalGPUProcessor` classes both register `ProcessingBackend.LOCAL_GPU`** (`processor_local.py:332` CUDA-required vs `local_gpu_processor.py:379` ffmpeg-only) — last import wins the factory slot. Another reason not to use the factory.
- **`modal_queue.py` has ZERO registered task types** — `_process_single_task` always fails "Unknown task type" (`modal_queue.py:106-108`); retained scaffolding (clip extraction removed T740/T800). Startup recovery is per-user-first-request (`main.py:344-351` defers; `session_init.py:255-301` runs `recover_orphaned_jobs` + `process_modal_queue`), NOT at boot.
- **Encode drift** (T4430/T4710):
  - Modal final encode is `libx264 -crf 23 -preset fast` while parallel chunks are crf 18 — last step is the lowest quality.
  - Modal path missing bt709 color tags (local `video_encoder.py:789-792` sets them; some players render washed out).
  - `-shortest` truncation fix applied in one path, still passed in others (`overlay.py:707`, `processor_local.py:252` per audit E3); ~55 hand-built ffmpeg arg lists across 13 modules.
  - `dni_weight` denoise blend (`realesr-general-wdn-x4v3` companion) is unused while far crops carry block noise the GAN sharpens.
- **Local torch import is optional/guarded** (`ai_upscaler/__init__.py:16-19`) so CPU containers can still import the torch-free `KeyframeInterpolator` needed by the overlay renderer (T4120).
- Containers (/dotask) run Modal OFF by default (T4180); `MODAL_ENABLED=false` local-render verify mode is the sanctioned in-container way to exercise exports (T4120).

## Testing seams
- `call_modal_framing_ai(test_mode=True)` → `local_processors.local_framing_mock` (`modal_client.py:541`, `local_processors.py:737`) — no GPU, no Modal, no render.
- `MODAL_ENABLED=false` + no CUDA → `MockVideoUpscaler` end-to-end pipeline verification (T4120 recipe); /dotask containers have Modal off by default and optional token provisioning (T4180).
- Cost/perf anchors (E6 benchmark): T4 ≈ 681 ms/frame; 10s clip @30fps ≈ 204 GPU-s ≈ $0.03; Modal jobs can run 40+ min (hence the 60-min stale threshold in `cleanup_stale_exports`). Framing cost anchor ≈ 0.3c/exported-second still stands (T4940 sanity check).
- **Overlay-render GPU cost is UNMEASURED (T4940 Step 0, OPERATOR follow-up).** The 2nd Modal pass (`render_overlay`, ffmpeg compositing not GAN) is FREE to users by product decision — no credit deduction in `overlay.py`. Its real GPU-s/video-s was never benchmarked (Modal is unavailable in the /dotask container, so T4940 couldn't run it). Measure it the same way as the E6 framing benchmark when convenient; until then "free" is a decision, not a known number. Expected well under 0.1c/s.

## Active/upcoming work
- **T8280** (impl 2026-09-02, Option B - 30fps cost-saving choice only, NOT native-fps delivery):
  `process_clips_ai`'s read loop (`video_processing.py`) still `cap.read()`s every source frame
  (sequential decode, no cheap seek) but now gates `upsampler.enhance()` + `cv2.imwrite()` +
  `output_frame_idx` increment behind a new pure helper `_should_emit_downsampled_frame`
  (integer-cadence grid resampler, `int(frame_num_rel * target_fps / original_fps)` advancing,
  `last_grid_idx` reset to -1 PER CLIP) - skips the expensive GAN upscale for source frames that
  would be discarded by ffmpeg's `-r <target_fps>` anyway, instead of paying for them and
  discarding at encode time. ~40% fewer `enhance()` calls on a 50fps source (863->~518 frames).
  A new `png_cadence_fps` (= target `fps` when down-sampling, else `original_fps`, computed once
  after the loop) replaces `original_fps` at ALL FOUR downstream consumers so the change is
  internally consistent: `output_duration` in the speed-change branch, and the `input_fps`/
  `original_fps` args at all three `_build_simple_ffmpeg_cmd`/`_build_speed_change_ffmpeg_cmd`
  call sites. When NOT down-sampling (`fps >= original_fps` - sub-30fps sources, or any future
  native-fps choice) `png_cadence_fps` reduces to exactly `original_fps` and the loop emits every
  frame - byte-identical to pre-T8280 behavior, a gated single path not a parallel one. The
  `original_fps = cap.get(CAP_PROP_FPS) or fps` fallback (silent before) now logs loudly first.
  **This is inert until `modal deploy` of `video_processing.py`** (same rollout gate as Tbug49p/
  T4420/T7090). Credit formula gained a `compute_export_credits(video_seconds, output_fps=30)`
  helper + `HIGH_FPS_THRESHOLD=31` constant (`highlight_transform.py`) but BOTH live call sites
  (`framing.py`, `multi_clip.py`) still pass `target_fps=30` - Option B ships no native price, so
  this is a byte-identical no-op vs today's `ceil(video_seconds)` (verified by test, not just
  reasoning). **Real Modal GPU-seconds verification of the frame-savings claim is an EXPLICIT
  POST-MERGE STAGING GATE** (Modal is off in /dotask containers, T4180) - structural proof
  (emitted-frame-count < source-frame-count) is covered by `tests/test_t8280_fps_export_choice_repro.py`;
  actual billed-GPU-seconds measurement was NOT and could not be run in-container. True native-fps
  delivery (Option A) remains BLOCKED on `Tbug49p-followup-highlight-transform-fps-units.md`
  landing first (unstarted, deliberately untouched by this task - see export-pipeline.md and
  keyframes-framing.md). New: `tests/test_t8280_fps_export_choice.py`,
  `tests/test_t8280_fps_export_choice_repro.py`.
- ~~**T3950**~~ IMPLEMENTED 2026-07-11: "Made with Reel Ballers" branded outro (~1.75s). NOT in `video_processing.py` — `app/services/branded_outro.py` wired into `overlay.py`'s `final_videos` producers (router layer, both engines, no Modal edit/redeploy). Programmatic `color`+`drawtext` card (bundled font, `fontfile=`), matched to reel res/fps/SAR/pixfmt/audio, concat `-c copy` (re-encode fallback). Flag `BRANDED_OUTRO_ENABLED` (default true). Non-fatal on failure. Render-time only, no persistence. Tests: `test_t3950_branded_outro.py`. See lines 3/42 and export-pipeline.md invariant.
- ~~**T4240**~~ DONE 2026-07-11 (all four recovery bugs fixed — see Landmines above).
- **T4420** (TODO, depends on T4370 harness): one interpolation module packaged into the Modal image; GPU-param on `process_framing_ai` (kills the L4 copy); delete `_optimized.py`. Requires Modal redeploy (ask user).
- **T4430** (TODO, depends on T4370): named encode profiles + single ffprobe.
- **Upscale Quality epic** (`docs/plans/tasks/upscale-quality/EPIC.md`, strict order): T4700 SR testbed (`src/backend/experiments/sr_testbed/`, prime directive: no quality change ships without a testbed run) → T4710 encode/denoise quick wins (crf, bt709, `dni_weight`) → T4720 GAN A/B → T4730 temporal VSR prototype (FlashVSR/SeedVR2, L40S) → T4740 prod integration with crop-size routing → T4750 fine-tune.
- **T7090** (impl 2026-08-16, download-compose to Modal): `compose_serve_time_modal` (CPU, bare-image+app-tree) dispatched by `modal_client.call_modal_compose` / `_get_compose_fn` (mirrors `call_modal_stitch_members`), routed through the `serve_time_video.compose_serve_time_dispatched` seam (Modal-on -> R2-scratch round-trip; ANY Modal error incl. undeployed -> local `compose_serve_time` fallback; Modal-off local is the only in-container path per T4180). The intro-card ffmpeg graph is built by the PURE `app/services/card_compose_plan.build_intro_card_cmd`, shared by the local `_build_card` and the Modal burn (no drift). **Requires `modal deploy app/modal_functions/video_processing.py` before the Modal path works** (else `from_name` raises -> non-fatal local fallback). Live cost/latency/OOM-avoidance + the `/root/app` sys.path/font resolution are a staging-verification gap (unexercisable in-container).
- **T2650** (TODO): move sweep auto-export compute from Fly to Modal.
- Historical: T2480 shipped Catmull-Rom spline crop interpolation on the Modal side (matching frontend curves) — the origin of today's duplicated spline copies; T50/T51 were the original Modal cost/parallelization analyses (parallel overlay rejected as 3-4x costlier, E7).
- Related DONE infra: T1200 (Modal job-id logging + retry), T1520 (disconnect/retry UX reconciling with Modal job state), T2450-T2470 (auto-export reliability: presigned URLs to FFmpeg, pending-status recovery, sweep keepalive).
