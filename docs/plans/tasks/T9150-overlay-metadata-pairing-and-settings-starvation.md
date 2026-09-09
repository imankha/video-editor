# T9150: Overlay metadata half-record bug class + settings panel starved on 16:9 reels

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-09-09

## Problem

Filed from a live user report on staging (2026-09-09): after T9100 (merged) fixed the specific
Focus -> Add Spotlight Now -> Overlay metadata bug, the user reported the same symptom still
reproducing, plus a new one (Overlay's right-side settings panel missing entirely, compared
against production). A fresh expert-agent investigation (not a guess-and-check retry, per Model
Policy - one fix attempt had already shipped) found:

1. **T9100's fix is live and correct.** Confirmed via `/api/version` (staging backend at the
   post-T9100 commit) and by grepping the deployed frontend bundle for both T9100's and T9110's
   marker strings (present). A live Playwright repro of the exact Focus export -> Add Spotlight
   Now -> Overlay path on staging came back clean (correct geometry, settings panel present).
   The user's report is most likely explained by a **stale PWA-cached tab** (workbox precaching,
   `appVersion.js`'s bundle-check probe throttled to one per 5 minutes) - their export landed
   only ~5-10 minutes after the T9100/T9110 deploy.

2. **A real, still-shipping bug class exists underneath**, independent of the stale-tab
   explanation: `OverlayScreen.jsx` derives `effectiveOverlayVideoUrl` and `effectiveOverlayMetadata`
   from `workingVideo` via TWO SEPARATE fallback expressions. A half-populated `workingVideo`
   record (`{ url, metadata: null }` - the exact shape T9100's landmine writer, and any future
   writer, can still produce) makes `effectiveOverlayVideoUrl` resolve to the REEL's url (since
   `workingVideo` is truthy) while `effectiveOverlayMetadata` falls through to
   `framingMetadata` - the SOURCE CLIP's landscape dimensions. This is a banned silent fallback
   (CLAUDE.md: no silent fallback for internal data) that silently pairs two different videos'
   coordinate spaces.

3. **This single wrong value explains BOTH symptoms as one mechanism**, proven live by forcing
   the wrong aspect ratio on a correct page and reproducing both:
   - Detection boxes / spotlight ellipse drawn across the wrong (too-wide) stage -
     `useVideoDisplayRect.js` computes the transform from the wrong metadata against a stage
     sized for that wrong metadata, so boxes land in the pillarbox next to the actual video.
   - Settings panel starved to 0px width - `OverlayModeView.jsx`'s stage/settings row uses
     `lg:flex-none` on the stage column and `lg:flex-1 lg:min-w-0` on the settings column; a
     16:9-aspect stage (wrong OR genuinely landscape) at `lg:h-[70vh]` is wide enough to consume
     the entire row, leaving the settings column's `min-w-0` free to collapse to zero.

4. **Independent finding: the settings-panel starvation reproduces for ANY genuinely 16:9
   project today**, with fully correct metadata, no bug upstream - purely the CSS row math in
   (3)'s second bullet. Confirmed live: forcing a real 16:9 aspect ratio on a correct page
   starves the settings column to 0px at 1600x1200 and 2560x1440 (86px/54px slivers at smaller
   widths). This is a currently-shipping production bug, separate from the metadata bug, that
   this task also fixes since it's the same mechanism and the same file.

## Solution

Three fixes, from the expert investigation (do not deviate without a documented reason):

### Fix A - make the URL/metadata pairing atomic (closes the whole bug class)

`src/frontend/src/screens/OverlayScreen.jsx` (current derivation around the `effectiveOverlay*`
consts, and the loader guard that reads `!workingVideo`):

Replace the two independent fallback expressions with one usability check so a half-populated
record can never pair a URL from one video with metadata from another:

