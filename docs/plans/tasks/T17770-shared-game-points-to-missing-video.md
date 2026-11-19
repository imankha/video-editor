# T17770: Shared game video is missing

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A shared game opens its title and list of plays, but the video cannot play. Its video address points to a file that does not exist. The viewer receives no useful explanation. This link played earlier in the same QA pass. It failed after the returning parent used Keep only marked plays and Restore full video. That sequence is context, not a proven cause.

## Repro steps

1. On staging, use the QA-created game qa18-game in the Default profile of e2e@test.local.
2. Before revocation, open its public game token beginning 63941a86 while signed out on a real touch phone context at 390 x 844.
3. Observe the title and marked play list, but no playable video.

Expected: An active public game link plays its game plays, or shows a clear recovery message.
Actual: The shared data returns successfully but its recap video request returns 404 NoSuchKey. The video element has readyState 0 and MEDIA_ERR_SRC_NOT_SUPPORTED (code 4).
Repeats: Three fresh signed-out phone page loads. Build of the signed-in app was 91f0e6792 (#8105). Desktop had played this link earlier; this exact later failure was measured on phone only.

## Evidence

Screenshots: qa/qa-pass-2026-11-18/bugs/B10-shared-game-repro1.png through B10-shared-game-repro3.png. Sanitized requests and video state: B10-shared-game.json. Missing object path ends in profiles/4345b661/recaps/20_team.mp4. Response body: <Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>. Signed URL credentials are omitted. The single-highlight public link still plays on the same phone context.

This test game also has seven uploaded videos and one team play. The owner used storage Keep only marked plays, then Restore full video, before this failure was found. Do not assume which mutation removed the object. The link was subsequently turned off as required by the revocation check; the retained game and screenshots are evidence. To recheck, make a fresh public game link through the app.

Console: media request 404; no separate JavaScript exception established. Server logs: Fly logs were available, but no request id accompanies the direct storage 404. This is a missing storage object, not an API 500.

## Solution

Ensure public game links refer to existing playable recap media, including after storage transitions. Show a clear error and recovery path if the video cannot load.

## Relevant Files

- src/backend/app/routers/shares.py, public game recap_url resolution.
- src/backend/app/routers/games.py, storage transitions and game share creation.
- src/frontend/functions/shared/game/[token].js, public player and failure feedback.

## Acceptance Criteria

- [ ] C1: A public game link plays on signed-out phone and desktop after Keep only marked plays and Restore full video.
- [ ] C2: An unavailable media object produces a readable error instead of an empty nonplaying viewer.
