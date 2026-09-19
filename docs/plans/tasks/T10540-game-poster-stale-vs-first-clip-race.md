# T10540: Game poster/thumbnail races the first clip save, caches the wrong frame forever

**Status:** TODO
**Impact:** 4
**Complexity:** 4
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

Found live while testing T10520/T10530 (unrelated): uploaded a fresh game
("Game uploaded Sep 19"), marked and saved a play at ~1:14 while the upload was
still finishing (the app's own supported "annotate during upload" flow), rated it
5 stars. Afterward, the game's Home > Games thumbnail shows a visibly different
framing of the field than the actual footage at any point near the marked clip —
it never updated to reflect the play.

## Investigation (read-only, `Explore` agent)

**Key files:**
- `src/backend/app/services/poster.py` — `ensure_game_source_poster()`,
  `_choose_game_poster_frame()`, `GAME_POSTER_FALLBACK_OFFSET_SEC = 60.0`
- `src/backend/app/services/poster_warmer.py` — `warm_game_source_poster_async`/
  `_background` (cache-first, in-flight dedup)
- `src/backend/app/routers/games.py` — `get_game_poster` (serves `GameTile`'s
  `<img>`), the activation endpoint's poster-warm call, `list_games`'s
  `warm_visible_game_sources`
- `src/frontend/src/components/GameTile.jsx:181` — `posterUrl = /api/games/{id}/poster.jpg`

**Confirmed:** the local-preview-during-upload flow is real and intentional
(`uploadStore.js`; `create_game` in `games.py` creates the row `PENDING` before R2
validation specifically so Annotate can attach clips mid-upload).

**Root cause hypothesis (medium-high confidence, not yet live-confirmed via logs):**
a genuine race between two independent async writers of the SAME cached R2 key, with
no ordering guarantee and no invalidation on the losing side:

1. Game upload completes -> activation fires `warm_game_source_poster_background`
   essentially immediately.
2. `_choose_game_poster_frame` picks the highest-rated clip's `start_time` — but if
   the game has **zero `raw_clips` rows yet** (very likely at this instant, since
   marking+saving a play is a multi-step manual UI flow that takes real wall-clock
   time), it falls back to a **fixed `GAME_POSTER_FALLBACK_OFFSET_SEC = 60.0`** frame.
3. `ensure_game_source_poster` (and `ensure_recap_poster`) **cache-check first**
   (`r2_head_object_global(poster_key) is not None -> return True`, no
   re-generation). Grepping the backend for writers of `recap_card_poster_r2_key`
   finds **zero invalidation calls anywhere** — no hook fires when a `raw_clips` row
   is later created or rated for that game (unlike reel drafts, which have
   `invalidate_draft_poster` — game posters have no analog).
4. `list_games`'s `warm_visible_game_sources` reproduces the same race independently
   on every Games-tab load for any recap-less game between upload-complete and the
   first clip save.

Net effect: the poster freezes on whichever frame was available at FIRST warm (here,
the arbitrary 60s fallback) and never updates once a real clip exists and is rated —
this is a caching/invalidation gap, not a one-off fluke.

**Not yet verified:** live timing of `/activate` vs. the clip save (did the warm
genuinely fire before `raw_clips` existed?), and server log correlation
(`[GamePoster]`/`[PosterWarm]` lines for this game_id, timestamped before the clip's
`created_at`) to confirm definitively rather than infer from code alone.

## Suggested Fix Direction (not yet designed/approved)

Most likely: add a `recap_card_poster_r2_key` invalidation (delete + re-warm, mirroring
`invalidate_draft_poster`'s pattern) at whatever surgical write path creates the FIRST
`raw_clips` row for a game (and/or on a rating change, since `_choose_game_poster_frame`
picks by highest rating). Needs an Architect/expert pass before implementing — this
touches a shared R2-cached asset with fire-and-forget background warmers from two
call sites, so the fix must avoid reintroducing a new race on the invalidate side.

## Context

### Relevant Files
- `src/backend/app/services/poster.py`
- `src/backend/app/services/poster_warmer.py`
- `src/backend/app/routers/games.py`
- `src/frontend/src/components/GameTile.jsx`

### Related Tasks
- Found as a byproduct of T10520/T10530 (play-progress badge work) live-testing —
  unrelated to those changes.

## Acceptance Criteria (draft, pending design)

- [ ] A game's poster reflects its actual highest-rated clip once one exists, even
      if the poster was already warmed (with a fallback frame) before the clip landed
- [ ] Live-verified: reproduce (upload, let activation warm the poster, THEN mark +
      save a rated clip), confirm the poster updates on next load
- [ ] No new race introduced on the invalidate/re-warm path
