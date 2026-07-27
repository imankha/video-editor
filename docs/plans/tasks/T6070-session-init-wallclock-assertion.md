# T6070: Replace test_session_init_recovery's wall-clock assertion with a deterministic one

**Status:** TODO
**Impact:** 4
**Complexity:** 1
**Created:** 2026-07-27
**Found by:** the T5970/T6030 container runs — it produced a false regression alarm twice in one day

## What is wrong

`tests/test_session_init_recovery.py::TestRunningLoopPath::test_create_task_branch_propagates_context_and_does_not_block`
proves fire-and-forget by timing the wall clock:

```python
async def _spy(user_id: str):
    await asyncio.sleep(0.2)          # a blocking caller would be obvious
    ...
    gate.set()

with patch("app.session_init._run_startup_recovery", _spy):
    started = time.perf_counter()
    user_session_init(uid)
    elapsed = time.perf_counter() - started

assert elapsed < 0.1, f"user_session_init blocked for {elapsed:.3f}s — create_task should be fire-and-forget"
```

The intent is right: `user_session_init` must not await the background task. But the assertion
measures **total** time, and `user_session_init` also does real work — profile resolution, DB
restore, Postgres reads. On a workspace with an accumulated test DB that legitimately exceeds
100 ms (observed 1.046 s, with `[SLOW QUERY] db=profile 146ms INSERT INTO export_jobs` in the same
run), so the test fails while the property it is guarding is **still perfectly satisfied**.

Proven environment-only on 2026-07-27: passes on clean master on the host (4/4), passes at base
commit inside the same container (4/4), and passes with the changed files copied into a clean
worktree (4/4) — it only fails in a workspace with accumulated state.

**Cost:** it burned a triage cycle on T5970 and again on T6030, each time requiring a three-way
bisect to prove "not mine". A test whose failure is 100% uncorrelated with the code under test is
worse than no test — it trains everyone to ignore a red suite.

## What to do

Assert the **property**, not the duration. The spy already exposes exactly the right signal: if
`user_session_init` had awaited the background task, the spy would have completed. So immediately
after `user_session_init(uid)` returns, the spy must NOT yet have run:

- `assert not gate.is_set()` (and/or `assert "user_id_arg" not in observed`) — true regardless of
  how slow the surrounding real work is, and false exactly when the fire-and-forget property breaks.

Then keep the existing drain (`await asyncio.wait_for(gate.wait(), timeout=2.0)`) and the context
assertions that follow — those are the valuable half and must stay.

Check the sibling tests in the same file for the same wall-clock pattern and fix any others you find.

## Watch out for

- **Verify the new assertion actually fails when the property breaks.** Temporarily make
  `user_session_init` `await` the recovery instead of `create_task`-ing it, confirm red, revert.
  Without that, you have replaced a flaky test with a vacuous one — which is the failure mode this
  task exists to prevent.
- Do not weaken the timing budget (e.g. `< 2.0`) instead. That keeps the flake and hides the
  property.
- Do not delete the test. The fire-and-forget behaviour is real and was deliberately introduced.

## Acceptance criteria

1. The wall-clock `assert elapsed < 0.1` is gone, replaced by a state-based assertion of the same
   property.
2. Evidence the new assertion goes RED when `user_session_init` is made to await the task, and
   green when reverted.
3. `tests/test_session_init_recovery.py` passes on a workspace with accumulated state — the exact
   condition that made the old one fail.
4. Any sibling wall-clock assertions in the file are named, and either fixed or justified.
