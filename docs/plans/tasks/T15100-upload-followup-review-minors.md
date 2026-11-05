# T15100: Upload follow-up review minors: stale comment, wait-loop cancel, legacy beacon test, alarm edge cases

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Tier:** M (backend + frontend)
**Created:** 2026-11-04
**Updated:** 2026-11-04
**Milestone:** Production incident 2026-11-04 follow-ups, see PLAN.md

## Source

Post-merge review of PR #706 (T15030-T15060 review), reviewer run 2026-11-04, plus the two-flow Playwright check against the g-t15030-4 stack.

## Problem

Minor findings from the post-merge review of PR #706. Bundle; none is urgent.
1. The `SAVE_BATCH_SIZE` comment and the T15030 task claim "prepare rebuilds state from R2 ListParts". False: resume trusts `parts_json`; `r2_multipart_parts_match_size` only validates sizes. Fix the comment and the knowledge doc.
2. The `in_progress` wait loop has no timeout and no cancel/abort check, so a stalled-but-alive other flow or a user cancel still spins it. A Retry within 60 s of a flow's own failed save also sees "Already uploading..." against its own dead session.
3. A reason-less beacon from an old cached client (only `phase`) used to be terminal and is now dropped from failure counters. Intended, but no test covers the legacy payload shape.
4. Pulse alarm: `failed_users >= 2` mutes a real outage on a one-active-user day; Postgres `CURRENT_DATE` in the `user_usage_daily` write can disagree with the admin `today` near midnight; the `usage_daily_has_upload_outcomes` probe is sticky-true only, so the pre-v042 path logs `logger.error` per upload outcome until migrated.
5. `backupCount=7` logs still clear on deploy/restart (T12890 is the real fix); state that in the knowledge doc recipe.
6. `_snapshot_db_or_refuse` copies the whole DB per sync under the upload lock; the abort deadline only fires on BUSY/LOCKED. State a size threshold in `persistence-sync.md`.
7. The T5340 tests now compare `iterdump()` content, which no longer pins `PRAGMA user_version`; add one assertion.

## Solution

Work the list in order; each item is small. Behavior changes (items 2 and 4) need a failing test first.

## Acceptance Criteria

- [ ] Each numbered item is fixed or explicitly waived in the commit message
- [ ] Comment and knowledge docs no longer claim a ListParts rebuild

## Context

### Relevant Files
- `src/frontend/src/services/uploadManager.js`
- `src/backend/app/routers/games_upload.py`
- `src/backend/app/routers/admin.py`
- `src/backend/tests/test_t5340_explicit_sync_key.py`
- `.claude/knowledge/backend-services.md`
- `.claude/knowledge/persistence-sync.md`

### Related Tasks
- T15020, T15030, T15040, T15050, T15060 (merged in PR #706)