```js
// A workingVideo record is only usable when it carries BOTH a url and metadata.
// Pairing workingVideo.url with framingMetadata mixes two different videos'
// coordinate spaces - this is the T9100 bug class. Never allow it.
const workingVideoUsable = !!(workingVideo?.url && workingVideo?.metadata);
if (workingVideo && !workingVideoUsable) {
  console.error('[OverlayScreen] Half-populated workingVideo record - refusing it', {
    hasUrl: !!workingVideo.url, hasMetadata: !!workingVideo.metadata,
  });
}
const shouldWaitForWorkingVideo = !workingVideoUsable && (project?.working_video_url || isLoadingWorkingVideo);
const effectiveOverlayVideoUrl  = workingVideoUsable ? workingVideo.url      : (shouldWaitForWorkingVideo ? null : framingVideoUrl);
const effectiveOverlayMetadata  = workingVideoUsable ? workingVideo.metadata : (shouldWaitForWorkingVideo ? null : framingMetadata);
const effectiveOverlayFile      = workingVideoUsable ? workingVideo.file : null;
```

Then change the working-video loader's guard from `!workingVideo && ...` to
`!workingVideoUsable && ...`, so a half-record does not permanently block the one loader that
can repair it (today it does, forever, for the rest of the session - that's why the bug never
self-healed). This is not "self-repair of an internal bug" (banned) - it logs loudly and re-runs
the legitimate single owner of that data instead of substituting a different video's numbers.

