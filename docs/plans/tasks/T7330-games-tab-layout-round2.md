# T7330: Games tab round 2 — density, match date, tournament grouping

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

T7290 made the Games tab group by match date. Looking at the result on their own account
(7 games, 4 groups), the user reported three things:

1. **They want the match date visible on the tile.** T7290 removed it, on this same user's
   instruction at filing time, on the rationale that "the match date is already the title
   suffix." **That rationale was wrong.** The title is `truncate`d inside ~120px (the name
   shares its row with a 32px edit pencil on a ~171px tile), and the date suffix sits at the
   truncation end — so it is structurally the FIRST thing lost. In the user's own screenshot
   every visible name is clipped. Separately, `generate_game_display_name` returns
   `fallback_name` verbatim when `opponent_name` is empty (legacy rows, materialized/shared
   games), so those tiles have no date anywhere at all.
2. **The page reads as a narrow left-hugging column with dead space to the right.** The grid
   is `lg:grid-cols-6` while every month holds 1-2 games, so each row fills 2 of 6 columns.
   Each group also spends a full-width header row (~64px of chrome); 4 groups cost ~256px of
   header to present ~600px of content. The user offered "I don't mind sharing a row with
   more than one month so items can breathe."
3. **Tournaments should classify instead of months** when multiple games share one.

## Solution

