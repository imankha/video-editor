# T4240: Export Recovery Bugs — NameError on Success, Live Jobs Marked Dead, Fabricated Filenames

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) items A1 + A10-export)

## Problem

**Exposure: export recovery runs whenever a user's connection/tab drops during a GPU export — paid (credits) monetization path where "my export vanished" is maximum-frustration.**

Four related defects in the Modal export recovery chain, all in the "silent fallback / swallowed error" family:

1. **[FIXED by T4790, 2026-07-10]** ~~Every successful recovery reports failure.~~ The undefined `presigned_url` key was removed (URLs are generated on-the-fly, not stored) with a regression test (`tests/test_t4790_undefined_name_bugs.py`). The bare `except Exception` narrowing below is still open. Original finding: `finalize_modal_export` commits the recovered export to the DB, then crashes with `NameError` on an undefined variable — which the function's own `except Exception` converts into `{"finalized": False, "error": "name 'presigned_url' is not defined"}`. Callers treat a **committed** recovery as failed, and the `record_milestone` call never fires.
2. **A Modal API hiccup can kill a LIVE export.** The is-it-running check returns `False` (= "not running") on any Modal API error, and `cleanup_stale_exports` then marks the live job as error.
3. **Fabricated output filename.** When a Modal result lacks `output_key`, recovery invents `recovered_{job_id}.mp4` — a working_videos row pointing at an R2 object that doesn't exist.
4. **The error handler itself can NameError.** `export_worker`'s except block reads variables (`config`/`job_type`/`project_id`) that are assigned inside the `try` — a decode failure crashes the error handler.

## Root Cause (verified)

- `src/backend/app/routers/exports.py:279` — `"presigned_url": presigned_url` returned; never assigned in the function (comment at `:248` even says "presigned_url generated on-the-fly, not stored"). Bare `except Exception` at `:282-287` masks it. Callers: `check_modal_status` (~`:856`), `resume_progress` (~`:1080`).
- `exports.py:296-309` — Modal status probe: API error → `return False`; consumed by `cleanup_stale_exports` (~`:352-359`).
- `exports.py:216` — fabricated `recovered_{job_id}.mp4`.
- `src/backend/app/services/export_worker.py:198-204` — except block references try-scoped variables.

## Solution

1. **Fix the return.** First check what consumers actually use: `grep -rn "presigned_url" src/frontend/src` for the finalize/resume response paths. If the frontend uses it, generate it (`generate_presigned_url` — see backend CLAUDE.md R2 section) from the working video's R2 key; if nothing consumes it, delete the key from the response. Then **narrow the except**: catch only expected DB errors, log with `exc_info=True`, and let programming errors propagate (a 500 with a stack trace beats a fake "not finalized").
2. **Three-state status probe.** Return `True` / `False` / `None` ("unknown — API error"). `cleanup_stale_exports` must SKIP jobs with unknown status (log and try next sweep), never mark them error. Killing a paid job requires positive evidence it's dead.
3. **No fabricated filenames.** Missing `output_key` → recovery fails loudly for that job (mark error with a message saying the Modal result was incomplete). Never insert a DB row pointing at a nonexistent R2 object.
4. **Fix except-block scoping** in export_worker: initialize the variables before the `try` (or restructure so the handler only touches what's guaranteed bound).

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/exports.py` — `finalize_modal_export`, status probe, `cleanup_stale_exports`, recovery path
- `src/backend/app/services/export_worker.py` — the except block
- Frontend consumers of finalize/resume responses (grep before changing response shape)

### Related Tasks
- Future E1 (ExportJobRepository) will consolidate the status writes this task touches — keep this task surgical (fix the four defects in place); do NOT start the repository refactor here.

### Technical Notes
- Reproducing test for #1 is trivial: call `finalize_modal_export` with a valid completed job fixture; on old code it returns `finalized: False` despite committing — assert `finalized: True` AND the DB row exists.
- For #2, mock the Modal client to raise; assert the job's status is untouched after `cleanup_stale_exports`.

## Implementation

### Steps
1. [ ] Tests first for all four (each is a small, independent repro).
2. [ ] Fix in order 1 → 4; keep each fix its own commit.
3. [ ] `python -c "from app.main import app"` + backend tests.
4. [ ] Manual verify (dev): start a local export, kill the tab, reopen — recovery completes AND reports success.

## Acceptance Criteria

- [ ] A committed recovery returns `finalized: True` and fires `record_milestone`
- [ ] Modal API errors never cause a live job to be marked error
- [ ] No DB row is ever created with a fabricated filename
- [ ] export_worker's error handler cannot itself raise NameError
- [ ] All four reproducing tests would fail on old code
