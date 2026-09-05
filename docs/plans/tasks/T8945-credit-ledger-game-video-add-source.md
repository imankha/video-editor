# T8945: Credit ledger never registered "game_video_add" as a source (500 -> "Failed to fetch")

**Status:** STAGING
**Impact:** 9
**Complexity:** 1
**Created:** 2026-09-05
**Follows:** T8940 (its ordering fix is what finally made this code path reachable)

## Problem

After T8940's fix (activate the game after video 1, before attaching video 2+), the user
retried a multi-file upload and it progressed further but still failed, this time with a
raw browser network error: `TypeError: Failed to fetch` (not a structured backend error —
T8935's `extractErrorMessage` never even engaged, since `fetch()` itself rejected before a
response existed).

Staging server logs (captured live, immediately after the report) showed the real cause:

```
File "/app/app/routers/games.py", line 649, in add_game_videos
    result = deduct_credits(user_id, cost, source="game_video_add", reference_id=reference_id)
File "/app/app/services/credit_ledger.py", line 629, in deduct_credits
    key = credit_key(source, reference_id)
File "/app/app/services/credit_ledger.py", line 100, in credit_key
    raise ValueError(f"[CreditLedger] no idempotency-key prefix registered for source={source!r}")
ValueError: [CreditLedger] no idempotency-key prefix registered for source='game_video_add'
```

`add_game_videos` (T8700's hardened attach endpoint) has ALWAYS called
`deduct_credits(..., source="game_video_add", ...)`, but `game_video_add` was never added
to `credit_ledger.py`'s `KEY_PREFIX` registry. `credit_key()` raises `ValueError` for any
unregistered source by design ("that is a programming error, not a runtime one") — this
uncaught exception is what produced the 500 the client experienced as a raw connection
failure.

**This was unreachable until T8940 shipped.** Before T8940's fix, `add_game_videos` always
409'd (`game_not_ready`) before ever reaching the credit-charging code for a create-time
multi-file upload — so this registration bug has been dormant since T8700 shipped, and
T8940 is what finally let a real request reach it.

## Solution

Register `"game_video_add": "game_video_add"` in `KEY_PREFIX` (`credit_ledger.py`) — a
distinct prefix from `activate_game`'s own `"game_upload"` source, so the two never
collide on the same reference_id shape (matches the file's existing convention of several
sources using their own name as the prefix, e.g. `game_upload`, `clip_upload`).

## Relevant Files

- `src/backend/app/services/credit_ledger.py` — `KEY_PREFIX`
- `src/backend/tests/test_credit_ledger.py` — `TestCreditKey::test_game_video_add_is_registered`

## Acceptance Criteria

- [x] A red test (`credit_key("game_video_add", ...)` currently raises `ValueError`) was
      written and confirmed failing BEFORE the fix, reproducing the exact server-side
      exception from the staging logs
- [x] Same test passes after registering the source
- [x] Full `test_credit_ledger.py` suite green (39 tests, real Postgres)
- [x] Backend imports cleanly

## Follow-up

Ask the user to retry the multi-file upload once this deploys. This SHOULD be the final
fix in the T8930/T8935/T8940/T8945 chain — but given how many layers this upload path has,
confirm end-to-end before assuming so.
