# T16270: Following read-out and switches

## In plain words

Once Spotlight (the step that draws a circle that follows the athlete) follows from one tap, we need to know whether it is working for real parents and to be able to stop it quickly if it is not. Today the app records that a spotlight was exported but nothing about how it was made. This adds four simple counts the owner can read: how many spotlights used following, how many needed a correction, how many fell back to four taps, and what the following cost us. It also adds a switch that turns following off for everyone at once and a daily spending limit; with either in force, parents simply get today's four taps. Done when the owner can read those counts for a day of staging use and flipping the switch returns Spotlight to four taps within a minute.

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Click-once Spotlight (see [EPIC.md](EPIC.md)). Task 6 of 6. The switch and the limit can be built alongside T16220 and must be in place before T16240 reaches production.

## How we got here

The prototype measured following on one account's footage. Parents who finish Spotlight are the ones who return (5 of 22, against 2 of 30 who did not), so this feature is judged by whether more parents finish Spotlight, not by the prototype's score.

## The problem

Without counts we cannot tell a feature that helps from one that quietly falls back to four taps for half the parents. Without a switch, a model fault or a runaway bill can only be fixed by a new release.

## What we will do

1. Record, for each spotlight: made by following or by hand, number of taps, whether a doubtful spot was shown, whether the parent corrected it, whether it fell back, and how long the parent waited.
2. Record the graphics-card seconds each following job used, so cost can be added up by day.
3. Show the counts where the owner already reads the funnel: spotlights finished out of spotlights opened, split by followed and by hand, and cost per followed spotlight.
4. A switch that turns following off for everyone, and a daily spending limit that does the same for the rest of the day when reached. Both leave the four-tap flow untouched.
5. Compare before and after: the share of paid highlights that get a finished spotlight, and taps per spotlight.

## Why this and not something else

A slow rollout to a share of parents was considered. With the small number of spotlights made each month it would take too long to read; a switch with honest counts gives the same safety sooner.

## How we will know it worked

- [ ] After a day of staging use the owner can read: spotlights by following, by hand, corrected, fallen back, and cost.
- [ ] Turning the switch off returns Spotlight to four taps for a parent who reloads within a minute, with no error.
- [ ] Reaching the daily limit has the same effect until the next day, and the owner is told it happened.
- [ ] The before and after numbers for finished spotlights out of paid highlights, and taps per spotlight, are written down two weeks after release.

## For the implementer

### Design notes
- Follow the kill switch, daily spend cap and admin read-out being built for Mark plays with AI (T16150, T16160); share the mechanism if it has landed, otherwise build the minimal version here and note it for reuse.
- Milestone events follow the existing analytics pattern (see the Journey and funnel tasks T3470, T15800 for names); write them from the gesture that completes a spotlight, not reactively.
- GPU seconds come back with the T16220 job result.

### Related Tasks
T16220 (job reports its seconds), T16240 (fallback path), T16250 (doubtful spots and corrections), T15800 (Spotlight completion measure), T16150 and T16160 (same switches for the AI analysis).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/detection.py`
- `src/backend/app/services/modal_client.py`
- `src/backend/app/services/export_cost_guard.py`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `docs/plans/bi/funnel-evidence-2026-11-09.md`
