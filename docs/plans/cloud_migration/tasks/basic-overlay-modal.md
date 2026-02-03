# Basic Overlay Modal Migration (B3)

**Status**: `DONE` (2026-01-29)
**Priority**: Was BLOCKING - Now Complete

---

## Status Update

This task is **COMPLETE**. The overlay export endpoint already uses Modal via `call_modal_overlay_auto` when `MODAL_ENABLED=true`.

### Evidence (from code review 2026-01-29)

File: `src/backend/app/routers/export/overlay.py:1233-1251`
```python
if modal_enabled():
    # ... progress callback setup ...
    result = await call_modal_overlay_auto(
        job_id=export_id,
        user_id=user_id,
        input_key=input_key,
        output_key=output_key,
        highlight_regions=highlight_regions,
        effect_type=effect_type,
        video_duration=source_duration,
        progress_callback=modal_progress_callback,
    )
```

### Key Finding

The overlay endpoint has full Modal integration with:
- `modal_enabled()` check
- Progress callbacks
- Auto-selection between sequential and parallel processing
- Proper error handling

---

## Experiment Results (E3, E7)

The Modal overlay implementation was tested during experiments E3 and E7:

| Finding | Result |
|---------|--------|
| CPU overlay | NOT viable - times out after 10 minutes |
| Parallel overlay | Costs 3-4x MORE than sequential |
| Sequential GPU overlay | Optimal configuration |

The current implementation uses `call_modal_overlay_auto` which correctly defaults to sequential processing (parallel is available but not cost-effective).

---

## No Changes Needed

The overlay Modal integration is complete and working. The only remaining tasks are:
1. E6: Test if L4 GPU is better than T4
2. E2: Fix FFmpeg frame reading (separate bug)
3. B1: Multi-clip integration (only remaining integration work)
