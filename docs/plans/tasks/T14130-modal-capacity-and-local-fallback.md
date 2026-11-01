# T14130: Modal capacity limits and the local compose fallback

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** S
**Created:** 2026-10-31
**Updated:** 2026-10-31

Source: 10K-user readiness audit, 2026-10-31 (expert agent, claims spot-checked in code). Assumed load at 10K registered: ~1,000 daily actives, ~100 concurrent sessions at evening/weekend peak, bursts of concurrent uploads and exports after games.

## Problem

No `max_containers` is set on the Modal functions, and any framing clip of 10 s or more fans out to 4 T4 GPUs (`services/modal_client.py` ~465-469), so a workspace GPU cap of N runs only about N/4 framing exports at once; the rest queue (which today holds threads, T14100). `serve_time_video.py` ~250-262 falls back to LOCAL ffmpeg on ANY Modal error; that render peaked at 1.7 GB (OOM-killed on the old 1 GB VM, per the fly.toml comment). During a Modal outage at peak, a few concurrent local fallbacks exceed the 2 GB VM, and the OOM kill takes down the whole process along with everyone's pending syncs (no shutdown sync on SIGKILL; see T14150).

## Solution

Record the Modal plan's GPU concurrency limit in modal-gpu.md, set explicit `max_containers`, and allow at most ONE local compose fallback at a time (others fail visibly with a retryable error). Feeds the T14100 semaphore size.

## Context

### Relevant Files
- `src/backend/app/services/modal_client.py`
- `src/backend/app/modal_functions/` (max_containers)
- `src/backend/app/services/serve_time_video.py`
- `.claude/knowledge/modal-gpu.md`

### Notes
Load: modal-gpu.md. Modal function changes need a staging-then-prod Modal deploy (src/backend/CLAUDE.md).

## Acceptance Criteria

- [ ] Modal GPU limit documented; max_containers set
- [ ] A test proves a second concurrent local fallback is refused, not started
- [ ] Submitting 2x the GPU limit of exports on staging keeps `/api/health` fast (with T14100)
