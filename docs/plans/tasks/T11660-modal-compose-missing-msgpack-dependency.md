# T11660: Modal download-compose silently falls back to local (missing `msgpack` dependency)

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-10-02
**Updated:** 2026-10-02

## Problem

Found incidentally while measuring real-R2 latency for T11590: a real dispatch of
`compose_serve_time_modal` on `reel-ballers-video-v2-staging` fails inside the Modal container
with `ModuleNotFoundError: No module named 'msgpack'`, raised while importing
`app.migrations.profile_db.v004_overlay_tuning` (via `app/database.py` -> `app/migrations/__init__.py`
-> `app/migrations/profile_db/__init__.py`). `compose_serve_time_dispatched`'s existing
"ANY Modal error -> fall back to local" design (`serve_time_video.py`) catches this and silently
degrades to the local ffmpeg compose, so every download/share compose on staging has likely been
running local-only, not on Modal, with no visible symptom beyond "slower than it should be" —
exactly the shape of a latent perf regression nobody would notice without tracing the actual
exception.

Whether this also affects PRODUCTION is unknown and should be checked first — same deployed image
family, so plausible, but not confirmed.

## Context

### Likely root cause
`compose_image` (the Modal image `compose_serve_time_modal` runs in,
`app/modal_functions/video_processing.py` per `.claude/knowledge/modal-gpu.md`'s Entry-points
table) is described as "bare `image` + pillow/numpy/pydantic + the WHOLE `app/` tree at
`/root/app`". Importing `app/database.py` pulls in the full migrations package
(`app/migrations/__init__.py` -> every track including `profile_db`), which apparently has a
real dependency on `msgpack` (directly or transitively) that `compose_image`'s pip-install list
doesn't include — unlike the GPU-processing images, which apparently do (T11370's `process_clips_ai`
calibration dispatches hit no such error on the same staging app).

### Relevant Files (REQUIRED)
- `src/backend/app/modal_functions/video_processing.py` — `compose_image` definition (pip_install
  list) and `compose_serve_time_modal` (~:3250 per modal-gpu.md)
- `src/backend/app/services/serve_time_video.py` — `_compose_via_modal`/`compose_serve_time_dispatched`,
  the silent-fallback seam that caught this without surfacing it
- `src/backend/app/database.py` / `app/migrations/__init__.py` / `app/migrations/profile_db/__init__.py`
  — the import chain that pulls in the undeclared dependency

### Related Tasks
- Found during: T11590 (cache composed download/share) real-R2 latency measurement, 2026-10-02
- Relevant for: any task relying on `compose_serve_time_modal` actually running on Modal (T7090)

### Technical Notes
- This is a DEPLOYED-IMAGE gap, not a code-logic bug — likely just needs `msgpack` (or whatever
  the actual missing transitive dependency chain needs) added to `compose_image`'s pip_install
  list in `video_processing.py`, then a staging redeploy + verification, same as any Modal
  function change (`python app/modal_functions/deploy.py` per the project's deploy-first-staging
  convention in `.claude/knowledge/modal-gpu.md`).
- Worth checking whether `compose_image` even NEEDS the full `app/database.py` import chain, or
  whether that's more than `card_compose_plan`/`ffmpeg_concat`/`branded_outro` actually require —
  trimming the import surface may be a more robust fix than just adding `msgpack`, since the next
  missing transitive dependency is the same failure mode again.

## Implementation

### Steps
1. [x] Check whether PRODUCTION's `compose_image` has the same gap (urgent to know regardless of
   fix timing)
2. [x] Confirm root cause: reproduce the exact import chain failure locally/in a scratch Modal
   dispatch
3. [x] Fix `compose_image`'s dependency list (or narrow the import surface) so
   `compose_serve_time_modal` actually runs on Modal
4. [x] Redeploy to staging, verify with a real dispatch (confirm no fallback-to-local log line)
5. [ ] Redeploy to production after staging verification (ask before deploying, per CLAUDE.md
   Modal deploy rules)

### Progress Log

**2026-10-02**: Filed from a real Modal dispatch failure observed while measuring T11590's AC7
latency claim. Not started.

**2026-10-03/04**: Root cause confirmed (import chain `app.services.branded_outro` ->
`app/services/__init__.py`'s eager import of `image_extractor.py` -> module-level
`from ..database import get_highlights_path` -> full `app.database`/`app.migrations` tree ->
`v004_overlay_tuning.py`'s module-level `import msgpack`). Confirmed live on PRODUCTION too via
a diagnostic dispatch against the deployed `reel-ballers-video-v2` app before any fix (same
`ModuleNotFoundError: No module named 'msgpack'`). Fixed by making `image_extractor.py`'s DB
import lazy (`src/backend/app/services/image_extractor.py`), matching the existing pattern in
`clip_cache.py`. Reviewer APPROVED + Proof Verifier VERIFIED (independent red-to-green
reproduction via isolated worktree, confirmed no other eagerly-imported `app.services.*`
submodule has the same gap). Merged PR #556 (`c5644a0a`).

**2026-10-04 (staging deployed + verified, user-approved)**: `python app/modal_functions/deploy.py`
(staging target) succeeded -- `compose_serve_time_modal` listed among the created functions
(`deploy_result.staging.txt`). Verification dispatch against the deployed staging app
(`reel-ballers-video-v2-staging`) with a deliberately nonexistent `reel_key`: the error changed
from the original `ModuleNotFoundError: No module named 'msgpack'` (failing at import time,
before the function body even runs) to `ClientError: 404 Not Found` from R2's `HeadObject` (the
function imported cleanly and executed, failing only on the deliberately-bad input) -- this IS
the Modal container's own execution result, not the backend's fallback log, confirming the fix
works on staging. Production redeploy still needs explicit ask (step 5) before proceeding.

## Acceptance Criteria

- [x] A real `compose_serve_time_modal` dispatch on staging succeeds without falling back to local
      (confirmed via the Modal container's own logs, not just the backend's non-fatal fallback log)
- [ ] Production checked for the same gap; fixed there too if present (confirmed AFFECTED via a
      live pre-fix diagnostic dispatch; the code fix is merged to master but production's
      deployed Modal image still runs the OLD code until step 5's redeploy happens -- not fixed
      on production yet)
- [x] `.claude/knowledge/modal-gpu.md`'s `compose_serve_time_modal` entry updated if the fix
      changes anything about the image/import shape
