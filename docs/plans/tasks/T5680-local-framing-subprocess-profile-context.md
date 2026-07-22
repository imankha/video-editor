# T5680: Local framing render subprocess loses profile context

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-07-22
**Type:** Bug (local-render infra) — mirror of the overlay fix (T5250 commit `4c40e2ce`)

## Problem

Same class as the overlay subprocess bug: when `MODAL_ENABLED=false`, the LOCAL framing render runs
`_framing_sync` (`src/backend/app/services/local_processors.py:579`) in a `ProcessPoolExecutor`
child (T2640). ContextVars do NOT cross the process boundary, so `download_from_r2` / `upload_to_r2`
-> `r2_key` -> `get_current_profile_id()` raises `RuntimeError: Profile ID not set` for non-`games/`
inputs (e.g. `working_videos/...`). Only the `games/` streaming path (presigned-URL-global) is
unaffected. Nobody hits it normally because dev uses Modal; it surfaces the moment framing exports
locally.

## Fix (mirror T5250 commit `4c40e2ce` exactly, framing chain)

1. **`src/backend/app/services/local_processors.py`** — `_framing_sync`: add param
   `profile_id: str | None = None`. At the TOP of the body, before any R2 call:
   ```python
   # ContextVars don't cross the process boundary — re-establish the profile context the
   # R2 key builder needs (this runs in a ProcessPoolExecutor child, T2640).
   if profile_id:
       from app.profile_context import set_current_profile_id
       set_current_profile_id(profile_id)
   ```

2. **`src/backend/app/services/modal_client.py`** — `call_modal_framing_ai` (~line 489): add param
   `profile_id: str | None = None`; in the MODAL-OFF branch (the `_run_in_subprocess(_framing_sync,
   {...})` at ~line 555) add `"profile_id": profile_id` to the kwargs dict.

3. **Thread `profile_id` from the caller** — find who calls `call_modal_framing_ai` (the framing
   export background path; `src/backend/app/routers/export/framing.py` already captures
   `captured_profile_id = get_current_profile_id()` ~L357 and passes `profile_id` into its background
   function ~L498/L520). Pass `profile_id=profile_id` into the `call_modal_framing_ai` call. If there
   are intermediate wrappers (e.g. `call_modal_framing_auto`-style), add the param + forward it, same
   as the overlay chain did through `call_modal_overlay_auto`.

Use `str | None = None` (NOT `str = None`) to avoid a new RUF013. Do NOT touch the pre-existing lint
backlog in these files.

## Verify
- `from app.main import app` imports.
- Add/extend a test (mirror `test_subprocess_isolation.py`'s `test_overlay_sync_sets_profile_context_from_arg`)
  proving `_framing_sync` sets the profile context from its `profile_id` arg.
- Run `pytest tests/test_subprocess_isolation.py` (+ any framing/local-processor tests).
- `ruff` on the changed files — no NEW errors vs the pre-existing backlog.

## Acceptance criteria
- [ ] Local framing export (`MODAL_ENABLED=false`) no longer raises `Profile ID not set`.
- [ ] `profile_id` is threaded caller -> `call_modal_framing_ai` -> `_framing_sync` and set in the child.
- [ ] Test proves the child sets the profile context; import + ruff clean (no new errors).
- [ ] Modal path unchanged (profile_id only used by the local subprocess branch).
