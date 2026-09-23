# T11010 - Admin panel: honest upload attempt/success pairs + a funnel that reads as users

**Status:** STAGING
**Filed:** 2026-09-22 (user request, from a live prod admin-panel screenshot)
**Tier:** M

## Problem

Three defects, all read-side, found by looking at the live admin panel.

### 1. Clips column structurally read "0 tried / N succeeded"

`clip_upload_attempted` was registered in `analytics.FLOW_EVENTS` by T8370 and
reserved by T8380 for a future "Add Clip" client beacon, but **nothing ever
emitted it**. `admin.py`'s clip "tried" half summed `clip_save_attempted`
(annotate flow, real) plus that dead name, so every account that used the direct
clip-upload flow showed zero attempts against a non-zero success count.
`admin.py` even carried the disclosure inline:
`"outcome-based: clip_upload_attempted is not emitted yet (T8380)"`.

### 2. Games column could show success exceeding attempts ("1 / 5")

Grain mismatch between the two halves of the pair:

| Event | Fires | Grain |
|-------|-------|-------|
| `game_created` | `games.py` `create_game` | once per **GAME** |
| `game_upload_succeeded` | `games_upload.py` `finalize_upload` | once per **VIDEO FILE** |

A multi-angle game is one `game_created` and N `game_upload_succeeded`.

### 3. The funnel looked like it was counting events, not users

It was not - both endpoints already use `COUNT(DISTINCT a.user_id)`. Three
separate read-side faults made it *look* like event counting:

- `FunnelChart.jsx` looked up keys `framing_opened` / `framing_exported`. The
  backend derives every funnel key from the event **LABEL**
  (`label.lower().replace(' ','_')`), and those events are labelled "Focus
  Opened" / "Focus Exported" - so both rows rendered a hardcoded **0** while the
  user table happily showed accounts sitting AT Focus Opened.
- `clip_uploaded` has been in `FUNNEL_STEPS` since T8370 but was never listed in
  the chart's `STAGES`, so the whole direct clip-upload flow was invisible.
- The percentage column was **step-over-step** conversion on a funnel whose steps
  are not nested. More users watch the Annotate video than save a clip; more
  export an overlay than export from Focus. That produced 114%, 138%, 700%.

## Decisions (user, 2026-09-22)

1. **Drop the words "tried" and "succeeded"** - the `/` already carries that
   meaning and the words cost a column's width on every row. Cells read `15 / 1`,
   with the meaning in a `title` tooltip.
2. **Both games and clips get an attempt/success pair**, at matching grain.
3. **No duration or file-size threshold** to tell a game video from a clip video.
   `POST /api/games/prepare-upload` already carries an explicit
   `kind: 'game' | 'clip'` (T8370), validated to a closed set and failing loud on
   anything else. A heuristic would misfile a 15-second game video and a
   several-minute highlight source, and inferring internal data from a threshold
   is exactly the silent fallback the coding standards ban.

## Change

**Backend**

- `analytics.py`: register `game_upload_attempted` (label "Game Upload
  Attempted", `daily_col: None` -> no `daily_counters` column, **no migration**).
- `games_upload.py` `prepare_upload`: emit the per-file attempt, keyed on `kind`
  (`clip_upload_attempted` / `game_upload_attempted`), on the path that is about
  to push bytes. Deliberately **not** on the EXISTS dedup branch (no bytes, so no
  matching success could ever follow) and not on a validation refusal (that is a
  recorded upload FAILURE, not an attempt). A resume **does** count - it is a
  genuine second attempt at the same file.
- `admin.py`: the Users payload gains `game_tried_count` /
  `game_succeeded_count`, both per-file. `game_created_count` stays exposed as
  the per-GAME funnel/sort dimension; the two grains are never mixed.

**Frontend**

- `UserTable.jsx`: both cells render `N / M` with explanatory tooltips.
- `FunnelChart.jsx`: `focus_opened` / `focus_exported` keys corrected; the
  `clip_uploaded` stage added; percentages are now **share of signed-up users**
  (bounded, comparable across rows) instead of step-over-step; a caption states
  that every bar is distinct users, not action occurrences.

## Known limitation: no history for the game pair

`game_upload_attempted` starts at zero. Accounts that uploaded before this ships
will read `0 / N` in the Games column until they upload again - the same shape
the Clips column has been showing. It is not backfillable: no stored per-file
attempt record exists, and synthesising one from `game_created` or
`game_upload_succeeded` would be fabricated data. It self-corrects with use.

## Relation to T7465

[T7465](investor-analytics/T7465-journey-flow-graph.md) already scopes replacing this
bar funnel with a Sankey journey graph, and names the same symptom ("independent
ever-did-X counts producing 322%/500% neighbor ratios"). **T11010 does not
replace it.** This is the cheap honesty fix so the panel stops lying today; the
journey graph is still the real answer to "where do users actually go".

## Test evidence

- `src/frontend` - `FunnelChart.test.jsx` + `UserTable.test.jsx`: **17 passed**
  (4 new funnel cases incl. a no-row-exceeds-100% assertion over the real prod
  shape; 2 new user-table cases incl. one proving the cell ignores the per-GAME
  `game_created_count`).
- `src/backend` - `tests/test_t11010_upload_attempt_pairs.py`: **8 passed** (both
  kinds emit at prepare; `kind` decides, not file size; dedup hit and rejected
  request emit nothing; registration/no-daily-col/not-a-funnel-step guards).
- `src/backend` - curated regression set `test_admin.py`, `test_analytics.py`,
  `test_analytics_dashboards.py`, `test_t8370_clip_upload.py`,
  `test_t7890_pre_upload_funnel_beacons.py`,
  `test_t7970_upload_failure_milestones.py`: **218 passed**.
