# T16340: Admin upload success reads over 100% on production

**Status:** STAGING
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** The production admin dashboard's Builds table has an Upload success column and an Upload tries column ("users who tried / users who succeeded"). On 2026-11-13 the owner saw the Unrecorded row read **131.66%** success with **91 / 141** tries, meaning more users succeeded than tried. Build #7102 read 93.75% with 16 / 14, and build #7541 read 0.00% with 1 / 0.

**The problem and how we got here.** A success rate over 100% is impossible, so the number cannot be trusted for any row, including the ones that look plausible. The owner judges releases on these figures (the 2026-11-04 upload incident was read from them). Two things in the code explain it:
1. The "tried" event, `game_upload_attempted`, only started firing on 2026-09-22 (T11010). Uploads before that recorded a success with no attempt. The Unrecorded row holds the older sign-ups, so its successes outnumber its attempts.
2. The percent and the tries column count different things. The percent divides success *events* by attempt *events* (T15770, `admin.py` dimension rows), while the tries column shows *users* who tried and *users* who succeeded. So a row can show a percent that does not match the two numbers next to it.

The 1 / 0 row may also mean an attempt is recorded in the browser and lost, while the success is recorded on the server when the upload finishes. If so, attempts are under-counted everywhere, not only in old rows.

**What we will do.** Make the rate honest for every row. Count only uploads that could have an attempt (on or after the date the attempt event started), or use attempts plus successes without an attempt as the denominator, and say which in the column's tooltip. Make the percent and the tries column count the same thing. Never show a rate above 100%: if the data still says so, show it as a data problem, not as a number.

**Why.** Upload success is the dashboard's alarm number (T8170 raises an alarm below a threshold). A rate that can be wrong in either direction can hide the next upload outage or raise a false one.

**How we will know it worked.** On production, every row of the Builds, Channels and Cohorts tables shows an upload success between 0% and 100% that matches its tries column, and a backend test with a user who succeeded without an attempt event proves the rate stays at or below 100%.

## Implementer details

- Rate: `src/backend/app/routers/admin.py`, the dimension-row loop around `row["upload_success_pct"] = ... outcome["succeeded"] / attempts` (T15770 comment). Shared by Builds, Channels and Cohorts (`DimensionTable.jsx`).
- Tries column: `src/frontend/src/components/admin/DimensionTable.jsx` renders `{row.upload_attempted} / {row.upload_succeeded}` (user counts from `DIMENSION_COUNTS`).
- Event start date: `game_upload_attempted` added in 1b1f4c0ae (T11010, 2026-09-22). Where it fires: the prepare_upload seam (client) versus `game_upload_succeeded` at finalize (server, `analytics.py` "durable upload OUTCOME"). Check whether attempts are lost on the way.
- The pulse card's `upload_success_rate` (`admin.py`, T8170) uses the same events: check it for the same flaw.
- Read production numbers with the existing admin read paths only; this is a read-side fix with no data migration.

## Ruling

**Owner, 2026-11-13: fix what is miscounted; never cap the rate.** "I don't want to just set the ceiling to 100%, I want to fix the bug that would cause it to read over 100% because something is being miscounted." The first build (7597c9c97) made each user's tries `GREATEST(attempts, outcomes)`, so every success with no recorded attempt became a try. That keeps the rate at or below 100% by construction, so it would also hide a real double-count. Rejected.

What is miscounted: `game_upload_succeeded` has been recorded since 2026-08-26 (`EVENT_INSTRUMENTED_AT`), but `game_upload_attempted` only since T11010 on 2026-09-22. Successes from those four weeks have no attempt at all, so older groups read over 100%. The fix compares like with like: the rate uses only upload events from the day attempts began, and older successes are left out of both sides instead of being turned into tries. Since 2026-09-22 the code is meant to keep tries at or above successes (`games_upload.py` prepare-upload books the attempt; a dedup hit books none and can never finalize). If any group still shows more successes than tries in that window, that is a second miscount: find its source and fix it there.

## Acceptance criteria

- [ ] C1: The upload success rate and the tries column count only upload events on or after the day `game_upload_attempted` began recording (2026-09-22, added to `EVENT_INSTRUMENTED_AT`). A backend test: a user whose only success is from before that day adds nothing to either side, and a group whose uploads are all older shows "not tracked", not a percent (ruling 2026-11-13).
- [ ] C2: Each row's upload success percent and its tries column are computed from the same counts, proven by a backend test.
- [ ] C3: The pulse card's upload success rate uses the same window and counts as C1, proven by a backend test.
- [ ] C4: On production after deploy, no Builds row shows an upload success over 100% (owner checks the dashboard).
- [ ] C5: Nothing caps or floors the rate: no `GREATEST`, `LEAST`, `min` or `max` over tries or successes. A backend test records a success with no attempt after 2026-09-22 (a real miscount); the row shows the figure as it is, over 100%, and the server logs a warning naming the group, so a future double-count shows instead of hiding (ruling 2026-11-13).
- [ ] C6: A Findings section in this file names every code path that records `game_upload_attempted` and `game_upload_succeeded`, and shows each success after 2026-09-22 has its attempt, or fixes the path that does not (ruling 2026-11-13).

## Findings

Every code path that records the two events (C6), read on 2026-11-14:

- `game_upload_attempted`: one emitter, `prepare_upload` in `src/backend/app/routers/games_upload.py`, once per game file that is about to push bytes (a new session or a resume). It fires after every validation refusal and after the `in_progress` return (another tab is already uploading that file, and that tab booked its own attempt). A dedup hit (the file is already in R2) books no game attempt, and it can never reach a success because it gets no `upload_session_id` to finalize.
- `game_upload_succeeded`: one emitter, `finalize_upload` in the same file, for `kind == game` only, and only for the request that deleted the pending row (`released_here`), so two finalizes for one session book one success.
- Neither is in `CLIENT_FUNNEL_EVENTS` (the browser cannot beacon either one), neither is mapped in `ACHIEVEMENT_TO_MILESTONE` or `DURABLE_SYNC_FAILURE_ACTIONS`, and `record_milestone` skips both the same way under admin impersonation.

Since 2026-09-22 every success therefore has its attempt: finalize needs a session, and a session is only created or resumed by the `prepare_upload` call that books the attempt. The one exception is a session prepared before the T11010 deploy on 2026-09-22 and finalized after it without a new prepare. That is a one-off left over from the deploy, so no code path needed fixing. The rate is now computed from events since 2026-09-22 only, and any group that still shows more successes than tries logs a `[T16340]` warning naming the group, so if a double count ever happens it shows up instead of hiding.

How "only since 2026-09-22" is counted: `user_actions` keeps a lifetime count and the first occurrence only, so a user's count cannot be split by date. A user whose first upload event comes before the cutoff is left out of both sides. The rate describes users who started uploading on or after 2026-09-22.

The pulse card reads today's `user_usage_daily` buckets, which always fall inside the window, and divides successes by successes plus failures. It does not use attempts because `game_upload_attempted` has no daily bucket to read today's attempts from. Making the pulse use attempts would need a new `user_usage_daily` column, which is a Postgres migration. The owner can decide whether that is worth it.
