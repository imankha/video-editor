# T11660: Modal download-compose silently falls back to local (missing `msgpack` dependency)

**Status:** TODO
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
1. [ ] Check whether PRODUCTION's `compose_image` has the same gap (urgent to know regardless of
   fix timing)
2. [ ] Confirm root cause: reproduce the exact import chain failure locally/in a scratch Modal
   dispatch
3. [ ] Fix `compose_image`'s dependency list (or narrow the import surface) so
   `compose_serve_time_modal` actually runs on Modal
4. [ ] Redeploy to staging, verify with a real dispatch (confirm no fallback-to-local log line)
5. [ ] Redeploy to production after staging verification (ask before deploying, per CLAUDE.md
   Modal deploy rules)

### Progress Log

**2026-10-02**: Filed from a real Modal dispatch failure observed while measuring T11590's AC7
latency claim. Not started.

## Acceptance Criteria

- [ ] A real `compose_serve_time_modal` dispatch on staging succeeds without falling back to local
      (confirmed via the Modal container's own logs, not just the backend's non-fatal fallback log)
- [ ] Production checked for the same gap; fixed there too if present
- [ ] `.claude/knowledge/modal-gpu.md`'s `compose_serve_time_modal` entry updated if the fix
      changes anything about the image/import shape
