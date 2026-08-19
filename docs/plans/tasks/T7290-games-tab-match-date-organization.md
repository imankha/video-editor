# T7290: Games Tab Organizes by Match Date, Not Upload Date

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

The Games tab organizes every game by `created_at` (when the file was uploaded). Upload date
is an implementation detail the user does not think in — **match date is the mental model**
("the Sporting game was March 21"). The user reported this directly (2026-08-19) looking at
their own Games tab.

The mismatch is visible on screen: six games whose titles read *Mar 21, Mar 28, Apr 25, Apr 26,
May 2, May 9* are filed under month headers **June 2026 (5 games)** and **May 2026 (1 game)** —
because they were all uploaded in June. The header contradicts the tile title directly beneath it.

Every ordering surface on that tab keys off `created_at`:

| Surface | Current behavior | Location |
|---|---|---|
| Month group headers + order + within-group sort | `new Date(game.created_at)` | `ProjectManager.jsx` `groupGamesByMonth` (~L109-128) |
| Backend list ordering | `ORDER BY g.created_at DESC` | `games.py` (~L941, `list_games`) |
| Tile footer date ("Jun 11") | `new Date(game.created_at)` | `GameTile.jsx` (~L260) |

Meanwhile `game_date` already exists end to end and is *already the date the user sees in the
title*: it is a `games` column, **required** at creation (`GameDetailsModal.isValid` demands it),
editable afterwards (`EditGameModal`), returned in the list payload (`games.py` ~L1045), and
baked into the display name by `generate_game_display_name` ("at Sporting **Mar 21**").
Nothing needs to be captured, migrated, or backfilled — the correct datum is already there and
is simply not used for organization.

Expected regrouping for the reporting user's account: **June 2026 (5) / May 2026 (1)** becomes
**May 2026 (2) / April 2026 (2) / March 2026 (2)**.

## Solution

Make match date the organizing key on the Games tab, and stop showing upload date at all.

1. **Group and sort by `game_date`.** `groupGamesByMonth` keys the month header off
   `game_date`, and sorts newest-match-first both across groups and within a group.
2. **Backend list order follows.** `list_games` orders by match date descending so the first
   paint (and any consumer that trusts server order) already agrees with the rendered grouping —
   the frontend sort stays as the authority for display, the two must not disagree.
3. **Drop the tile footer date entirely** (user decision, 2026-08-19). The match date is
   already the title suffix and now also the month header; a third copy is noise. The footer
   keeps only the clip count. No "Uploaded ..." line is added — upload date is not information
   the user asked for anywhere on this screen.
4. **Null `game_date` falls back to `created_at`** for ordering/grouping ONLY. This is a real
   external-data edge case, not an internal-bug fallback: games created before the field was
   mandatory, and materialized/shared game rows, can carry NULL. The backend already logs a
   warning for such rows (`games.py` ~L1005) — keep that loud signal, do not add a second
   silent path. Games are never dropped from the list because of a missing date.

### Explicitly out of scope

- Making `game_date` non-nullable, or any backfill/migration. No schema change in this task.
- Reel Drafts grouping (`groupedProjects`) — it already sorts groups by `project.game_dates`,
  which is match date, and is left untouched.
- The "Continue where you left off" card, which is genuinely recency-of-*activity* and should
  keep using activity timestamps.
- Sort-toggle UI (by match date / by upload date). Not requested; adding a control would be
  persisted view state, which the project forbids.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ProjectManager.jsx` — `groupGamesByMonth` (~L109-128) is the
  grouping/sort function; its caller renders the month header + count (~L1050-1070).
- `src/frontend/src/components/GameTile.jsx` — footer row (~L258-264) renders the upload date
  next to the clip count.
- `src/backend/app/routers/games.py` — `list_games` query `ORDER BY g.created_at DESC` (~L941);
  the missing-metadata warning (~L1005) and the `game_date` field in the response (~L1045) are
  already correct and stay.
- `src/frontend/src/components/__tests__/GameTile.test.jsx` — existing GameTile unit tests;
  needs a case asserting the footer no longer renders a date.
- New/extended unit coverage for `groupGamesByMonth` (grouping key, cross-group order,
  within-group order, NULL `game_date` fallback placement).

### Related Tasks

- Depends on: none.
- Related: T7280 (single-clip upload → Framing) also touches the games entry flow but not
  these files; no contention expected.
- Related: the Game Pools / Dual-Camera epic assumes games are found by match date when
  contributors add clips to an existing game — this makes the Games tab consistent with that.

### Technical Notes

- `game_date` is stored as `TEXT` in `YYYY-MM-DD` form (see `generate_game_display_name`,
  which parses it with `strptime(..., "%Y-%m-%d")`). Parse it as a **local calendar date**, not
  via `new Date("2026-03-21")` in a context where UTC-midnight can shift the day backwards for
  western timezones — a game dated Mar 1 must never land in the February group. `created_at`
  is a real timestamp and keeps its existing parsing.
- Sorting mixed `game_date` (date-only) and `created_at` (timestamp) values requires one
  comparable key per game; compute it once per game rather than re-deriving it in both the
  group key and the comparator, so the header a game appears under can never disagree with the
  bucket it sorts into.
- Ties (two games on the same match date — a tournament day) need a stable secondary key so
  the order does not shuffle between renders.

## Implementation

### Steps

1. [ ] Branch `feature/T7290-games-tab-match-date`.
2. [ ] Add a single date-resolution helper (match date, falling back to upload date) and use it
       for both the month key and the comparator in `groupGamesByMonth`; add a stable tiebreak.
3. [ ] Change `list_games` ordering to match date descending, with the same fallback, so server
       order and rendered order agree.
4. [ ] Remove the date from the `GameTile` footer, leaving the clip count.
5. [ ] Unit tests: grouping key is match date; cross-group and within-group ordering; NULL
       `game_date` falls back to upload date without dropping the game; month-boundary date is
       not shifted by timezone; GameTile footer renders no date.
6. [ ] Run the relevant set (~10 tests): the new grouping tests, `GameTile.test.jsx`,
       `ProjectManager.homeTabDefaults.test.jsx`, and the games-tab e2e spec, plus the backend
       games-list tests touched by the ORDER BY change.
7. [ ] Reviewer pass on the diff, then commit.

### Progress Log

**2026-08-19**: Filed from a direct user report while viewing their own Games tab. Diagnosis
confirmed in code (three `created_at` call sites listed above); `game_date` verified present,
required at creation, and already in the list payload. Footer-date decision (drop it entirely
rather than swap to match date or label it "Uploaded") made by the user at filing time.

## Acceptance Criteria

- [ ] Month headers on the Games tab reflect **match** month/year; a game titled "at Sporting
      Mar 21" appears under "March 2026" regardless of when it was uploaded.
- [ ] Within a month, games are ordered newest match first; months are ordered newest first.
- [ ] Backend `list_games` returns games in match-date-descending order.
- [ ] Game tiles show no date in the footer — clip count only.
- [ ] A game with NULL `game_date` still appears in the list, placed by its upload date, and
      the existing backend warning for missing metadata still fires.
- [ ] A game whose match date is the 1st of a month is grouped in that month in a
      negative-UTC-offset timezone (no off-by-one-day regression).
- [ ] Reel Drafts grouping and the "Continue where you left off" card are unchanged.
- [ ] Relevant test set passes; Branch CI green.
