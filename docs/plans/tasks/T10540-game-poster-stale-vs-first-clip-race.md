# T10540: Game thumbnail shows a real play

**Status:** STAGING
**Impact:** 4
**Complexity:** 3
**Created:** 2026-09-19
**Updated:** 2026-11-14

## In plain words

On the home screen every uploaded game has a small picture on its tile, meant to show the start of the game's best-rated play. Today it is made once, when the upload finishes and no play is marked yet, so it shows one minute into the video and never changes (seen 2026-09-19 on a game with a five-star play). Make the picture follow the best-rated play: every time a game has a new best-rated play, because a play was saved, re-rated, moved or deleted, the picture is remade from that play's first moment. Best-rated means the most stars, and the earliest play when several tie. A game with no plays keeps the one-minute picture. If the remake fails or the game video has expired, the old picture stays. Worked when a fresh upload's picture changes after its first play is saved and changes again when a later play is rated higher.

## Ruling

Owner, 2026-11-14: reset the picture every time there is a new top-rated play.

## The rule

1. **Which play is the top-rated play.** Among the game's plays, the one with the most stars. When several share the top rating, the one that starts earliest in the game. A play with no rating ranks below every rated play. Any play beats no play.
2. **Which frame is the picture.** The first moment of the top-rated play, taken from the game video that play was marked on (a game can have more than one video file).
3. **No plays.** The picture is the frame one minute into the first video, or the last frame available when the video is shorter than a minute. This is today's behaviour and stays.
4. **When the picture is remade.** Whenever the answer to 1 and 2 is different from what the stored picture was made from. That covers every case with one check:
   - the first play is saved (one-minute picture becomes the play);
   - a new play is rated higher than the current top play;
   - a rating is raised or lowered so a different play is now on top;
   - the top play's start is moved (same play, different first moment);
   - the top play is deleted or moved to another game (next-best play, or back to the one-minute picture when none is left);
   - a play shared in from a teammate becomes the top play.
5. **When it is not remade.** A new or changed play that does not change the answer to 1 and 2 costs nothing: no video is read.
6. **Never show nothing.** The new picture replaces the old one only after it has been made and stored. If making it fails, the old picture stays and the failure is logged as a warning.
7. **Expired game video.** With no game video left there is nothing to take a frame from. The picture that exists stays; a game that never had one uses the picture from its recap video, as today.
8. **Recap video does not win while the game video is live.** Today a game that has a recap video (made when a share link is created) takes its picture from the recap and stops following plays. Under this rule the top-rated play wins for as long as the game video exists.
9. **The parent sees it without waiting a day.** The browser keeps the picture for a day under one fixed address. The address must change when the top-rated play changes, so the tile shows the new picture the next time the Games list is opened.

## Implementer details

Checked against the code on 2026-11-14. Re-grep line positions.

- **One place decides, no hooks in the save paths.** `ensure_game_source_poster` in `src/backend/app/services/poster.py` returns on a cache hit before it chooses a frame. Change the hit test from "the object exists" to "the object exists and was made from the current choice". Do the choice first (`_choose_game_poster_frame`, else the primary video with `_clamp_fallback_seek`), then HEAD the card key and compare.
- **What the picture was made from lives on the stored object.** The upload already writes R2 metadata (`width`, `height`). Add the source video hash and the timestamp (fixed to 3 decimals, as a string). `r2_head_object_global` in `storage.py` already returns `Metadata`. No new column and no migration: it describes the object, not the game.
- **Old pictures.** An object with no source metadata counts as stale and is remade once on its next request. No backfill script.
- **Why not invalidate on write.** Plays are written in at least eight places (`clips.py` save, update, link, delete and two import inserts; `services/materialization.py` for shared-in plays; `games.py` when uploads are unlinked). A check at the single read point cannot miss one. `invalidate_draft_poster` is the pattern NOT to copy here: it deletes first, which breaks rule 6.
- **The choice query already matches rule 1** (`ORDER BY rc.rating DESC, rc.start_time ASC`; SQLite sorts NULL ratings last under DESC). Add a test that pins the unrated case.
- **Replace in place.** Upload over the same card key (`recap_card_poster_r2_key`). Do not delete before upload. On extraction or upload failure return True when an old object exists, so the endpoint keeps serving it.
- **Warmers.** `PosterWarmer.warm_game_source_poster_async` in `services/poster_warmer.py` has its own "already exists" double-check that returns before calling `ensure_game_source_poster`. Remove that double-check or give it the same staleness test, otherwise the warmer reports a stale picture as warm. The in-flight dedup stays. The two fire-and-forget callers (upload activation in `games.py` and `warm_visible_game_sources` in the Games list) then become harmless: whichever runs last makes the same picture.
- **Rule 8.** `get_game_poster` in `routers/games.py` branches on `recap_video_url` first. Change the order: try the source picture when the game video is live; fall to `ensure_recap_poster` only when `ensure_game_source_poster` returns False. `warm_visible_game_sources` skips games with a recap; drop that skip.
- **Rule 9.** `GameTile.jsx` builds `/api/games/{id}/poster.jpg?profile_id=...` and the endpoint answers `Cache-Control: private, max-age=86400`. Add a picture version to each game in the Games list response, derived in the list query from the top play (play id and start time, or a constant when there are no plays), and append it to the tile address as a query value. The endpoint ignores the value; it only changes the address. Confirm the Games list is refetched when the parent returns Home from marking plays; if it is not, that refetch is part of this task.
- **Optional speed-up, only if the tile is visibly slow:** fire the existing background warm after a play save. Not needed for correctness.
- Existing tests to extend: `src/backend/tests/test_t5681_game_poster.py`, `test_t5683_gesture_warming.py`, `test_t7940_poster_http_integration.py`.

## Acceptance Criteria

- [ ] Fresh upload with no plays: the picture is the one-minute frame.
- [ ] Saving the first play remakes the picture at that play's start.
- [ ] Saving a higher-rated play remakes it; saving a lower-rated or equal later play does not read the video at all.
- [ ] Lowering the top play's rating below another play, moving its start, and deleting it each remake the picture to the new answer.
- [ ] An unrated play ranks below a rated one and above no play.
- [ ] A stored picture with no source metadata is remade once, then left alone.
- [ ] A failed remake leaves the old picture served and logs a warning.
- [ ] A game with a recap video and a live game video shows the top-rated play, not the recap.
- [ ] A game whose video has expired keeps its picture.
- [ ] In the browser, on a fresh upload: mark and rate a play, go Home, and the tile shows the play without a hard refresh.
