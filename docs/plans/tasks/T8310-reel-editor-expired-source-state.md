# T8310: Reel editor shows a deliberate "source expired" state instead of "Video format not supported" (bug 50p)

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-01
**Updated:** 2026-09-01

## Problem

Prod bug 50p (arshia.kalantari@gmail.com, 2026-09-01, build d9621161, /focus, project 17,
profile b95eb93b): opening a reel draft whose source game video was reclaimed after storage
expiry shows a red "Video Error: Video format not supported." banner and a broken player.
The reporter concluded the file was corrupt ("not supported format") when in fact storage
had expired and the R2 object `games/e072a689....mp4` was deleted post-grace (verified:
R2 HEAD 404, `game_ref_counts.ref_count=0`, `latest_expiry=2026-08-07`, no grace row left).

Mechanism, confirmed from his console logs:

1. `GET /api/projects/{pid}/clips/{cid}/playback-url` ([clips.py:2117](../../src/backend/app/routers/clips.py))
   presigns `games/{hash}.mp4` **unconditionally** - presigning a deleted key succeeds.
2. The `<video>` element gets an R2 404 XML body and reports code 4
   (`MEDIA_ERR_SRC_NOT_SUPPORTED`) - a browser video element cannot distinguish
   "object gone" from "bad codec".
3. `useVideo.js` burns a 3-attempt / ~6s format-error backoff retry loop (T5620), then
   [useVideo.js:1249](../../src/frontend/src/hooks/useVideo.js) renders "Video format not
   supported." - even though the FaststartCheck on-load probe had ALREADY logged
   `verdict=ERROR error=HTTP 404` before the first retry.

Annotate solved this exact problem in the bug 27p fix: `load_game` returns
`storage_status` via `_compute_storage_status` ([games.py:2901-2912](../../src/backend/app/routers/games.py))
and `AnnotateModeView` renders a deliberate expired state (`isSourceExpired`). The Focus and
Overlay editors never got that treatment - `storage_status` appears nowhere in their path.

## Solution

Two layers (defense in depth):

1. **Backend gate (parity with load_game):** the clip playback endpoints resolve the source
   game's storage status the same way `load_game` does and return a structured
   "source expired" signal (e.g. 410 with `{"code": "source_expired", "game_id": ...}`)
   instead of presigning a reclaimed object. Cover the seams that feed the reel editors:
   - `get_clip_playback_url` (clips.py:2117) - the one from the bug's HAR
   - the clip `/stream` proxy (clips.py:2180) and clip video redirect (clips.py:~2278)
   - the Focus/Overlay export entry points should refuse up front with the same code
     rather than failing mid-pipeline in Modal.
   Expired = game has a blake3 hash AND (game_storage expiry passed OR row absent with the
   object reclaimed). Reuse `_compute_storage_status` / `_is_game_storage_expired`; do not
   fork a third variant.
2. **Frontend deliberate state:** Focus/Overlay containers handle the `source_expired`
   response with an explicit panel ("This game's storage expired - extend storage to keep
   editing this clip", with an Extend affordance when `can_extend`), skipping the
   format-error retry loop entirely. Mirror Annotate's `isSourceExpired` pattern.
3. **Honest fallback message:** in `videoErrorClassifier.js` / `useVideo.js`, when the
   faststart probe verdict is HTTP 404, classify the failure as "video no longer
   available" (its own kind, no 3x retry - a 404 does not heal in 6 seconds) instead of
   `format-error`. This catches any future path that still hands the player a dead URL.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/clips.py` - playback-url (2117), stream (2180), redirect (~2278) seams
- `src/backend/app/routers/games.py` - `_compute_storage_status` (2009), `_is_game_storage_expired` (2032), load_game precedent (2901)
- `src/frontend/src/containers/FocusContainer.jsx` - videoUrl consumer
- `src/frontend/src/containers/OverlayContainer.jsx` - videoUrl consumer
- `src/frontend/src/hooks/useVideo.js` - error classification + retry loop (31-58, 1059, 1249)
- `src/frontend/src/utils/videoErrorClassifier.js` - add distinct kind for probe-confirmed 404
- `src/frontend/src/modes/AnnotateModeView.jsx` - `isSourceExpired` pattern to mirror
- `src/backend/tests/test_t4820_expired_source_status.py` - existing status-precedent tests

### Related Tasks
- Sibling: T8320 (drafts-surface expiry visibility + `_compute_storage_status` optimistic default)
- Sibling: T8330 (proactive expiry notification - prevents the situation)
- Precedent: bug 27p fix (annotate expired state), T4820, T3970 (share gating), T5620 (retry loop)

### Technical Notes
- Storage model context: game videos are metered, 30 days storage paid in credits at upload
  (`storage_credits.py`), reclaimed by the sweep after a 14-day grace. Draft clips have NO
  independent source copy (T4130) - losing the game source makes un-exported drafts
  un-editable BY DESIGN. This task is about telling the truth about it, not preventing it.
- `delete_ref` deletes the profile's `game_storage` row at reclaim (auth_db.py:497), so an
  expired-and-reclaimed game may have NO row - that is the case `_compute_storage_status`
  currently mis-reports as 'active' (fixed in T8320; this task should not depend on which
  lands first).
- Bug 50p remediation already done operationally 2026-09-01: arshia was granted 15 credits
  (balance 108 -> 123) and emailed an explanation + heads-up that games 5-12 (Pats/Carlsbad
  Cup, 17 un-exported draft reels) are in grace with deletions starting 2026-09-02. Games
  1-2 (Swallows Cup) are unrecoverable (objects deleted ~Aug 7-21).

## Implementation

### Steps
1. [ ] Failing tests: playback-url for a clip whose game storage expired returns the structured
       expired response, not a presigned URL (backend); Focus shows the expired panel, not
       "format not supported" (frontend unit on the container/view branch)
2. [ ] Backend: shared expiry gate on the three clip seams + export entry refusal
3. [ ] Frontend: `source_expired` handling in Focus/Overlay containers + expired panel view
4. [ ] Frontend: probe-verdict-404 -> "video no longer available" classification, no retry loop
5. [ ] Relevant test set + lint; Reviewer on the diff

## Acceptance Criteria

- [ ] A draft clip from a reclaimed game shows a deliberate expired state in Focus and
      Overlay (message + Extend affordance when extendable), never "Video format not supported"
- [ ] No 3x/6s retry loop when the source is confirmed gone (404 probe)
- [ ] Export from such a draft is refused up front with the same structured code
- [ ] Annotate behavior unchanged; live games unaffected
- [ ] Tests pass (backend seams + frontend classification/panel)
