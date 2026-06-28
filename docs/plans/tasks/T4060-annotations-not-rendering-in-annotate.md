# T4060: Annotations not rendering in the Annotate view (DIAGNOSE + INSTRUMENT)

**Status:** TODO
**Impact:** 10
**Complexity:** 4
**Created:** 2026-06-28

## DIAGNOSE + INSTRUMENT ONLY this pass
Replicate + confirm the bug, then add tracing logs. Do NOT ship a fix unless it is trivial, certain,
and safe. Producing a **failing reproduction test** (frontend) is the goal. Separate branch
`feature/T4060-annotations-not-rendering`. No status change, no merge.

## Symptom
Opening a game in the **Annotate** view shows the video but an **EMPTY clips timeline** ("Use Add Clip
button or pause in fullscreen to add clips") — none of the saved annotations render. Reproduces on
**prod AND local `master`** (so it's a code bug in current master, not a deploy artifact). Affects
(apparently) ALL accounts.

## What is ALREADY established (trust this — don't re-derive)
- **Data is present.** `raw_clips` has all annotations: game 6 (Legends)=32, game 7 (Sporting)=13,
  152 total, all rated. Games have correct `video_duration` (~5389-6108s) and dims (1920x1080).
- **Backend `/load` RETURNS them.** Prod HAR: `GET /api/games/7/load` -> 200 with
  `game.annotations` length **13**, `video_duration` 6108, `video_width/height` 1920/1080,
  `videos: 1`. So `load_annotations_from_db` (games.py:1484) + `/load` (games.py:2111) are FINE.
- => The bug is **frontend: annotations arrive but never render as clip regions.**

## Key runtime clues (from prod console + the annotate screen)
1. **Video duration is WRONG.** The player shows total `00:32:59.519` (~1979.5s) but the game video is
   ~5389-6108s. The `<video>` element is reporting a far shorter duration than the real game.
2. Console (sparse): `[FaststartCheck] on-load verdict=ERROR error=Failed to fetch probe=1725ms` and
   `[VIDEO] Suspend currentTime=0 ... readyState=4`. **No** `[useAnnotate]` import/queue/pending logs
   appeared (suggesting `importAnnotations` may not have run, or queued and never flushed).

## Where to look (call chain — all current master)
- `src/frontend/src/containers/AnnotateContainer.jsx`
  - `handleLoadGame` (~L564): gets `gameData = loadResult.game` (has annotations), calls
    `applyGameData` then `importAnnotations(gameData.annotations, gameDuration)` (~L664) where
    `gameDuration = videoMetadata?.duration || gameData.video_duration`.
  - `applyGameData` (~L467): builds `videoMetadata` for single-video ONLY when
    `gameData.video_duration && gameData.video_width && gameData.video_height` (all present here).
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js`
  - `importAnnotations` (~L655): if `effectiveDuration` falsy -> **queues to `pendingAnnotations`,
    returns []**; else maps annotations -> `setClipRegions`. Pending **flush** effect (~L282) runs
    only when `duration` state becomes truthy. `duration` is set from `videoMetadata.duration`
    (~L272) or `initialize(videoDuration)` (~L324).
- `src/frontend/src/containers/annotateVideoLoad.js` (T4000: early gameId-only `/video` src set
  BEFORE `/load`, parallel) — prime suspect for the wrong duration + the FaststartCheck error.
- `src/frontend/src/screens/AnnotateScreen.jsx` (T3960: source-clip select gated on `duration > 0` /
  video-seekable, ~L384-460) and `useVideo.js` / `utils/probeVideoUrl.js` / `utils/mp4Faststart.js`
  (FaststartCheck).
- Recent pushes most likely involved: **T4000** (parallelize game video fetch with `/load`),
  **T3960** (seekable gating), faststart checks.

## Leading hypotheses (confirm, don't assume)
- The T4000 early `/video` src yields a `<video>` whose duration is wrong/short (1979.5s) and/or the
  FaststartCheck "Failed to fetch" leaves the video non-seekable; either could make `importAnnotations`
  queue (falsy/!=expected duration) and the pending-flush never fire, OR a seekable/duration gate
  suppresses the clip regions. Note: `gameDuration` passed to `importAnnotations` SHOULD be the
  correct `gameData.video_duration` (5389-6108) from `/load`, so clips *should* import — figure out
  why they don't (does `importAnnotations` actually run? does `setClipRegions` get the regions? does
  the timeline render them against the wrong video-element duration?).

## Your job
1. **Replicate** with a frontend test (Vitest) that drives the real annotate import path with a
   `/load`-shaped game object (annotations present, correct `video_duration`/dims) and asserts
   `clipRegions` get populated / the timeline would render them. Make it FAIL to reproduce. Also probe
   the wrong-duration angle (simulate the `<video>` element reporting a shorter duration than
   `gameData.video_duration`).
2. **Confirm the exact mechanism** (file:line): does `importAnnotations` run? queue to pending? does
   the flush fire? is rendering gated on the wrong (video-element) duration or on seekable/faststart?
3. **Add tracing logs** (clear `[Annotate]`/`[useAnnotate]` prefixes) along the path: gameData
   annotations count at handleLoadGame, the `gameDuration` computed, whether importAnnotations imports
   vs queues, the pending-flush, and the video element's duration vs gameData.video_duration. So a
   future run is traceable from logs alone.
4. Report root cause + a proposed fix (don't implement unless trivial+certain).

## Verify / run
- `cd src/frontend && npm test` for the annotate tests (redirect; report exit + the failing repro).
- `from app.main import app` not needed (frontend-only); if you touch backend, verify the import.

## Boundaries / commit
- Branch `feature/T4060-annotations-not-rendering`. Commit only test(s)/logging, explicit paths
  (never `-A`/`-a`; LF-normalize touched files). No status change. No merge.

## Deliverable
1. Failing repro test (path).
2. Exact mechanism (file:line) annotations don't render + which clue (wrong duration / faststart /
   pending-never-flush / gate).
3. Tracing logs added (where).
4. Proposed fix + trade-offs.
