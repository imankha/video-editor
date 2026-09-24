# T11130: Done popup (Make Highlight Now / Keep Annotating); remove Create clip + Frame CTAs; new badges

**Status:** TODO
**Impact:** 9
**Complexity:** 5
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

Turning a play into a clip is a separate, easy-to-miss control today (badge nudge "Create clip",
play-selected row Frame Now / Frame Later from T10450, post-creation "Frame" stage CTA). The user
wants the Highlight rating plus Done to be the whole gesture.

## Solution

1. **Popup on Done** when the play is rated Highlight (5) and has no clip (`selectedRegion.autoProjectId`
   empty). Presentation + copy per T11100 section B.
   - **Make Highlight Now**: reuse the Frame Now path exactly - `AnnotateModeView.jsx`
     `handleFrameNow` (233): `onFullscreenUpdateClip(id, {createProject: true, silent: true})`,
     await region writes (`awaitRegionWrites`, the rating commit is queued), then
     `onOpenClipInFocus(projectId)`. Do NOT reuse `handleCreateClipFromBadge`
     (`AnnotateFullscreenOverlay.jsx:385`): its non-silent path fires the "is now in Clips" toast
     + `selectProject` before navigation.
   - **Keep Annotating**: reuse `handleFrameLater` (259): same call without `silent`, stays in
     Annotate. `announceReelCreated` (`AnnotateContainer.jsx:93`) shows the "{name} is now in Clips"
     toast; its copy becomes the teaching line (make it a highlight later from Clips), and its
     "Open Framing" action uses the new noun.
   - Synchronous ref guard against double-create (pattern: `frameCreateInFlightRef` :215, the
     T9830/T10240 convention). The badge's state-only guard is not enough.
   - Escape / dismissal per H4 (recommended: back to the editor, no write). Never close on backdrop.
2. **Remove** (H8 decides the stage CTA):
   - Badge nudge + `handleCreateClipFromBadge`; T10450 Frame Now / Frame Later row
     (`AnnotateModeView.jsx:1211-1235`) and handlers once the popup owns them.
   - Dead `clipStage.js:66-74` `createActions`.
   - displayNames keys: `CREATE_CLIP`, `CLIP_CREATED`, `CREATE_CLIP_NUDGE_HINT`,
     `SAVE_AND_CREATE_CLIP_NUDGE_HINT`, `CLIP_BADGE_DORMANT_HINT`, `FRAME_NOW`, `FRAME_LATER`,
     `FRAME_LATER_HINT`, `CREATE_EDITABLE_CLIP`, `SAVE_PLAY_AND_CLIP`, and `FRAME_THIS_CLIP*` /
     `KEEP_MARKING_PLAYS` if H8 removes the stage CTA. **Check consumers first**: `FRAME_CLIP` is
     also used by `ClipSelectorSidebar:322` (Focus) and `PREPARING_CLIP` by `ProjectManager:1661`.
3. **Badges**: implement the T11100 section A pick in `PlayProgressBadges.jsx`
   (+ `playProgress.js` `CLIP_NUDGE_RATING` semantics). All mockup options drop the chess
   notation (`!!` etc.) the rated badge and picker show today (`PlayProgressBadges.jsx:233,304`).
   Team plays (H13) follow the user's ruling.
4. Quest copy pointing at removed controls: `questDefinitions.jsx:174` (`annotate_brilliant`) and
   :180 (`playback_annotations`). Persisted step ids unchanged.

History: the Frame Now / Frame Later row being replaced shipped as T10450 (master commit
`dd34dc65`; read that diff for the handlers and tests). A discarded 2026-09-24 uncommitted attempt
only relabelled the badge nudge "Create clip" -> "Frame" (`ANNOTATE.FRAME_THIS_CLIP`) while the
click still only created the clip; that label/behavior mismatch is exactly what this task avoids.

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx`, `playProgress.js`, `clipStage.js`
- `src/frontend/src/containers/AnnotateContainer.jsx` (`announceReelCreated`, `updateClipRegionWithSync` :1716)
- `src/frontend/src/config/displayNames.js`, `questDefinitions.jsx`

### Server side (unchanged)
`PUT /clips/raw/{id}` -> `_create_auto_project_for_clip` (`clips.py:1073`): idempotent 9:16
`projects` row (`is_auto_created=1`) + one `working_clips` row. Nothing server-side creates a clip
from a rating; keep it that way (never create reactively when rating reaches 5).

### Tests to rewrite
Unit: `AnnotateModeView.frameClip`, `AnnotateFullscreenOverlay.progressBadges` / `.firstClipInvitation`
/ `.mobileStageCta` / `.frameOrdering`, `playProgress.test.js`, `clipStage.test.js`,
`AnnotateContainer.reelCreated`, `questDefinitions.test.jsx`. E2E: `T9580-first-clip-invitation-qa`,
`T8960`, `T8760`, `T9550-editor-stage-strings`, `manifests/screenManifests.js`, `tutorial-capture-annotate`.

### Related Tasks
- Depends on: T11100 (A, B picks), T11120 (strict order, same files), T11110 (label)

## Acceptance Criteria

- [ ] Red-then-green: Done on an unclipped Highlight play shows the popup; 1-4 star Done closes (H3)
- [ ] Make Highlight Now lands in Frame Highlight on THAT play's clip, exactly one create call
- [ ] Keep Annotating creates exactly one clip, stays in Annotate, teaching line visible, clip in Clips
- [ ] Double-tap on either button creates one clip
- [ ] No "Create clip" / "Frame" CTA in Annotate (grep + live)
- [ ] Live-driven desktop + 393 px phone
