# T16110: A /dotask group stopped by a sign-in failure recovers on its own

**Status:** WIP
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-12

## In plain words

**Today.** Before each worker conversation, the harness checks that the container's Claude sign-in works. It retries 3 times, 20 seconds apart, re-copying the host's credentials each time. If all three fail, it writes `AUTH_DEAD` to the group's status and the group stops until someone runs `/dotask resume`.

**The problem and how we got here.** Nobody is told when that happens. On 2026-11-11, g-t16090-1 (T16090) hit AUTH_DEAD at 16:44 and did nothing until the owner asked for a status at 17:52; a plain resume then worked first time. The 20-second retries were added after 2026-11-07/08 because every AUTH_DEAD so far had cleared on a plain resume. That is still true, so the retries are too short rather than wrong: whatever breaks the sign-in (a token mid-refresh on the host, a slow container) lasts longer than a minute.

**What we will do.** When the sign-in check fails all its tries, the loop waits longer and tries again by itself (for example after 2, 5 and 10 minutes) before giving up, writing a status line each time so the run log shows it. If it still fails, the group stops as today, and `status` names it as a stop that needs a person.

**Why this and not something else.** Resuming by hand is the only known fix, and it has never failed. Waiting and resuming automatically does the same thing without a person, and a bounded number of tries keeps a really dead sign-in from looping forever.

**How we will know it worked.** A group whose sign-in fails for a few minutes carries on without anyone running `resume`, and its log shows the waits. A sign-in that stays broken still stops the group, with a clear status line.

## Evidence

- g-t16090-1 status file: `2026-11-12T00:44 AUTH_DEAD auth status failed 3 times`, then nothing until the manual `dotask.sh resume` at 01:52 UTC (17:52 local), which passed the sign-in check at once.
- `scripts/task.sh` ~line 321: the retry loop (`DOTASK_AUTH_TRIES`, default 3; `DOTASK_AUTH_WAIT`, default 20 s).
- `scripts/dotask_cli.py` `STOP_WORDS` includes `AUTH_DEAD`, so the loop stops on it.

## Implementer details

- The wait belongs in the loop in `scripts/dotask_cli.py` (the dispatch that ended on AUTH_DEAD), not inside `task.sh`'s check, so each wait is visible as a status line and counted as one attempt. Never edit `scripts/task.sh` while a group's loop is running through it (bash reads scripts as it goes).
- Keep the existing quick retries; add the longer waits on top.
- Tests go in `scripts/test_dotask_cli.py` next to the other autoland tests (dispatch mocked to return AUTH_DEAD, then success).

### Acceptance criteria
- [ ] C1: A dispatch that ends on AUTH_DEAD is retried by the loop after a longer wait, up to a fixed number of times, with a status line for each wait; a later successful sign-in continues the group without a manual resume.
- [ ] C2: When every retry fails, the group stops on AUTH_DEAD as today, and `status` shows it as stopped with the resume command.

### Related tasks
T16090 (the group that sat idle), the dotask skill's "AUTH_DEAD" note.
