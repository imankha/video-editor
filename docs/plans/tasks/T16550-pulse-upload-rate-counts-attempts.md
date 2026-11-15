# T16550: The pulse card's upload success rate counts attempts

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-14
**Updated:** 2026-11-14

## In plain words

**Today.** The admin dashboard's pulse card shows today's upload success rate as today's successful uploads divided by successes plus failures. The Builds table (fixed in T16340) divides successes by attempts instead.

**The problem and how we got here.** An upload that someone starts and then abandons (closes the tab, loses signal, gives up) ends with neither a success nor a failure. The pulse card never sees it, so it reads higher than the truth on exactly the days uploads go wrong quietly. T16340's criterion C3 asked the pulse to use the same counts as the Builds table, but the database only keeps a lifetime count of upload attempts per user, not a count per day, so the pulse had nothing to divide by. The owner was told on 2026-11-13 and asked for this follow-up on 2026-11-14.

**What we will do.** Record attempts per day alongside successes and failures (a new attempts column in the daily usage table, filled where an upload starts), then have the pulse card divide today's successes by today's attempts.

**Why.** The pulse card is the first number the owner looks at each day. An abandoned upload is a lost parent, and it should pull the rate down.

**How we will know it worked.** Start three uploads today, finish one, fail one, and abandon one: the pulse card reads 33%, not 50%.

## Acceptance Criteria

- [ ] C1: Each upload start adds one to today's attempt count for that user; a backend test proves it.
- [ ] C2: The pulse card's upload success rate is today's successes divided by today's attempts; with 3 attempts, 1 success and 1 failure it reads 33%, proven by a backend test.
- [ ] C3: Days before the new column existed show no pulse rate rather than a made-up one.

## Implementer details

- Pulse: `upload_success_rate` in `src/backend/app/routers/admin.py` (T8170), reading `user_usage_daily`.
- Attempt event: `game_upload_attempted`, recorded by `prepare_upload` (see T16340's task file for how attempts and successes pair).
- New column means a `postgres` track migration plus `_SCHEMA_DDL` in `src/backend/app/services/pg.py`; include the Migration agent.
- Knowledge doc: `.claude/knowledge/backend-services.md`.
