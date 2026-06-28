# T4080: Soccer-notation times on annotation clip lists + game-time ordering

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-06-28

## Goal (two parts)
**A. Show the clip's in-match time (soccer notation, e.g. `34'12"`) on every clip/playback list in
annotation mode, RIGHT-ALIGNED.** Today the desktop clip rows show only rating badge + name.

**B. Order clips listed under a game in Reel Drafts and My Reels by the time they occurred in the
game**, so that order MATCHES the annotation-mode clip list order. (User: "the orders should match up.")

## Build on T4070 (already shipped)
T4070 added `formatGameClock(seconds)` (`src/frontend/src/utils/timeFormat.js` -> `MM'SS"`) and an
inline `gameClockFor(clip)` in `AnnotateModeView.jsx` that computes the clip's in-match start:
`clip.startTime + (videoSequence>=2 ? boundaryOffsets[videoSequence-2] : 0)` (startTime alone for
single-video games). **Extract that into a shared helper** (e.g. `clipGameClock(clip, boundaryOffsets)`
in `utils/timeFormat.js` or a clip util) and reuse it in AnnotateModeView + the lists (DRY).

## Part A — annotation-mode clip/playback lists (right-aligned time)
Add the right-aligned in-match clock to each clip row. Components:
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` — the row (rating badge + index +
  name). Add the clock right-aligned (it has `region` with startTime/videoSequence; pass
  `boundaryOffsets` or a precomputed `gameClock` down from the parent). Desktop currently shows no
  time; mobile shows `formatTime(endTime)` — replace/augment with the soccer clock, right-aligned.
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` (~L241 maps regions -> ClipListItem)
  — pass what ClipListItem needs (boundaryOffsets is available in AnnotateModeView; thread it through).
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` (~L504 renders a clip list
  with RATING_NOTATION) — add the right-aligned clock there too.
- Any other annotation-mode playback list (e.g. PlaybackControls clip display). Audit `ClipListItem`
  usages + `clipRegions.map`/`annotateRegionsWithLayout` in `src/modes/annotate`.
- NOTE: `RecapClipsSidebar.jsx` reuses ClipListItem (recap mode). If adding the clock there needs the
  reel's frozen `clip_game_start_time`, handle gracefully (don't break recap); recap is lower priority.

## Part B — game-time ordering in Reel Drafts + My Reels
Within a game group, sort the reels/clips by their in-game time so it matches the annotation list.
- **My Reels** (reels grouped under a game): `src/frontend/src/components/DownloadsPanel.jsx` — the
  per-game grouping. Sort each game's reels by `clip_game_start_time` (frozen on `final_videos`,
  already returned by the downloads API; see `clip_game_start_time` in `downloads.py`/rank.py usage).
- **Reel Drafts** (draft projects grouped under a game): `src/frontend/src/components/ProjectManager.jsx`
  — sort each game's draft reels by the same in-game time. Drafts may not have a frozen
  `clip_game_start_time`; derive from the source clip's start_time + half offset (or the project's
  source raw_clip). Investigate what field is available and sort consistently.
- **Annotation list order** must be the reference: confirm ClipsSidePanel sorts by in-game time
  (videoSequence then start/end time). If it sorts by end_time, align all three to the SAME key
  (in-match start) so they match exactly.

## Verify (use the drive-app-as-user skill — REQUIRED)
Drive the running app as a real user (`.claude/skills/drive-app-as-user/SKILL.md` +
`e2e/helpers/realAuth.js`): open a game in Annotate and assert each clip row shows a right-aligned
`MM'SS"` time; then check Reel Drafts and My Reels under that game render the reels in the SAME
in-game-time order as the annotation list. Add an e2e spec for the ordering match if feasible.
Run: `cd src/frontend && E2E_BASE_URL=http://localhost:5173 npx playwright test e2e/<spec> --reporter=line`.

## Boundaries / commit
- Branch `feature/T4080-soccer-times-clip-lists`. Commit explicit paths only (never `-A`/`-a`;
  LF-normalize touched files — repo is LF). Co-author trailer. No status change. No merge.
- Lint: `npx eslint <changed files>` (0 errors). Vitest for any touched unit tests.

## Acceptance
- Every annotation-mode clip/playback list row shows the in-match soccer time, right-aligned.
- Reel Drafts and My Reels list a game's reels in in-game-time order, matching the annotation list.
- Correct for single-video games; correct half offset for two-half games.
