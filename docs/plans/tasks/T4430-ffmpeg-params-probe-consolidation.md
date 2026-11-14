# T4430: One video probe

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-07-03
**Updated:** 2026-11-13

## In plain words

Eighteen places on the server ask a video file for its frame rate and size, in about eight different ways, and several quietly assume 30 frames a second when the question fails. Keep one that reports failure loudly. In the same task, remove an encoder flag that can cut a Spotlight video short when it is rendered on a developer machine; production is already fixed. Runs after T11250 and the deletions above, which remove more than half of these places.

## Implementer details

- The '30/1' default is in `ai_upscaler/__init__.py`, `services/ffmpeg_service.py`, `services/video_probe.py`, `services/ffmpeg_concat.py` and `routers/export/before_after.py`. `before_after.py` and `routers/export/framing.py` call `eval()` on ffprobe output; remove that.
- One `probe_video()` that raises, replacing the app-side copies. The Modal file keeps its own copy by policy.
- `-shortest` on the raw-video pipe is still in `_process_frames_to_ffmpeg` in `routers/export/overlay.py`, the non-Modal Spotlight renderer. Remove it as an isolated commit with a golden-output check.
- Not in scope: named encode profiles across modules; the quality tiers that differ today are intentional.
- Knowledge docs: `.claude/knowledge/export-pipeline.md`, `.claude/knowledge/modal-gpu.md`.

## Acceptance Criteria

- [ ] One probe function is used by all app-side callers and raises when the file cannot be read; no caller substitutes 30.
- [ ] No `eval()` of ffprobe output remains.
- [ ] A locally rendered Spotlight video has the same length as its input.