Approved design (ui-designer proposal + user decisions, 2026-08-19):
[artifact](https://claude.ai/code/artifact/994db28b-7890-40c0-8818-cd216b4a040a).

### 1. Match date returns to the tile, with the weekday

Restore the date to the footer's left slot (where it was pre-T7290), but read from
`game_date` — never `created_at` — and format it **`Sat, Mar 21`**. The weekday makes the
second copy carry information the title does not (youth sport is weekend-shaped; a Wednesday
makeup game reads differently at a glance) and visually distinguishes it from the title
suffix so the eye does not read it as an echo.

Missing/unparseable `game_date` renders NOTHING — never a `created_at` fallback. That
fallback is the exact contradiction T7290 removed (a March match uploaded in June captioned
"Jun 11" under a "March 2026" header), and the loud signal already exists server-side in
`_list_games_impl`. Same line goes on `ReferenceGameCard` (no clip count there), so the two
card types do not disagree inside one group.

**Explicitly rejected:** stripping the date suffix from `game.name` client-side to
de-duplicate. That string is `generate_game_display_name` output reused by downloads,
collections and intro cards; client-side surgery on it is fragile and breaks the no-opponent
fallback path. A soft duplicate on wide tiles is accepted.

### 2. Density: derived column count + rail group headers

**Row-sharing between groups is rejected, and this is a deliberate departure from the
user's literal suggestion** (they proposed it; the reasoning below was accepted):

- Flex-flow with inline header chips **orphans headers** — flexbox will place "April 2026"
  as the last item of a row whose games all wrap to the next line, and no CSS prevents it
  (`break-inside` does not apply). Making "header + first tile" unbreakable then destroys
  column alignment; identical 16:9 posters at ragged x-offsets read as broken, not spacious.
- A header as a grid cell in one shared grid keeps alignment but **spends a whole tile slot
  per group** — 4 wasted cells against 7 real tiles on this account — and scatters headers
  mid-row, which is harder to scan at 20+ games, not easier.
- Masonry solves varying heights; every tile here is `aspect-video`, so there is nothing to
  solve.
- A per-group `CardCarousel` renders no chevrons and no dots when it does not overflow, so a
  2-game month in a carousel is **pixel-identical to today's left-hugging row** — it fixes
  nothing here, hides games behind horizontal scroll on the tab whose job is showing games,
  and breaks the warming model (off-screen carousel children never intersect).

Instead, deliver the same outcome by two changes that preserve "position tells you the
group":

- **Column count follows the data:** `columns = clamp(2, max(group size), 4)` at `lg`+.
  Mobile stays 2-up, tablet 3-up, each clamped by the same derived count. On the user's data
  that is **2 columns — tiles go from 171x96 to 474x267 and every row is 100% full.** A pure
  function of rendered data: no toggle, no persisted view state.
  **User chose derived over a fixed 4-up** (2026-08-19), accepting that adding a 3rd game to
  a month re-flows tiles from 474px to 283px.
- **Group header moves into a sticky left rail** at `lg`+ (`grid-cols-[8rem_minmax(0,1fr)]`),
  removing ~64px of vertical chrome per group. Below `lg` it stays stacked above, exactly as
  today.

### 3. Tournament instances outrank months

- A tournament group requires **>= 2 games in the same INSTANCE**. A lone game keeps its
  month — its tournament is already in the title.
- **Name alone is not the key** (tournaments recur annually). Games under one normalized name
  are split into instances wherever consecutive matches are more than **90 days** apart, so
  "Surf Cup 2025" and "Surf Cup 2026" never merge.
- **One descending timeline over both kinds.** Every group sorts by its newest member's date;
  a tournament therefore sorts at its newest match. Ties break on that game's `created_at`
  desc, then tournament-before-month, then label.
- **A game belongs to exactly one group.** Tournament members leave their month; a month
  emptied that way disappears rather than rendering an empty header.
- **Header carries three signals** so it never reads as an oddly-named month: trophy icon,
  amber instead of gray, and a date range sublabel (months never have one). Colour alone
  would fail WCAG 1.4.1. The range is required, not decorative — a tournament straddling
  Mar 28 - Apr 2 is a genuinely non-monotonic block above a Mar 31 league game, and the range
  is what explains that.
- Range is built from **real match dates only**; a NULL-dated member contributes nothing, and
  if no member has one the sublabel is omitted.

## Context

### Relevant Files (REQUIRED)

- `src/frontend/src/components/ProjectManager.jsx` — `groupGamesByMonth` (T7290, ~L109-180)
  becomes `groupGamesForTab`; `GAMES_TILE_GRID_CLASS` (~L51) becomes a column-keyed map; the
  group render (~L1117-1160); the cache-warming observer (T7320, ~L297-325) whose
  depth-independence this task's extra wrapper depends on.
- `src/frontend/src/components/GameTile.jsx` — footer row (~L258-266).
- `src/frontend/src/components/ReferenceGameCard.jsx` — scrim (~L79-90).
- NEW `src/frontend/src/utils/matchDate.js` — the ONE local-calendar date parser plus label
  and range formatters, shared by all three components.
- `src/frontend/src/components/ProjectManager.gameGrouping.test.jsx` — the 9 T7290 cases.
- `.claude/references/ui-style-guide.md` — its `### Game tile` section is stale on THREE
  counts already (claims no game name, claims date + clip count, puts the expiry chip
  top-right when it is top-left); rewrite plus a new grouped-grid-with-rail pattern.
- `.claude/knowledge/annotate.md` — the T7290 server-order invariant needs its tournament
  caveat.

### Related Tasks

- **Stacked on T7290 AND T7320** (neither merged at filing time). T7290 introduces the
  grouping function this rewrites; T7320 fixes the warming observer that this task's extra
  wrapper level would otherwise break again. Branch is
  `feature/T7330-games-tab-layout-round2`, based on T7290's branch with T7320 cherry-picked.
- T5681 introduced the poster grid and the month-group wrapper.
- The Game Pools / dual-camera epic will add more games per group over time, which is the
  case the derived column count converges toward.

### Technical Notes

- **Tailwind class strings must be STATIC literals** for the purge to keep them — the column
  count selects from a map, never interpolates into a class name.
- `minmax(0,1fr)` on the tile column is mandatory; without it a grid child's min-content can
  blow the track out.
- `lg:sticky lg:top-2 lg:self-start` on the rail: if the app-shell scroller (`h-dvh
  overflow-hidden` + inner scroller) fights it, the degrade is graceful (label scrolls
  normally). Drop `sticky` rather than restructuring the shell.
- `GamesListSkeleton` consumes the same grid constant — it MUST move with the grid or the
  T6310 drift bug returns. Column count cannot be derived before data exists; 4 is the
  honest neutral (never over-promises a wide row).
- The T7290 invariant "rendered flat order equals `GAMES_MATCH_DATE_ORDER_BY`" holds ONLY
  while no tournament group forms — a tournament deliberately hoists games out of month
  order. That is correct (the agreement exists so month PLACEMENT cannot contradict the
  server, and raw-order consumers like `GameClipSelectorModal` still get the server's order),
  but it must be written down or the next reader files it as a bug.
- `tournament_name` is NULL on all 7 games of the reporting account, so **the tournament path
  cannot be verified against real data** — unit tests and synthetic fixtures only, until a
  tournament is recorded. The zero-tournament case must be element-for-element identical to
  today.

## Implementation

### Steps

1. [ ] Branch `feature/T7330-games-tab-layout-round2` (stacked, see above).
2. [ ] Extract `parseLocalCalendarDate` / `parseMatchDate` + new `formatMatchDateLabel` /
       `formatMatchDateRange` into `utils/matchDate.js`. ONE parser — the UTC-midnight
       landmine must not get a second implementation.
3. [ ] `groupGamesForTab`: tournament instance clustering, month fallback, one ordered array.
4. [ ] Adapt the 9 existing T7290 cases to the new return shape with an adapter, assertions
       and fixtures BYTE-IDENTICAL.
5. [ ] `gamesGridColumns` + `GAMES_TILE_GRID_BY_COLUMNS`; skeleton follows.
6. [ ] Rail-header group section; tournament header variant.
7. [ ] Match-date line on `GameTile` and `ReferenceGameCard`.
8. [ ] New tests (tournaments, ordering, ranges, column clamp, tile dates).
9. [ ] Docs: style guide rewrite, knowledge-doc caveat.
10. [ ] Relevant set + reviewer pass + Branch CI.

### Progress Log

**2026-08-19**: Filed after a ui-designer pass on the shipped T7290 screen. User approved the
proposal and chose derived columns over fixed 4-up. The observer bug the same pass uncovered
was split out as T7320 (user's call) because it predates T7290 and ships independently.

## Acceptance Criteria

- [ ] Every game tile shows its match date as weekday + short date, from `game_date`, and
      shows nothing (never the upload date) when `game_date` is absent or malformed.
- [ ] Reference cards carry the same date line.
- [ ] At `lg`+, desktop columns = clamp(2, largest group, 4); the user's 7-game account
      renders 2 columns with every row full.
- [ ] Group headers render in a left rail at `lg`+ and stacked above below `lg`.
- [ ] Mobile 390px is unchanged from today: 2-up, header above, no horizontal page scroll.
- [ ] 2+ games sharing a tournament instance form one tournament group, visually distinct by
      icon AND colour AND a date-range sublabel; a lone tournament game stays in its month.
- [ ] Two instances of one tournament name >90 days apart do NOT merge.
- [ ] A month emptied by a tournament hoist does not render.
- [ ] With no `tournament_name` anywhere, output is element-for-element today's month
      grouping; all 9 existing T7290 grouping cases pass with unchanged assertions.
- [ ] The T7320 warming observer still registers every tile through the added nesting.
- [ ] `GamesListSkeleton` uses the shared grid constant (no private copy).
- [ ] Relevant test set passes; Branch CI green.
