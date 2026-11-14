# T16350: Sport as a dashboard dimension, replacing the By Sport table

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-11-13
**Updated:** 2026-11-13

## In plain words

**Today.** The admin dashboard has three Dimension pills, Campaigns, Cohorts and Builds (T13990). Picking one shows that dimension's table (sign-ups, revenue, upload success, funnel steps per row) and filters the rest of the dashboard to the row you click. Separately, a collapsed **By Sport** section (T14950) shows a month-by-sport table of action counts, read from the nightly action rollup.

**The problem and how we got here.** Sport is a way to slice the same questions the other dimensions answer: which sport's parents sign up, upload, pay and come back. As its own table it answers none of them. It has its own columns and its own data source, and it does not filter the rest of the dashboard. The owner asked on 2026-11-13 for sport to be a fourth dimension and for the By Sport table to go.

**What we will do.** Add a **Sport** pill beside Campaigns, Cohorts and Builds. It shows one row per sport with the same columns as the other dimension tables, and clicking a row filters the dashboard to that sport, like the others. Everything that follows the Dimension pills (for example the Retention chart's grouping, T7430's 2026-11-13 ruling) follows Sport too. Remove the By Sport section and the code only it uses.

**Why.** One way to slice the dashboard instead of two, and the sport split becomes available for the numbers that matter (conversion, revenue, retention) rather than only raw action counts.

**How we will know it worked.** On the admin panel the Sport pill shows one row per sport with sign-ups, revenue and upload success, clicking a row filters the dashboard to that sport, and the By Sport section is gone.

## Implementer details

- Dimensions: `DIMENSIONS` in `src/frontend/src/screens/AdminScreen.jsx` and `dimension` / `setDimension` in `src/frontend/src/stores/adminStore.js` (T13990); the table is `DimensionTable.jsx`; backend rows come from the shared dimension-row code in `src/backend/app/routers/admin.py` (the Channels, Cohorts and Builds views, `_segment_window_where`).
- The hard part: those views read Postgres (`user_segments`), but a user's sport lives per game in the per-user SQLite (`sharer_default_sport`, `inherited_sport` in `services/pg.py` are share-side only). The By Sport table reads `rollup_action_by_sport` from the analytics rollup (`analytics_by_sport` in `admin.py`, `services/analytics_rollup.py`). Decide how a user gets one sport for grouping (first game's sport, most-used sport, or one row per sport a user touched) and where it is stored (a `user_segments` column filled by the rollup or at game creation), with a migration if needed. Bring that design to the owner before building it.
- Remove: the By Sport `CollapsibleSection` in `AdminScreen.jsx`, `BySportTable.jsx` and its test, `fetchBySport` in the store, and `/analytics/by-sport` if nothing else calls it (grep `src/`, `e2e/` and `scripts/`, CLAUDE.md refactoring rule 7).
- Knowledge doc: `.claude/knowledge/backend-services.md`.

## Acceptance Criteria

- [ ] The admin panel's Dimension pills include Sport; with it selected the table shows one row per sport with the same columns as the other dimensions, proven by a browser check.
- [ ] Clicking a sport row filters the rest of the dashboard to that sport, the same way a build or cohort row does, proven by a browser check.
- [ ] The By Sport section is gone and nothing still calls its code, proven by a code check.
