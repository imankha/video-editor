# T16610: The /dotask loop crashed with a TypeError and left no traceback

**Status:** STAGING
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-15
**Updated:** 2026-11-15

## Problem

On 2026-11-15 at 17:37 the headless /dotask loop for group g-t11180-4 stopped with this status line and nothing
else: `LOOP_CRASHED TypeError: unsupported operand type(s) for +: 'NoneType' and 'NoneType'`. The group (four
tasks, in verify round 3) sat stopped until a person resumed it hours later, and the resume then stopped again
on `VERIFY_BLOCKED round 3: stack did not start (exit 3840)`. The group's PR had already merged by then.

We cannot tell where the crash is. The loop writes only the one-line message to the status file; the traceback
is not in the run log, the status file or the group file, so the cause cannot be found afterwards. Somewhere the
loop adds two numbers that can both be missing. The ETA and verify-budget code add times read from the group file
(`verify_spent_s` and timed-dispatch records), which is where this most likely is.

A second, different crash the same day was a GitHub push rejection on g-t2650-1 (the push was refused with no
reason and a retry worked). That one was fine to lose, but the loop also gave no hint it was transient.

## Solution

1. Make the loop write the full traceback to the group's run log whenever it ends in `LOOP_CRASHED`, so any crash
   can be found afterwards. Keep the one-line status as it is.
2. Find the addition of two possibly-missing values, using the saved group state of g-t11180-4 (its group file,
   verify files and dispatch records under `C:\work\tasks\profiles\g-t11180-4` and the checkout's `.dotask-*`
   files) to reproduce it, and make it treat a missing value as zero, or skip the entry, with a test that fails
   before the fix.
3. Have the loop retry a push once after a refusal that gives no reason, before it calls the loop crashed.

Land it between runs: live groups use these scripts.

## Why

A loop that stops silently costs hours (this one stopped for four) and the cause is lost each time. The fix to the
logging is what lets the next crash be found in minutes.

## Relevant Files

- `scripts/dotask_cli.py`
- `scripts/dotask.sh`
- `scripts/task.sh`
- `scripts/test_dotask_cli.py`

## Acceptance Criteria

- [ ] C1: A test makes the loop raise inside its main step and checks that the group's run log then holds the full
  traceback, with the status line unchanged.
- [ ] C2: A test feeds the code that adds times (ETA and verify budget) a group file with missing values and gets a
  number, not a TypeError. It fails on the code before this change.
- [ ] C3: A test makes the push step fail once with a refusal that has no reason and then succeed, and the loop
  carries on instead of stopping.
