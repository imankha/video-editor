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

## Review follow-ups (Stage 4.5, applied)

Four findings from the fresh-context reviewer, all fixed in the same branch:

1. **The clip EXISTS branch does need an attempt.** The original comment claimed a
   dedup hit "can never produce a matching success". True for games
   (`game_upload_succeeded` fires only in `finalize_upload`, which needs an
   upload session the branch never returns) but **false for clips**:
   `clip_uploaded` fires from a different endpoint, per newly-created `raw_clips`
   row, and the R2 clip object is keyed per USER while `raw_clips` is per
   PROFILE. Same file under a second profile, or re-uploaded after its row was
   deleted, would have been another "0 tried / 1 succeeded". The EXISTS branch
   now emits for clips only, with the asymmetry spelled out at the call site.
2. **The mini-funnel strip above the Users table** (`FunnelSummary` in
   `UserTable.jsx`) still used step-over-step percentages on the same
   `funnelTotals`, so one screen showed two different percentage meanings for the
   same numbers - and it could exceed 100% for the same reason. Same denominator
   applied.
3. **`UserDetailPanel` had the identical grain bug** on the panel an admin opens
   by clicking a table row: attempt = `game_created` (per game) against success =
   `game_upload_succeeded` (per file). The two surfaces disagreed for the same
   user, and a negative `gap` silently hid the red deficit chip. Switched to
   `game_upload_attempted` and reordered to attempted/succeeded so it matches the
   now-wordless table cell.
4. **Three of the new backend tests patched a binding the router never reads**
   (`app.storage.r2_head_object_global`; `games_upload.py` imports the name
   directly), making them non-hermetic - they were hitting real R2 and passing by
   accident. Retargeted to `app.routers.games_upload.r2_head_object_global`.

Also applied: the milestone write moved onto `run_in_context` (the offload idiom
this same file already uses for `record_upload_failure_from_payload`) so the
per-file emission does not block the event loop; the duplicate
`game_upload_succeeded_count` response key dropped in favour of the single
`game_succeeded_count`; stale `denominator_note` fixtures updated; a `title`
tooltip added to the Games header, whose sort dimension is deliberately not the
number the cell shows.

Two over-counts are documented at the call site rather than fixed, both inflating
only the "tried" half (so `tried >= succeeded` still holds): a lost ack on an
executed prepare retries into the resume branch, and an unaffordable upload books
an attempt because affordability is reported (`can_afford`) rather than refused.

## Test evidence

- `src/frontend` - the whole `components/admin/` suite plus
  `adminStore.uploadFailures.test.js`: **48 passed** across 8 files. New cases:
  funnel label-derived keys, the Clip Uploaded stage, no row exceeding 100% over
  the real prod shape, the distinct-users caption, the bare `N / M` cell, the
  cell ignoring the per-GAME `game_created_count`, and the detail panel not
  feeding `game_created` into the per-file pair.
- `src/backend` - `tests/test_t11010_upload_attempt_pairs.py`: **9 passed** (both
  kinds emit at prepare; `kind` decides, not file size; a GAME dedup hit emits
  nothing while a CLIP dedup hit DOES; rejected request emits nothing;
  registration / no-daily-col / not-a-funnel-step guards).
- `src/backend` - curated regression set `test_admin.py`, `test_analytics.py`,
  `test_analytics_dashboards.py`, `test_t8370_clip_upload.py`,
  `test_t7890_pre_upload_funnel_beacons.py`,
  `test_t7970_upload_failure_milestones.py`, `test_t8160_upload_self_abort.py`,
  `test_t9420_retry_idempotency.py` (the last two added for the prepare/resume
  path the new emission sits on): **234 passed, 1 skipped**.
- Lint: `ruff` clean on all changed backend files; `eslint` 0 errors on
  `components/admin/` (only the pre-existing unused-`React`-import warnings).
