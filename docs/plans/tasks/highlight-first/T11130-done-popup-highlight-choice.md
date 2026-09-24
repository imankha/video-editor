# T11130: Highlight popup (Make Highlight Now / Highlight Later); remove Create clip + Frame CTAs

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

1. **Popup on Done** when the play is rated Highlight (5) and is not yet a highlight
   (`selectedRegion.autoProjectId` empty), for My athlete AND Team plays (H13). **Presentation
   B3 (owner, 2026-09-24):** pressing Done swaps the edit strip (desktop) / portrait strip
   (mobile) in place for a gold-outlined choice card (T8600 mode-swap pattern; add a gold row to
   the style guide's mode-swap tint table). Eyebrow "Highlight", title "Make this a highlight
   now?". The video stays visible. Gold is the Highlight color; the primary button is gold with
   dark text. No visible cancel: **Escape is the only no-save exit** (returns to the editor,
   nothing written; M5, per the ui-designer). Never close on backdrop.
   - **Make Highlight Now**: reuse the Frame Now path exactly - `AnnotateModeView.jsx`
     `handleFrameNow` (233): `onFullscreenUpdateClip(id, {createProject: true, silent: true})`,
     await region writes (`awaitRegionWrites`, the rating commit is queued), then
     `onOpenClipInFocus(projectId)`. Do NOT reuse `handleCreateClipFromBadge`
     (`AnnotateFullscreenOverlay.jsx:385`): its non-silent path fires the "is now in Clips" toast
     + `selectProject` before navigation.
   - **Back to Editing** (owner ruling round 3, 2026-09-24; replaced round 2's "Highlight
     Later", which replaced "Keep Annotating"), subtext exactly **"Saves play in Clips so you
     can make your highlight later"** (capital C, M4: it names the Home tab). Reuse
     `handleFrameLater` (259): same call without `silent`. **It closes the editor and returns to
     marking plays** (M2, owner). Because the editor closes, the gold "Highlight made" chip is not
     on screen, so the toast is the confirmation (M3): `announceReelCreated`
     (`AnnotateContainer.jsx:93`, today "{name} is now in Clips" + "Open Framing" action) shows
     EXACTLY **"Highlight moved to Clips so you can edit it later"** with no action button. The
     play's timeline marker turns gold. "Clips" appears only in these two owner-written strings.
   - Synchronous ref guard against double-create (pattern: `frameCreateInFlightRef` :215, the
     T9830/T10240 convention). The badge's state-only guard is not enough.
2. **Remove** (H8 decides the stage CTA):
   - Badge nudge + `handleCreateClipFromBadge`; T10450 Frame Now / Frame Later row
     (`AnnotateModeView.jsx:1211-1235`) and handlers once the popup owns them.
   - Dead `clipStage.js:66-74` `createActions`.
   - displayNames keys: `CREATE_CLIP`, `CLIP_CREATED`, `CREATE_CLIP_NUDGE_HINT`,
     `SAVE_AND_CREATE_CLIP_NUDGE_HINT`, `CLIP_BADGE_DORMANT_HINT`, `FRAME_NOW`, `FRAME_LATER`,
     `FRAME_LATER_HINT`, `CREATE_EDITABLE_CLIP`, `SAVE_PLAY_AND_CLIP`, and `FRAME_THIS_CLIP*` /
     `KEEP_MARKING_PLAYS` if H8 removes the stage CTA. **Check consumers first**: `FRAME_CLIP` is
     also used by `ClipSelectorSidebar:322` (Focus) and `PREPARING_CLIP` by `ProjectManager:1661`.
3. **Badges**: the clip badge and its 5-star nudge go (`playProgress.js` `CLIP_NUDGE_RATING`
   semantics); the "already a highlight" state renders per the T11100 A pick, in gold, without
   the word clip. The editor re-layout itself is T11150. Team plays follow H13.
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
- Depends on: T11100 (A, B picks), T11150 + T11120 (strict order, same files), T11110 (label, gold)

## Acceptance Criteria

- [ ] Red-then-green: Done on a Highlight play that is not yet a highlight shows the popup; 1-4 star Done closes (H3)
- [ ] Make Highlight Now lands in Frame Highlight on THAT play, exactly one create call
- [ ] Back to Editing creates exactly one, closes the editor, stays in Annotate, toast reads exactly "Highlight moved to Clips so you can edit it later", item appears in the Clips tab
- [ ] Escape on the choice card returns to the editor with no network write
- [ ] Double-tap on either button creates one
- [ ] No "Create clip" / "Frame" CTA in Annotate (grep + live)
- [ ] Live-driven desktop + 393 px phone
