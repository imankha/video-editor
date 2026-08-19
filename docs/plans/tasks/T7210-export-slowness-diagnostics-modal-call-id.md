# T7210: Export slowness diagnostics + Modal call_id recovery bug

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

User-reported 2026-08-19: a framing export for `jautomo@yahoo.com` (project 1, clip
`export_1787116043463_x582pkj`) appeared to be taking a very long time. Live investigation
(prod Postgres + SSH into the Fly machine's per-user SQLite + `modal app logs`/`modal container
list`) found the export was genuinely running on a live Modal T4 container the whole time and
completed normally (~17 min, `gpu_seconds=1000.45` — roughly 3x the E6 benchmark anchor's ~334s
estimate for a clip this size, so a real slow render, not a hang). Diagnosing this required
manual cross-referencing across three systems (Postgres, per-user SQLite, Modal's separate log
stream) with no single source showing "is it stuck or just slow" — this task adds that signal
directly, and fixes a real bug found along the way.

## Root Cause (bug #1: export_jobs.modal_call_id never populates)

`modal_client.py`'s `call_modal_clips_ai` (and `call_modal_framing_ai`/`call_modal_overlay`)
check `hasattr(gen, 'object_id')` on the object returned by `<fn>.remote_gen(...)` to capture
Modal's function-call ID for job recovery (`export_jobs.modal_call_id`, read by
`GET /api/exports/{job_id}/modal-status` for reconnect/recovery — see
`.claude/knowledge/modal-gpu.md` "Recovery"). Confirmed via `src/backend/.venv/Lib/site-packages/
modal/_functions.py`: `remote_gen()` (installed SDK 1.3.1) returns a generator that never carries
`.object_id` — that attribute lives on the internal `_Invocation`/`FunctionCall` objects, not on
what callers of `remote_gen()` get back. So `call_id_callback` never fires; `modal_call_id` stays
NULL for every generator-based export, always. Two of the three call sites already know this
("NOT USED with remote_gen" in their docstrings) — only `call_modal_clips_ai` claimed to work and
didn't.

## Solution

- Fix the `modal_call_id` capture per the expert-verified approach (see design note / commit).
- Add diagnosability logging so a future "is this export slow or stuck" question is answerable
  from logs alone, without SSHing into prod + cross-referencing Modal separately:
  - Modal function (`video_processing.py`): per-checkpoint elapsed-time + frames/sec in the
    existing per-15-frame progress log line, so throughput vs. the E6 benchmark anchor is visible
    directly in `modal app logs`.
  - Backend (`modal_client.py`): a `[SLOW MODAL JOB]`-style warning (mirrors the existing
    `[SLOW REQUEST]` pattern) when a job's elapsed time significantly exceeds the expected
    duration for its frame count, visible in Fly logs without needing Modal's separate log
    stream.

## Fix (expert-verified, `.venv` Modal SDK 1.3.1 + synchronicity 0.11.1 source-confirmed)

`remote_gen()` reaches the sync caller through a plain-generator wrapper with no attribute
forwarding — `hasattr(gen, 'object_id')` was unconditionally False, always. `.spawn()` (the other
candidate) raises `InvalidError` for generator functions in this SDK, and `FunctionCall` has no
`get_gen()`. The supported mechanism is `modal.current_function_call_id()`, callable from inside
the running container.

- `video_processing.py`'s `process_clips_ai` now yields `{"modal_call_id": modal.current_function_call_id(), ...}`
  as its first stream item, before entering its main try block (logs a warning if the SDK ever
  returns `None` here, so a silently-broken recovery path doesn't happen quietly again).
- `modal_client.py`'s `call_modal_clips_ai` reads `modal_call_id` off the first stream item inside
  its existing `next(gen)` loop and fires `call_id_callback` once, instead of the dead `hasattr`
  check (also removed from `call_modal_framing_ai`/`call_modal_overlay`, which keep their honest
  "NOT USED with remote_gen" docstrings — no functional change there).
- Diagnosability logging added: per-checkpoint elapsed-time/fps in the Modal upscale loop
  (`video_processing.py`), and a `[SLOW MODAL JOB]` backend warning (`modal_client.py`) when
  elapsed time exceeds ~2x the E6 benchmark anchor for the clip's frame count.

**Two companion fixes the reviewer found were required, or the capture fix would be inert /
actively unsafe:**
- `multi_clip.py`'s `store_modal_call_id` now also persists `output_key` at dispatch time (was
  previously only written later, after upload, at `_persist_rendered_checkpoint`).
- `exports.py`'s `/modal-status` recovery: `FunctionCall.get()` on a *generator* call returns a
  `GeneratorDone` marker, not the dict the function yielded as its last item — naively treating
  "done" as "success" would finalize a row pointing at a **missing** R2 object for a render that
  actually failed inside Modal (its output_key is now written at dispatch, before upload
  completes, so presence alone no longer proves the object exists). Fixed by HEAD-probing R2
  (`file_exists_in_r2`) as the actual success boundary before finalizing; a missing object reports
  a typed error instead.
- Making recovery actually able to finalize (previously it never could — `modal_call_id` was
  always NULL) opened a **second** finder: the in-band export and a recovery poll can now race to
  finalize the SAME job concurrently, double-inserting a `working_videos` row. Closed with a CAS
  claim on `export_jobs.stage` (`_claim_stage_for_finalize` in `export_finalize.py`) — only the
  caller whose stage snapshot still matches the DB gets to proceed into detect/persist; the loser
  (usually the in-band caller, per `multi_clip.py`'s new `_await_concurrent_finalize`) waits
  briefly for the winner's result instead of raising a false failure/credit-refund.

## Context

### Relevant Files
- `src/backend/app/services/modal_client.py` — call_id capture + slow-job warning
- `src/backend/app/modal_functions/video_processing.py` — call_id emit + per-checkpoint elapsed/throughput log
- `src/backend/app/routers/export/multi_clip.py` — output_key persisted with modal_call_id; concurrent-finalize wait
- `src/backend/app/routers/exports.py` — GeneratorDone handling with R2 existence check
- `src/backend/app/services/export_finalize.py` — finalize CAS claim (`_claim_stage_for_finalize`)
- `src/backend/tests/test_t7210_modal_call_id_recovery.py` — regression coverage (new)

### Knowledge Docs
- `.claude/knowledge/modal-gpu.md`
- `.claude/knowledge/export-pipeline.md`

## Acceptance Criteria

- [x] `export_jobs.modal_call_id` is populated for a real Modal generator export
- [x] Modal logs show per-checkpoint elapsed time / fps during the upscale loop
- [x] Backend logs a slow-job warning when a job runs meaningfully past its expected duration
- [x] No change to existing progress-streaming/WebSocket behavior (verified: dispatch-marker item
      is captured and NOT forwarded to progress_callback, avoiding a 5%->0% UI regression)
- [ ] Modal redeploy — **needs user go-ahead**, see below
- [x] Regression tests: call_id capture (with and without the item present, for forward
      compatibility with an un-redeployed Modal function), GeneratorDone + R2-exists ->
      finalizes, GeneratorDone + R2-missing -> errors loudly, never finalizes
- [x] Fresh-context reviewer pass: 2 BLOCKING + 1 MAJOR fixed (R2 existence check, concurrent-
      finalize race), all closed and covered by tests; 3 MINOR polish items applied (progress
      regression, dead-flag cleanup, silent-None warning)

## Deploy note

This fix requires `modal deploy app/modal_functions/video_processing.py` to take effect — until
redeployed, the currently-deployed Modal function doesn't emit the `modal_call_id` stream item, so
`modal_call_id` stays NULL exactly as before (verified safe/no-crash by the "no call_id item"
regression test). The backend-side changes (GeneratorDone handling, CAS race guard, slow-job
warning) are live immediately on merge regardless of the Modal redeploy.
