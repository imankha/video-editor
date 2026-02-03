# Framing Upscale Modal Migration (B2)

**Status**: `DONE` (2026-01-29)
**Priority**: Was BLOCKING - Now Complete

---

## Status Update

This task is **COMPLETE**. The `/export/render` endpoint already uses Modal via `call_modal_framing_ai` when `MODAL_ENABLED=true`.

### Evidence (from code review 2026-01-29)

File: `src/backend/app/routers/export/framing.py:931`
```python
modal_result = await call_modal_framing_ai(
    job_id=export_id,
    user_id=user_id,
    input_key=input_key,
    output_key=output_key,
    keyframes=keyframes_dict,
    ...
)
```

### Key Finding

All framing exports go through the `/export/render` endpoint which calls `process_framing_ai` on Modal when `MODAL_ENABLED=true`.

There is no separate "FFmpeg-only" framing path - the `process_framing` function was dead code and has been removed.

---

## Original Task (For Reference)

The original task was to add Modal support to `/export/upscale`. This was already implemented as part of the `/export/render` backend-authoritative approach.

---

## What Was Removed (Dead Code Cleanup)

During the 2026-01-29 investigation:
- `process_framing` Modal function (never called)
- `call_modal_framing` client function (never called)
- `process_framing_with_modal` helper (never called)

All framing now correctly uses `process_framing_ai` (Real-ESRGAN AI upscaling).
