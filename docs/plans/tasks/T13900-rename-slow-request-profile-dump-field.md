# T13900: Rename the slow-request `profile=` dump-path field so it stops colliding with the profile id

**Status:** STAGING
**Impact:** 3
**Complexity:** 1
**Tier:** S
**Created:** 2026-10-28
**Updated:** 2026-10-28

## Problem

T13810 added `profile=<X-Profile-ID>` to every `[REQ]` line so a log grep can follow one profile. The middleware already used the same key for a different thing: `[SLOW REQUEST]` and `[REQ_TIMING]` lines append `profile=/tmp/profiles/<...>.prof`, the path of a cProfile dump. Seen on the T13810 test stack (2026-10-28):

```
[REQ] POST /api/clips/raw/save | user=5125c7c5-... | profile=9fa7378c | ... req_id=59d63834
[SLOW REQUEST] POST /api/clips/raw/save - total 1.09s (...) req_id=59d63834 profile=/tmp/profiles/1793209405_POST_api_clips_raw_save_1090ms_59d63834_....prof
```

A `grep profile=9fa7378c` works, but anyone filtering or parsing on the `profile=` key gets two unrelated meanings, and the sync trace work (T13810, T13820, T13890) leans on log greps to join a request across lines.

## Solution

Rename the dump-path key to `prof=` in the two places that emit it. The profile id keeps `profile=`, matching `[REQ]`, `[STATE]` and the migration logs.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/middleware/db_sync.py` - `profile_suffix` (~:777, `[SLOW REQUEST]`) and `profile_timing_suffix` (~:783, `[REQ_TIMING]`)
- `src/backend/tests/test_profiling.py` - asserts `"profile=" in slow_log[0].getMessage()` (~:134); update to `prof=`
- `docs/runbooks/profiling.md` - example line at ~:72
- `.claude/skills/` backend `performance-optimization` skill, if it names the field (check)

### Related Tasks
- Follow-up to T13810 (added `profile=` to `[REQ]`)

### Technical Notes
- Grep `src/`, `scripts/`, `e2e/` and `docs/` for any parser of `profile=/tmp/profiles` before renaming (CLAUDE.md refactoring rule 7). On 2026-10-28 only the test and the runbook referenced it.
- `docs/plans/tasks/T1531-*.md` quotes the old format in history; leave archived task text alone.
- Log-only change: no persistence, no UI.

## Implementation

### Steps
1. [ ] Change the test assertion to expect `prof=` (red)
2. [ ] Rename both suffixes in `db_sync.py` (green)
3. [ ] Update the runbook example and any skill text naming the field

## Acceptance Criteria

- [ ] `[SLOW REQUEST]` and `[REQ_TIMING]` lines carry `prof=<dump path>`; no log line uses `profile=` for anything but a profile id
- [ ] `test_profiling.py` asserts the new key and passes
- [ ] Runbook example updated