**Verify** `effectiveOverlayFile` (or whatever the third field is named in the current code -
check, the expert's snippet may not have the exact current variable name) is threaded the same
way if the current code has a third `workingVideo.file` consumer.

### Fix B - delete the dead landmine writer

`src/frontend/src/screens/OverlayScreen.jsx` and `src/frontend/src/containers/OverlayContainer.jsx`
(`setOverlayVideoFile` / `setOverlayVideoUrl` / `setOverlayVideoMetadata`, and their only caller
`OverlayContainer.handleProceedToOverlay`): these three setters each call `setWorkingVideo` with
a record built from a STALE closure over the same `workingVideo`, so three calls in a row (their
only caller does exactly that) end with the LAST write winning and the earlier two fields lost -
constructing exactly the forbidden `{url, metadata: null}` (or worse) shape. Confirmed dead in
production (the live Focus -> Overlay transition goes through
`FocusScreen.handleProceedToOverlayInternal`, not this path), but still shipped in the bundle as
a footgun for the next refactor. Delete the three setters and `handleProceedToOverlay` together
(mechanical removal, grep first to confirm truly unreferenced elsewhere before deleting).

### Fix C - stop the stage from starving the settings column

`src/frontend/src/modes/OverlayModeView.jsx` (the stage/settings row, `lg:flex-none` on the
video column + `lg:flex-1 lg:min-w-0` on the settings column, and the stage box's
`aspectRatio`/`lg:h-[70vh]` sizing): give the settings column a floor and cap the stage's width
so `lg:h-[70vh]` can never produce a box wider than the row minus the panel, e.g.:

```
video column:    lg:w-fit lg:flex-none  ->  lg:w-fit lg:flex-initial lg:min-w-0
settings column: lg:flex-1 lg:min-w-0   ->  lg:flex-1 lg:min-w-[20rem]
stage box:       add lg:max-w-[calc(100%-22rem)] alongside the existing lg:h-[70vh]
```

Verify the exact current class names before editing (the file may have shifted slightly since
the investigation) and confirm the fix live at 1600x1200 and 2560x1440 with a genuinely 16:9
project - today the panel is 0px wide there with fully correct data.

## Live symptom check (do first, before any code change)

Before touching code: use Playwright to check whether the user's ORIGINAL live symptom
(misaligned boxes + missing settings panel on the specific staging clip/session they screenshotted)
still reproduces after a hard refresh, to confirm or refute the stale-bundle explanation. This is
informational (it does not gate the fix - Fixes A/B/C are worth shipping regardless, since Fix C
is a live bug on 16:9 reels even if the user's specific report was staleness) but should be
reported back to the user.

## Context

### Relevant Files
- `src/frontend/src/screens/OverlayScreen.jsx` - Fix A (derivation + loader guard), Fix B (dead setters)
- `src/frontend/src/containers/OverlayContainer.jsx` - Fix B (`handleProceedToOverlay` + its three setter props)
- `src/frontend/src/modes/OverlayModeView.jsx` - Fix C (stage/settings row CSS)
- `src/frontend/src/modes/overlay/overlays/PlayerDetectionOverlay.jsx` - already has the
  `console.warn` promotion from T9100; no further change expected, but re-verify after Fix A
- `src/frontend/e2e/T9100-overlay-detection-alignment.qa.spec.js` - extend per the test plan below
  (already mounts the real `PlayerDetectionOverlay` + `useVideoDisplayRect` via the `t9100diag`
  harness)

### Related Tasks
- Follows: T9100 (shipped the FocusScreen half of this bug class; this task closes the remaining
  general case + the independent 16:9 CSS bug)
- Investigation: expert-agent report, 2026-09-09, in this session's conversation (not a separate
  task file - full mechanism, evidence, and 4-point refutation of an alternate hypothesis
  (T9110 hijacking the render) are in this task file's Problem section above)

### Technical Notes
- The alternate hypothesis considered and REFUTED (with 4 independent disproofs, confirmed live):
  that T9110's post-export completion UI (`CollectionPlayer` + `OverlayPublishActionBar`) renders
  INSTEAD OF the normal Overlay editing view on the Add-Spotlight-Now entry path. It does not -
  it's an unconditional sibling render gated by `showExportCompletePreview`, which is fresh
  component-local state on every mount and cannot carry over from a prior session. Do not
  re-investigate this angle; it's closed.
- Fix A's `console.error` is a real, permanent runtime guard, not a temporary debug log - keep it.
- Fix C must be verified with a GENUINELY 16:9 project (not the metadata bug's fake-16:9), since
  it is a real, independent, currently-affecting-production issue.

## Implementation

### Steps
1. [ ] Playwright: check the user's live staging symptom after a hard refresh (informational, report back)
2. [ ] Fix A: atomic URL/metadata pairing in `OverlayScreen.jsx` + loader guard fix
3. [ ] Fix B: delete the dead landmine setters + their only caller
4. [ ] Fix C: settings-column floor + stage-width cap in `OverlayModeView.jsx`
5. [ ] Tests: extend `T9100-overlay-detection-alignment.qa.spec.js` with a settings-panel-width
       assertion (`>= 240px`, catches both Symptom 2 and Fix C's 16:9 case) at both the
       already-fixed metadata case AND a new genuinely-16:9 fixture; a Vitest unit pinning the
       `workingVideoUsable` derivation never yields `{url: reel, metadata: framingMetadata}`
       (negative control: current code fails it); assert zero `[Detection Alignment]` console
       warnings fire during a normal Overlay flow
6. [ ] Reviewer pass on the diff, commit

### Progress Log

**2026-09-09**: Filed from a live user report + expert-agent re-investigation (see Problem
section for full mechanism, evidence, and the refuted alternate hypothesis). Implementation
starting inline in the supervisor session (single-area frontend fix, not container-scale).

**2026-09-09 (live symptom check)**: Before writing any code, drove the user's exact repro
(staging, dev-login as imankh@gmail.com, project 60 "dfsadf", Focus -> Open in Focus -> Overlay
tab) via Playwright MCP against the user's own live browser profile. Hit a PWA update-gate
dialog ("A new version is ready") on the first load - confirming the stale-bundle hypothesis
directly. After "Update now", the SAME clip rendered correctly: `810x1440` metadata (not the
stale `1920x1080`), all 7 detection boxes precisely on the players, full Spotlight/Text/Thumbnail
settings panel present, zero `[Detection Alignment]` console warnings. User confirmed "staging
looked good" independently. Live symptom closed - was a stale cached tab, not a code bug.

**2026-09-09 (implementation)**: All three fixes shipped in one diff (Overlay-area, same root
investigation, small enough to review together):
- **Fix A**: extracted the derivation into a new pure, exported `deriveOverlayVideoSource()` at
  the top of `OverlayScreen.jsx` (unit-testable without a layout engine, matching this codebase's
  `fillerFits`/`pickPeekGap` pattern) and switched the component to call it. The loader guard
  (3 branches) now gates on `!workingVideoUsable` instead of `!workingVideo`, so a half-record no
  longer permanently blocks the one loader that can repair it. Found and fixed a real (harmless
  but sloppy) JS quirk while writing the unit test: `!x && (a || b)` returns `a` itself (a
  string), not a boolean, when `a` is truthy - coerced with `!!(...)`. Never affected behavior
  (only ever consumed in boolean contexts) but the pure function's contract needed to be exact.
- **Fix B**: confirmed `handleProceedToOverlay` (`OverlayContainer.jsx`) and its three landmine
  setters are truly dead in production (grepped every consumer of `OverlayContainer`'s return
  value - `overlay.handleProceedToOverlay`/`overlay.setOverlayVideo*` appear nowhere). Deleted
  the function, the three setters, the now-unused `extractVideoMetadata` import, and the matching
  prop-pass from `OverlayScreen.jsx`. Found a SECOND, related dead-code area while auditing this
  (`OverlayContainer.jsx`'s own internal `effectiveOverlayVideoUrl`/`Metadata` derivation, which
  has the SAME independent-fallback shape, feeding an exported `OverlayVideoOverlays` component
  that's also never rendered anywhere, plus a naming collision with the real `OverlayTimeline`)
  - scoped OUT of this diff to keep it reviewable; tracked as a follow-up, not silently expanded.
- **Fix C**: `OverlayModeView.jsx`'s stage/settings row - video column `lg:flex-none` ->
  `lg:flex-initial lg:min-w-0`, settings column `lg:min-w-0` -> `lg:min-w-[20rem]`, stage box
  gained `lg:max-w-[calc(100vw-22rem)]`. **Landmine hit and fixed**: the expert's proposed
  `calc(100%-22rem)` collapsed the FIXED (portrait) stage to 121px wide in the first live e2e
  run - a percentage `max-width` inside a `lg:w-fit` (fit-content) ancestor is circular (the
  child's max-width depends on a parent width the parent hasn't resolved yet). Switched to `vw`
  units, matching the file's own existing `lg:h-[70vh]` pattern (viewport-relative, no ancestor
  dependency) - confirmed correct via real Playwright measurement (473x840 exact match).
- **Tests**: new `overlayVideoSource.test.jsx` (6 unit tests pinning `deriveOverlayVideoSource`,
  including a negative control proving the old independent-fallback expression WOULD produce the
  poisoned pairing). Extended `T9100-overlay-detection-alignment.qa.spec.js` (real browser, T5380
  rule) with a settings-column-width assertion (>=240px) on all stages, bumped viewport to
  1600x1200 (where the task's evidence showed full 0px starvation, not just a sliver), added a
  new genuinely-16:9 stage + a 2560x1440 sweep across all three stages. Extended the
  `t9100diag` harness with a mirrored row + settings-column stand-in (harness duplicates
  `OverlayModeView`'s classes by hand, matching its existing pattern - keep both in sync).
  4/4 e2e pass with real DOM measurement; 60/60 relevant unit tests green; 0 new lint
  warnings/errors on any touched file.

**2026-09-09 (Reviewer pass, fresh-context, M-tier)**: 1 BLOCKING + 2 MAJOR + 7 minor. Verdict:
NEEDS REVISION. All BLOCKING/MAJOR addressed, verified, re-committed:
- **BLOCKING** (real): the shipped `lg:max-w-[calc(100vw-22rem)]` on the STAGE BOX was measured
  against the wrong reference. Production's row is NOT `100vw - 32px` - it's bounded by
  `App.jsx`'s `container mx-auto` (Tailwind default, maxes at 1536px) plus the card's `p-6
  border`. The Reviewer measured the shipped fix in real Chromium against the exact production
  class chain and proved the stage OVERLAPS the settings panel by 50-658px depending on
  viewport (0px settings-width was "fixed" but the panel is invisible under the
  `backdrop-blur` stage). **Fix**: moved the cap from the stage box to its COLUMN
  (`lg:max-w-[calc(100%-22rem)]`, a percentage - safe here because the column's OWN parent,
  the row, has a definite width, unlike the box's `lg:w-fit` parent). Stage box reverted to
  `max-w-full` only. Re-verified live: exact match to the Reviewer's own independently-computed
  proof numbers (1102x840 stage, 328px settings, both at 1600x1200 and 2560x1440).
- **MAJOR** (real): the e2e harness had DROPPED its `maxWidth: 1280` cap entirely (making the
  row `100vw`, even more generous than the buggy `22rem` assumption), and the spec asserted only
  `settingsWidth >= 240`, never checking the stage doesn't visually overlap it - so the harness
  could not have caught the BLOCKING issue above. **Fix**: wrapped the harness root in the same
  `container mx-auto px-4` (max 1536px) + card `p-6 border` shell as production, and added
  `assertNoStageSettingsOverlap` (stage's right edge <= settings' left edge) to all 4
  settings-relevant tests, plus `assertNoHorizontalOverflow` to the 3 that lacked it.
- **MAJOR** (moot after the BLOCKING fix): `aspectdiag/main.jsx` (T5676's harness) was flagged as
  a stale 3rd hand-copy of the stage-box class. Since the BLOCKING fix moved the cap OFF the
  stage box entirely, the box's class string is now back to exactly what `aspectdiag` already
  had (no divergence) - `aspectdiag` needed no change. Confirmed by diffing the three copies
  after the fix.
- **Minor #2** (real, fixed): the half-record `console.error` ran in the render body
  (`OverlayScreen` re-renders every `currentTime` tick -> unbounded error spam for a persistent
  half-record). Moved into a `useEffect` keyed on `[workingVideo, workingVideoUsable]`.
- **Minor #6** (real, fixed): `overlaydiag/main.jsx` still passed no-op
  `setOverlayVideoFile/Url/Metadata` props that `OverlayContainer` no longer destructures.
  Removed.
- **Minor #7**: the second dead-code area (Fix B's scope note) is the same surface as the
  existing **T4440** row - named explicitly now, nothing further to do here.
  Minors #1/#3/#4/#5 were either superseded by the BLOCKING fix (#1, #4 - the vw-vs-% comment
  and the 22rem/20rem arithmetic both changed with it) or accepted as documented tradeoffs (#3
  loader-repair edge case, #5 export-for-test module split) - not blocking, not actioned.
  Re-verified: 4/4 e2e (now with overlap+overflow assertions) pass, 60/60 unit tests green, 0
  new lint warnings on any touched file including the two newly-touched harnesses.

## Acceptance Criteria

- [x] A half-populated `workingVideo` record (`url` present, `metadata` null) can never produce
      `effectiveOverlayMetadata !== null && effectiveOverlayMetadata !== workingVideo.metadata`
      (i.e. can never pair a URL with a different video's metadata) - pinned by a unit test
      (`overlayVideoSource.test.jsx`, incl. a negative control)
- [x] The working-video loader can still repair a half-populated record (not permanently blocked)
      - loader guard now gates on `!workingVideoUsable`, not `!workingVideo`
- [x] The dead landmine setters (`setOverlayVideoFile`/`Url`/`Metadata`) and their only caller are removed
- [x] Overlay's settings panel never renders narrower than 240px for a genuinely 16:9 project at
      1600x1200 and 2560x1440, verified live via Playwright `boundingBox()` - via the `t9100diag`
      harness's real mount of `OverlayModeView`'s exact stage/settings row classes (same
      dev-harness-instead-of-full-pipeline precedent as T5676/T9110; a real Focus/Overlay export
      needs Modal, disabled in this environment)
- [x] Detection boxes remain correctly aligned for the already-fixed Focus -> Add Spotlight Now
      path (no regression from Fix A/C) - FIXED-stage e2e still passes with exact stage/video match
- [x] Live staging symptom check (Playwright, post hard-refresh) reported to the user - confirmed
      stale PWA tab (update-gate dialog fired), fresh bundle renders correctly; user independently
      confirmed "staging looked good"
- [x] Unit + e2e green; Branch CI green - merged PR #375, CI green except the documented
      pre-existing `uploadManager.attachVideo.test.js` flake
