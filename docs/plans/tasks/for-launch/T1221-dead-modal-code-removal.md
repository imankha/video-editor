# T1221: Remove Dead Modal Functions Discovered During T1220 Audit

**Status:** TODO
**Impact:** 3
**Complexity:** 2
**Created:** 2026-04-14

## Context

During the T1220 caller-trace audit, three Modal functions were confirmed to have **no production callers** (no router invokes their `modal_client.py` wrappers; only definitions + one smoke test exist). They were left in place for T1220 to keep that diff scoped to R2 range-request changes.

## Dead code to remove

In [src/backend/app/modal_functions/video_processing.py](src/backend/app/modal_functions/video_processing.py):

1. `extract_clip_modal` (was around line 992) — FFmpeg clip extraction. No UX path extracts clips anymore.
2. `extract_clip_modal` (duplicate definition, was around line 2746) — same name, separate body. Dead.
3. `process_multi_clip_modal` (was around line 2094) — multi-clip processor. Superseded by `process_clips_ai`.
4. `create_annotated_compilation` (was around line 2434) — annotated-compilation generator. No caller.

In [src/backend/app/services/modal_client.py](src/backend/app/services/modal_client.py):

5. `call_modal_extract_clip` wrapper (was around line 1525) + `_extract_clip_fn` loader (L399-412).
6. `call_modal_multi_clip` wrapper (was around line 950).
7. Any `call_modal_annotated_compilation` wrapper if present — grep to confirm.

In [src/backend/tests/test_save_raw_clip.py](src/backend/tests/test_save_raw_clip.py):

8. Remove or rewrite the `call_modal_extract_clip` smoke test at line ~32-36 (currently only asserts the function is callable — delete with the function).

Doc strings / `__init__.py` references:

9. [src/backend/app/modal_functions/__init__.py](src/backend/app/modal_functions/__init__.py) lines 10-11 — update the module docstring.
10. `video_processing.py` lines 14-15, 3389-3390 — update the "Available functions" module docstring and the `__main__` block's list.

## Why separate from T1220

- T1220's diff was already large (3 agents, real timestamp rebasing). Keeping dead-code deletion out kept the migration reviewable.
- Deleting the Modal functions requires a Modal redeploy to remove them from the deployed app; sequencing that after T1220's staging validation is safer.

## Acceptance

- Grep in `src/backend/app/` (excluding `tests/`) for each removed symbol → zero matches.
- `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"` passes.
- `modal deploy` succeeds (functions removed cleanly from deployment).
- `pytest` passes with the removed/updated smoke test.

## Out of scope

- Any architectural change to the surviving Modal functions — T1220 handled those.
