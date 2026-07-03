# T4430: FFmpeg Encode-Params + Probe Consolidation

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-07-03
**Source:** Audit item E3 ([audit doc](../audit-2026-07-03-code-quality.md)) · Depends on T4370 (render goldens); pairs with T4420

## Problem

~55 FFmpeg argument lists are built from scratch across 13 modules, and they have **already drifted into output bugs**:

- The libx264 finalize block (`-c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 -c:a aac -b:a 192k -movflags +faststart`) is repeated 15+ times in `modal_functions/video_processing.py` alone — which factored it out at :2347 (`_build_simple_ffmpeg_cmd`) and then six inline variants (:1478-1584) ignore its own helper.
- **`-shortest` drift (a live output-correctness split):** `video_processing.py:474-476` documents why `-shortest` was deliberately REMOVED (truncation bug); `export/overlay.py:707` and `processor_local.py:252` still pass it (processor_local also lacks `yuv420p`/`faststart` — playback-compat risk).
- CRF drift with no named constants: local quality crf 18 (`ffmpeg_service.py:181-184`), Modal crf 23, transitions crf 18 (`transitions/cut.py:81`, which also reimplements `ffmpeg_service.concatenate_with_*` :389-650), recap crf 32 (`auto_export.py:354`).
- ffprobe metadata extraction exists 6+ ways (ffmpeg_service.py:264/:287, video_probe.py:24/:69, video_processing.py:1241/:2110, local_processors.py:61, auto_export.py:156/:362), each re-parsing `r_frame_rate` with its own "30/1" default.

## Solution

1. **`app/encode_params.py`** (importable by BOTH the backend and the Modal image — same packaging mechanism as T4420): named encode profiles (`FINALIZE_H264`, `INTERMEDIATE_RAWVIDEO_PIPE`, `RECAP_PROXY`, ...) each returning an args list; named CRF constants WITH a comment stating why each value (18 local quality / 23 Modal / 32 recap proxy are possibly-deliberate tiers — confirm each against git history before unifying; deliberate differences stay, as named profiles).
2. **`-shortest` resolution:** the documented-correct behavior (removed) wins; migrating overlay.py:707 + processor_local.py:252 is a BEHAVIOR change — its own commit, justified by the :474 comment, verified by render goldens.
3. **One probe:** `probe_video(path) -> {duration, width, height, fps, ...}` consolidating the 6 implementations; probe failure RAISES (T4280's rule — no "30/1" defaults).
4. Migrate call sites module-by-module (13 modules — one commit each), transitions/cut.py adopts `ffmpeg_service.concatenate_with_*` or vice versa (pick the maintained one; check callers).

## Context

- Render goldens (T4370) are the safety net; Modal redeploy needed (ask user).
- The audit sized this L with med-high risk: the risk concentrates in step 2 (-shortest) and any accidental CRF unification — everything else is mechanical.
- Vendored `ai_upscaler/rife` is OUT of scope.

## Steps

1. [ ] Inventory: script-assisted grep of all ffmpeg arg construction → table (site → profile it maps to → divergences). This table IS the design review artifact.
2. [ ] encode_params module + probe fn + unit tests (args snapshots, probe failure raises).
3. [ ] Mechanical migration commits against render goldens; the -shortest commit isolated with before/after golden diff attached.
4. [ ] Modal redeploy (ask first) + staging export verification.

## Acceptance Criteria

- [ ] No inline libx264 blocks; every encode references a named profile
- [ ] `-shortest` gone from the rawvideo overlay pipe everywhere (the documented truncation fix applies to all 4 sites)
- [ ] One probe function; probe failure raises
- [ ] Render goldens green (except the attached, reviewed -shortest diff)
- [ ] CRF values named, with each tier's rationale recorded
