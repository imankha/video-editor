# T10360 — A mid-export deploy destroys the export and keeps the credits

**Status:** WIP
**Tier:** M
**Layers:** Backend
**Found by:** live staging incident, 2026-09-18 (sakarati@gmail.com)

## The incident

Job `export_1789761120889_ft6t1st`, staging, user `a580940e-7427-4af6-9d55-a419cf9abf78`,
profile `82a1c218`.

| Time (UTC) | Event |
|---|---|
| 19:52:01 | Focus export created, **11 credits debited** (10.66s of video) |
| 19:52:11 | Dispatched to Modal |
| 19:54:37 | Fly machine `launch` — staging deploy v784 |
| 19:55:05 | New machine started; the export WebSocket died at `frame 210/378 (48%)` — the 48% the user was stuck on |
| 19:56:19 | **Modal finished successfully** and uploaded `working_videos/working_1_9ff78631.mp4` (5.3 MB, confirmed present in R2) |
| 19:58:29 | Backend marked the job `error: "Server restarted during processing"` |

Modal was never the problem. The render completed; the backend threw it away.

## Defect 1 — startup recovery kills dispatched jobs

`export_worker.recover_orphaned_jobs` ran its own ad-hoc Modal liveness check:

```python
call = modal.FunctionCall.from_id(modal_call_id)
try:    call.get(timeout=0); continue      # completed
except TimeoutError: continue              # still running
except Exception as e: ...                 # falls through to "mark as error"
```

Any lookup failure — and for these generator-based function calls the lookup does fail
(`NotFoundError`, reproduced against the incident's own call id) — lands in the third
branch and fails the job. `routers/exports.check_modal_job_running` is the T4240-hardened
three-state version of the identical question and was already doing this correctly; this
was a second, unhardened copy.

The consequence is worse than a wrong status. An errored job is not returned by
`/api/exports/active`, so the frontend never polls `/modal-status` for it — and
`/modal-status` is exactly the code that can recover this case (it HEAD-probes the
persisted `output_key` in R2 and finalizes). Failing the job here *hides a finished
render*.

**Fix:** delegate to `check_modal_job_running`, and never fail a job carrying a
`modal_call_id`. This routine only knows that *this* process didn't render the job; it
cannot see the output, so it cannot tell "died" from "finished while we were
restarting". `/modal-status` can, and the 60-minute stale sweep is the backstop. Only a
job that was never dispatched (no `modal_call_id`) is genuinely dead here.

## Defect 2 — an out-of-band failure never refunds

`confirm_reservation` fires at job creation, so no reservation row survives for
`recover_orphaned_reservations` to release. The only `refund_credits` call lives in the
in-process exception handler, which a SIGKILL'd machine never reaches. Confirmed in
staging Postgres: one `-11 framing_usage` row, no offsetting row, balance 73.

**Fix:** `credit_ledger.refund_export_charge(user_id, export_id)`. The charge is the
source of truth for the amount — `confirm_reservation` wrote exactly one `framing_usage`
row under the deterministic key `export:{export_id}` — so nothing new has to be persisted
on the job row to make a later refund exact (no migration). The grant lands under
`refund:{export_id}`, the SAME key `refund_credits` uses, so it cannot double-refund
whichever path runs second.

Wrapped by `export_helpers.refund_failed_export` (never raises — a money-DB hiccup must
not block reconciling a job to its true status — but logs ERROR, because an unrefunded
failed export is a user-visible money bug). Wired into the three out-of-band sites:
`recover_orphaned_jobs`, `cleanup_stale_exports`, and `update_job_error` (all four of
whose callers are recovery paths).

## Defect 3 (found during review) — call-id recovery has never worked at all

`FunctionCall.get(timeout=0)` reads Modal's OUTPUT store. A generator's only output
is a `GeneratorDone` proto that the in-band consumer expires as it reads it
(`pop_function_call_outputs(clear_on_success=True)`), so a second process gets
`NotFoundError` every time — success, failure, or still running. Verified against the
incident's own call id.

Consequences, all live before this task:
- `check_modal_job_running` returned `None` for every job in the database.
- `/modal-status`'s GeneratorDone + R2-probe branch (T7210) was unreachable; the endpoint
  answered `"expired"` for every recoverable export.
- `/resume-progress` mapped that same `not found` to `update_job_error` — a latent
  job-killer, hidden only because `/modal-status` answered `"expired"` first so the
  frontend never started that loop. Fixing Defect 1 alone would have unmasked it.

**Fix:** `check_modal_job_running` now reads Modal's INPUT record via
`get_call_graph()`, which is not consumed and survives (the incident's id still returns
`SUCCESS` today). All three recovery paths go through one seam,
`reconcile_dispatched_export(job)` → `rendered` | `running` | `dead` | `unknown`, with
**R2 checked first**: a terminal Modal status is not evidence of failure (a successful
generator reports SUCCESS too), so Modal-first would refund users for reels that exist.
`unknown` is never terminal at a call site; only `cleanup_stale_exports`'
`UNKNOWN_MODAL_GIVEUP_MINUTES = 180` may end it, and it refunds when it does — without
that, a job pinned at `processing` blocks its project from ever being re-exported (409
`export_in_flight`) and never returns the credits.

## Tests

`tests/test_t10360_export_restart_recovery.py`:
- a dispatched job stays `processing` whatever Modal answers (True/False/None) — red
  against HEAD with exactly the production symptom
- an undispatched job is failed AND refunded
- a stale job whose render IS in R2 is left to finalize, not swept + refunded
- a permanently-UNKNOWN job is skipped before the give-up age and failed + refunded after
- the sweep refunds only what it swept
- `check_modal_job_running` reads the input record: PENDING → True, every terminal status
  → False, empty graph / API error / another call's graph → None
- `reconcile_dispatched_export` puts R2 ahead of Modal in all four verdicts
- `/modal-status` finalizes a render that is in R2, and reports `running` (never failing)
  for UNKNOWN
- `update_job_error` refunds; the real `refund_failed_export` never raises without a user
  context
- `refund_export_charge`: exact amount, once; no-op on a second call; no-op after the
  in-process handler already refunded; nothing invented for an uncharged export

19 tests; 9 fail against HEAD, all 19 pass with the fix. Curated relevant set (11 files
covering recovery, the ledger, the job repository and the finalize seam): 123 passed.
Two pre-existing tests were corrected rather than worked around: `test_t7210`'s two
GeneratorDone cases pinned SDK behaviour that never happens in production, and two
ad-hoc `export_jobs` test tables needed the real `output_key` column.

## Not in scope

- sakarati@'s own 11 credits and the orphaned R2 object: he is a tester, damages
  deliberately not mitigated (user's call, 2026-09-18).
- The `Could not read frame 319-377` warnings in the Modal log: the scratch source
  declares 378 frames / 12.63s but only 319 decode. Output length (10.66s) matches what
  was charged, so it is cosmetic log noise, not this bug.
