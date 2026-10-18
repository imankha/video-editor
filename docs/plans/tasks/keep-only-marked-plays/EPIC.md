# Epic: Keep Only Marked Plays

**Status:** TODO (decisions D1-D6 open, see below)
**Started:** 2026-10-18
**Completed:** -
**Impact:** 7 **Complexity:** 6 **Priority:** 1.2

## Goal

A parent who has finished marking a game can say "I only need the plays". The game switches to a
**plays-only** state: the full game video is no longer presented anywhere, only the marked plays are
viewable, and every play can still become a highlight. Until the source video reaches its normal
storage expiry the user can **restore the full video** with one tap. After expiry the game behaves
like any expired game today (plays survive, source is gone), minus the expiry nagging.

## Why

Once the plays are marked, the 60-90 minute file is noise: a long scrub timeline, the "Xd" expiry
chip, the storage banner, Extend prompts for a file the parent does not want. Today the only way to
reach "just the plays" is to wait for the game to expire. This makes that end state an explicit,
reversible gesture, and gives the expiry surfaces an honest off switch: a plays-only game never nags.

## Mechanism: reuse the expiry path, do not build a second one

The expiry path already produces exactly this state. Verified 2026-10-18 in code:

| Building block | Where | What it already does |
|---|---|---|
| Preservation | `auto_export.py::auto_export_game(user_id, profile_id, game_id)` | Stitches a native-quality recap per layer (`recaps/{game_id}[_team].mp4` + `_clips.json`), extracts 5-star plays to `raw_clips/auto_*.mp4` and leaves frameable drafts (T4175). Idempotent (T7600). Returns `complete / skipped / failed / unsynced`. |
| Plays-only viewing | `GET /api/games/{id}/recap-data` (`games.py` ~1938) | Prefers the stitched recap; falls back to seek-through of the game video (`video_kind='game'`) while the source exists. |
| Plays-only UI | `RecapPlayerModal.jsx` ("Watch plays") | Athlete / Team / Highlights tabs, per-play **Create clip** (highlight draft via `PUT /clips/raw/{id} {create_project:true}`), share. Works pre- and post-expiry. |
| Highlights from a gone source | `export_helpers.py::resolve_clip_source` | Game video, else preserved extract, else recap (T4140). This is why highlights keep working after reclaim. |
| Expiry sweep | `sweep_scheduler.py::do_sweep` | At expiry runs `auto_export_game`, drops the ref, 14-day grace, R2 delete. A game whose `auto_export_status='complete'` is already settled: **no sweep change needed**. |

So **keep-only = preserve now (same function) + a per-game flag** (`games.plays_only_at`) that routes
the tile to Watch plays, blocks the Annotate editor, and silences the expiry surfaces.
**Restore = clear the flag** while the storage ref is still live. The storage expiry date never moves.

## Found while scoping (bug, filed separately)

`_get_annotated_clips` filters `rc.rating IS NOT NULL`, and both the live Watch plays listing and the
expiry recap go through it. An unrated marked play is invisible in Watch plays today and
unrecoverable after reclaim. T12910 fixes that first (bugs before features); this epic depends on it,
because "keep only marked plays" must keep every marked play.

## Decisions needed from the user (before T12930 design)

| # | Question | Recommendation |
|---|---|---|
| D1 | Where does a plays-only game open on tile tap? | **Watch plays** (`RecapPlayerModal`). Zero new player code, identical pre/post expiry. Annotate-in-playback-mode is a later upgrade (the old T2410 epic). |
| D2 | Does keep-only change storage or credits? | **No.** The ref and expiry date are untouched (that is what makes restore possible). No refund, no early reclaim. It only silences nags. |
| D3 | Can a plays-only game still be shared? | **Yes.** Shares are already play-scoped ("Share plays"). Leave sharing as is. |
| D4 | When is the recap built? | **Immediately on keep-only, in the background.** Watch plays works meanwhile via game-video seek-through. Building it now means the state is robust even if the sweep later fails. |
| D5 | What does Restore do to the recap built in D4? | **Delete the recap objects and reset `auto_export_status` to NULL**, keep the per-play extracts (drafts may reference them). Otherwise `recap-data` keeps serving a frozen recap after the user marks new plays. |
| D6 | Expired plays-only game: still offer Extend inside the 14-day grace? | **No.** The user opted out of the full video; the tile stays "Plays only" and never turns yellow or grayscale. |

## Tasks

| # | ID | Task | Status | Tier |
|---|---|---|---|---|
| 0 | T12910 | [Unrated marked plays are dropped from Watch plays and the expiry recap](../T12910-unrated-plays-dropped-from-recap-and-watch-plays.md) (bug, lives in the bugs section) | TODO | M |
| 1 | T12920 | [Backend: plays-only game state, keep/restore endpoints, on-demand preservation](T12920-backend-plays-only-state-and-endpoints.md) | TODO | L |
| 2 | T12930 | [Frontend: Keep only marked plays action, plays-only tile, Watch plays routing, Restore](T12930-frontend-keep-only-plays-action-and-tile.md) | TODO | L |
| 3 | T12940 | [Plays-only games never nag: expiry chip, banner, Extend, expired skin](T12940-plays-only-expiry-surfaces.md) | TODO | M |

Related but independent, same milestone: T12950 (game tile shows the brilliant count beside plays
and finished).

## Non-goals (v1)

- No early reclaim of the source video and no credit changes (D2).
- No new Annotate playback surface; Watch plays is the plays-only viewer (D1).
- Pool / dual-camera per-feed keep (T7300) is a different feature; keep-only is hidden on pool games
  and on reference cards (shared-in games carry no storage semantics, T5800).
- No bulk "keep only plays for every game" action.

## Completion Criteria

- [ ] T12910 landed first (every marked play, rated or not, is in the recap and in Watch plays)
- [ ] Kebab "Keep only marked plays" on a live owned game with plays -> confirm -> tile reads "Plays only", tap opens Watch plays, every play can become a highlight
- [ ] "Restore full video" available until the storage expiry, returns the game to normal Annotate
- [ ] Plays-only game shows no expiry chip, no banner entry, no Extend, before or after expiry
- [ ] At expiry the sweep reclaims a plays-only game exactly like any other settled game (test)
- [ ] Knowledge docs updated: annotate.md (game states), export-pipeline.md (on-demand preservation), persistence-sync.md (v057)
