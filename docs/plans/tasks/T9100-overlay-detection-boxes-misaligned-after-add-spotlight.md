# T9100: Player-detection boxes render offset from the video after "Add Spotlight Now"

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-08

## Problem

Reported live on staging (2026-09-08): clicking **Add Spotlight Now** on Focus's post-export
publish action bar (`FocusPublishActionBar` -> `FocusScreen.handleAddSpotlight` -> `setEditorMode('overlay')`)
lands on the Overlay screen with the player-detection boxes (`PlayerDetectionOverlay`) rendered
entirely disconnected from the actual players in the video — the green dashed boxes (and the
white highlight-selection ellipse) sit in a block of empty space to the LEFT of the visible video
content, not over any player. The "N players detected" badge and detection count are correct
(6 players, matching the visible frame), only the box *positions* are wrong. Confirmed at two
playback times (0:00 and 0:02) via user screenshots — not a one-frame flash, the offset persists.

User's own diagnostic note, from a second screenshot: **the dark canvas/container area visibly
stretches well past the actual displayed video** — the video occupies roughly the right half of a
much wider black panel, with the mis-positioned boxes sitting in the extra black space on the left.
This points at the container the video is measured against, not the detection coordinates
themselves, being the likely fault line (see Hypothesis below).

## Context

### Relevant Files
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` — renders the boxes; maps
  `detection.bbox` (video-space) to screen coords via `videoToScreen` (line 136).
- `src/frontend/src/hooks/useVideoDisplayRect.js` — the single source of truth for the
  video->screen transform. Computes the letterbox/pillarbox rect from
  `video.closest('.video-container').getBoundingClientRect()` (line 117-120) crossed with
  `videoMetadata.width/height`.
- `src/frontend/src/modes/OverlayModeView.jsx`, `src/frontend/src/containers/OverlayContainer.jsx`
  — mount the video + `.video-container` + `PlayerDetectionOverlay` for this screen.
- `src/frontend/src/screens/FocusScreen.jsx:1066` `handleAddSpotlight` — the entry point that
  navigates Focus -> Overlay via `setEditorMode('overlay')` (T8390, merged 2026-09-04). This is a
  newly-added navigation path into Overlay mode; the misalignment may be specific to whatever
  layout/mount state Overlay is in when entered this way vs. its other entry points (e.g. the
  top-nav Overlay tab), which may not exhibit the bug.

### Hypothesis (not confirmed — needs investigation, do not assume)
`computeVideoDisplayRect` derives `offsetX`/`width` from the CONTAINER's bounding rect, not the
video element's own rendered rect. If the `.video-container` ancestor found by `closest()` in this
entry path is wider than the actual letterboxed video (e.g. an outer wrapper that hasn't shrunk to
fit, or a stale/duplicate container from the newly-added preview-player shell `FocusPublishActionBar`
sits inside), `computeVideoDisplayRect` would compute a valid-looking but wrong `offsetX`/`scaleX`,
placing every box at a fixed leftward offset — matching exactly what's screenshotted. This would
also explain the user's separate observation that the canvas itself "stretches past its area."

`PlayerDetectionOverlay.jsx` already has a `[Detection Alignment]` `console.debug` (line 71) that
logs `videoMetadata` vs `detectionSource` dimensions and the computed `displayRect` — checking that
log on repro would quickly confirm or rule out a dimension mismatch vs. a container-measurement bug.

### Related Tasks
- Likely introduced or exposed by [T8390](T8390-focus-publish-exit.md) (Focus's new preview-first
  publish exit, merged 2026-09-04) — this is the first task to route Focus -> Overlay through
  `handleAddSpotlight` from the new post-export preview shell. Worth checking whether the same
  misalignment reproduces from Overlay's OTHER entry points (top-nav tab) to isolate whether this
  is a T8390-specific mount/layout issue or a pre-existing `useVideoDisplayRect` bug this path
  happens to newly expose.

## Model Policy note
Per this project's Model Policy, root-causing a bug whose mechanism isn't obvious from a first
read (this one: async layout timing vs. container-measurement bug vs. entry-path-specific mount
state, all plausible) should go to the expert agent before an implementation attempt — don't grind
a guess-and-check fix.

## Root cause (confirmed 2026-09-08, expert agent — read before implementing)

**Both hypotheses in the Problem section above are refuted. This is neither a container-measurement
bug nor a mount-order/timing bug — it is a silently-wrong `videoMetadata` bug, and it is more
serious than a display glitch: it also corrupts persisted spotlight geometry.**

### Mechanism
1. **The bad write** — `FocusScreen.jsx:1027-1030`, inside `handleProceedToOverlayInternal`'s
   null-blob branch (the only branch that runs for real server-authoritative exports). This is
   T8390's reviewer-fix commit `6ab3f5c1` (2026-09-04, "BLOCKING: the post-export preview never
   rendered..."):
   ```js
   const previewUrl = await resolveWorkingVideoPreviewUrl(projectId);
   if (previewUrl) {
     setWorkingVideo({ file: null, url: previewUrl, metadata: null });   // <-- metadata: null
   }
   ```
   This seeds the SHARED `projectDataStore.workingVideo` record with a URL but no metadata,
   violating the contract every other writer of that record honors (`FocusScreen.jsx:984`, `:1012`,
   `OverlayScreen.jsx:486`, `useProjectLoader.js:233` — all populate `metadata`).
2. **The real loader gets suppressed** — `OverlayScreen.jsx:445`: `if (!workingVideo && ...)`.
   `workingVideo` is now truthy (it has a URL), so the presign + `extractVideoMetadataFromUrl` path
   (`:465-486`) that would produce the REEL's true dimensions never runs. Nothing else backfills
   it — `useVideo`'s `handleLoadedMetadata` only sets metadata `if (!metadata)` and writes to a
   different store (`videoStore`) the overlays don't read.
3. **A banned silent fallback substitutes the wrong dimensions** — `OverlayScreen.jsx:238-242`:
   `effectiveOverlayMetadata = workingVideo?.metadata || (shouldWaitForWorkingVideo ? null :
   framingMetadata)`. `framingMetadata` comes from the SOURCE CLIP's raw landscape dimensions
   (`game_videos.video_width/height` via `clips.py:1001-1034`), never the exported 9:16 reel. This
   is exactly the CLAUDE.md-banned "silent fallback for internal data" pattern — a plausible-but-
   wrong number instead of a loud failure.
4. **Both reported symptoms follow deterministically**: the stage box sizes itself to the wrong
   16:9 aspect (`OverlayModeView.jsx:369-379`), stretching the black panel far past the actual
   9:16 video — the "canvas stretches past its area" symptom. `useVideoDisplayRect` then measures
   THAT panel against the SAME wrong metadata, so the transform is internally consistent (and
   therefore never self-corrects) but wrong — placing all 6 detection boxes in the left ~56% of
   the panel while the video renders centered at 34-66%.

### Why THIS entry path (and why the top-nav tab isn't actually safe either)
`handleAddSpotlight` itself is not special — it only closes the preview and calls
`setEditorMode('overlay')`, touching nothing metadata-related. The real trigger is "a Focus export
completed in this browser session" (which writes the bad record), not which button gets clicked
afterward. **The top-nav Overlay tab is not immune**: export → click Refocus (stay in Focus) → then
click the top-nav Overlay tab reproduces the identical bug, since `App.jsx`'s `handleModeChange`
does not reset `workingVideo` (Focus↔Overlay deliberately keeps loaded state, T6190). The paths
that ARE correct are the ones where a metadata-complete record gets written: opening a draft cold
from Drafts, a page reload, or (pre-T8390) entering Overlay after export before the reviewer fix
shipped.

### Secondary defect, same commit
`setIsLoadingWorkingVideo(true)` (`FocusScreen.jsx:1016`) is never cleared — it used to be cleared
by `OverlayScreen.jsx:487`, the branch that no longer runs. Drives a permanent loading spinner on
the Overlay tab for the rest of the session.

### Blast radius — this is a data-corruption bug, not just cosmetic
Every consumer of `effectiveOverlayMetadata` is poisoned in the same session, most importantly
`HighlightOverlay` (`OverlayModeView.jsx:509`): its drag/resize commits run screen→video through
the wrong `scaleX`, so `onHighlightComplete` (`HighlightOverlay.jsx:299-302`) **persists spotlight
geometry into `highlights_data` in the wrong coordinate space**. Also poisoned: `TextOverlayPreview`,
timeline duration (source clip's, not the reel's), poster-frame selection, and `videoStore`'s
duration via `loadVideoFromStreamingUrl`. **Open question for the user, not yet answered: do any
accounts need a data check/heal for spotlights added since 2026-09-04 (when `6ab3f5c1` shipped)?**
Surface this alongside the fix, don't implement a heal without user sign-off (data safety rule).

### Proposed fix (minimal, do not implement alternatives without discussion)
**File: `FocusScreen.jsx`.** Stop routing the post-export preview URL through the shared
`workingVideo` store record — it's an ephemeral modal that only needs a playable URL, and
`projectDataStore.workingVideo` is the Overlay editing canvas's source-of-truth record.
1. Add local ephemeral state next to `showExportCompletePreview` (`:96`):
   `const [exportPreviewUrl, setExportPreviewUrl] = useState(null);` (view state, not store).
2. At `:1027-1030`, replace the `setWorkingVideo({...})` call with `setExportPreviewUrl(previewUrl)`.
   Leave `setWorkingVideo(null)` (`:1018`) and `setIsLoadingWorkingVideo(true)` (`:1016`) untouched —
   this restores pre-`6ab3f5c1` store state.
3. At the preview render (`:1373-1378`), swap the guard/URL source from `workingVideo?.url` /
   `workingVideo.url` to `exportPreviewUrl`.
4. Clear `exportPreviewUrl` in all four T8390 exit handlers wherever `setShowExportCompletePreview(false)`
   fires, so a stale URL can't resurface.

This restores the "a `workingVideo` record with a `url` always has `metadata`" invariant with zero
changes to `OverlayScreen`, `useVideoDisplayRect`, `PlayerDetectionOverlay`, or `OverlayModeView` —
so the top-nav path, Drafts-open path, and every other consumer stay untouched. It also fixes the
stuck spinner for free (`OverlayScreen.jsx:487` runs again and clears it).

**Rejected**: probing the preview URL for real metadata (duplicates the loader's presign+probe on
the export critical path, second owner of the record) and making `PlayerDetectionOverlay`/
`useVideoDisplayRect` tolerate the mismatch (a defensive fix for an internal bug — banned).

**Recommended companion, implement as a SEPARATE reviewable change**: `OverlayScreen.jsx:238`'s
`shouldWaitForWorkingVideo` should key on `!workingVideo?.metadata` (not `!workingVideo`), mirrored
at the loader guard `:445`, so `effectiveOverlayMetadata` resolves to `null` (overlays hold off)
rather than the source clip's dims whenever a reel URL is loaded without metadata yet. Keep the
`framingMetadata` fallback only for the genuine no-`working_video_url`-at-all case. This removes
the banned silent fallback at its root rather than only patching this one call site — flag it to
the Reviewer as a distinct, separately-judgable change.

### Regression tests (3 proposed, see the expert agent's full report for detail)
1. **Unit — the write contract**: extend `focusPublishExit.test.jsx` to reproduce the null-blob
   branch verbatim (the current harness omits it); assert `setWorkingVideo` is never called with a
   truthy `url` and falsy `metadata`. Add a negative control (revert the fix, confirm the assertion
   fails).
2. **Unit — the read contract** (optional, only if the companion change is taken): a pure-function
   test for the `effectiveOverlayMetadata` derivation once lifted out of the component (note there's
   already a second, divergent copy at `OverlayContainer.jsx:127-137` — worth reconciling).
3. **E2E — the one that actually proves the pixels (highest value)**: Focus export → "Add Spotlight
   Now" → Overlay, asserting `getBoundingClientRect()` aspect ratio of the video stage equals the
   live `<video>` element's `videoWidth/videoHeight` (fails today, ~1.78 vs ~0.5625), plus a control
   case (open a project cold from Drafts, same assertions must pass) to prove only the post-export
   path was broken.

**Cheap permanent guard, add alongside the fix**: promote `PlayerDetectionOverlay.jsx:71-87`'s
`[Detection Alignment]` `console.debug` to `console.warn` when `dimensionMatch === false` —
detections are always produced from the working video's own dims, so a mismatch is always an
internal-data bug (CLAUDE.md no-silent-fallback) and should fail loudly.

## Acceptance Criteria
- [ ] Root cause identified and documented (why the container/box math is wrong specifically on
      the Focus -> Add Spotlight Now -> Overlay path)
- [ ] Detection boxes render aligned with actual player positions at both entry points into Overlay
      (top-nav tab AND Focus's Add Spotlight Now), at multiple playback times
- [ ] Verify the "canvas stretches past its area" symptom is fixed alongside the box offset (same
      root cause, per the hypothesis above) — or documented as a separate issue if it isn't
- [ ] Regression coverage added (existing `PlayerDetectionOverlay.test.jsx` / a new test) that
      would have caught this
