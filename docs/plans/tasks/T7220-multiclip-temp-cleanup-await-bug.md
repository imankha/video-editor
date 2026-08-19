# T7220: Multi-clip temp-source cleanup awaited a sync function

**Status:** WIP
**Impact:** 2
**Complexity:** 1
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

Found live in staging logs while verifying T7210: every multi-clip Modal export logged
`[Multi-Clip Export] Failed to delete temp file .../source_0.mp4: object bool can't be used
in 'await' expression` — every single time, even though the R2 `DeleteObject` call visible
just above it in the logs succeeded (204).

## Root Cause

`multi_clip.py:1437` did `await delete_from_r2(user_id, source_key)`, but `delete_from_r2`
(`storage.py:781`) is a plain synchronous function (`-> bool`), not a coroutine — every other
call site in the codebase (`overlay.py`, `clips.py`, `poster.py`) calls it without `await`.
Python executes the function body immediately (so the delete genuinely happens), then
`await <bool>` raises `TypeError`, caught by the surrounding `try/except` and logged as a
false "failed to delete" warning. Purely cosmetic in practice (the delete already succeeded)
but pollutes logs every export and would be indistinguishable from a REAL delete failure if
one ever occurred. Existing tests (`test_t4200`, `test_t5600`, `test_t5630_characterization`)
mocked `delete_from_r2` as `async def fake_delete` specifically to make the buggy `await` not
crash — masking the mismatch between the mock and the real (sync) function signature.

## Solution

- `multi_clip.py`: `await asyncio.to_thread(delete_from_r2, user_id, source_key)` — matches
  the existing pattern used a few lines earlier in the same function for `upload_bytes_to_r2`
  (blocking R2 I/O offloaded off the event loop, not called bare-synchronously in an `async def`).
- Fixed the 3 test mocks to be plain sync functions, matching `delete_from_r2`'s real contract.
- Added a regression assertion (`test_t4200_framing_multiclip_durability.py::test_sync_ok_announces_complete`)
  that no "Failed to delete temp file" warning is logged during a successful export — verified
  it fails with the exact original error message when the production fix is reverted.

## Context

### Relevant Files
- `src/backend/app/routers/export/multi_clip.py`
- `src/backend/tests/test_t4200_framing_multiclip_durability.py`
- `src/backend/tests/test_t5600_export_persists_detections_data.py`
- `src/backend/tests/test_t5630_characterization.py`

## Acceptance Criteria

- [x] Temp source cleanup no longer logs a false "failed to delete" warning on success
- [x] Test mocks match the real (sync) `delete_from_r2` contract
- [x] Regression test added and verified to fail on the reverted code
- [x] No change to real deletion behavior (delete already worked; only the bogus post-hoc
      exception is gone)
