# T10240: Marked-play CTA: "Create Clip" / "Frame Clip" when no clip exists, never a phantom "View Final"

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17 staging run: "I clicked View Final on a marked play in annotate ... there are no
clips that are in the final state, so it shouldn't have even been an option ... Basically if there
is No Clip created for that play the button should say Create Clip and Frame Clip. Both create a
clip in Clips but Frame Clip should also navigate the user to Framing with that clip loaded."

Code (`src/frontend/src/modes/annotate/clipStage.js:55-95`): "View Final" renders only when the
play has an `autoProjectId`, the project's `reelSource*` snapshot matches the play's times
exactly, AND `linkedProject.has_final_video` is true. With no clip, `getClipStage` returns
`NO_PROJECT` with label "Create Clip" and `action: null`. So either (a) the play DID have a
project whose `has_final_video` was true (stale or wrong `useProjectsList()` data for
`hello@reelballers.com`), or (b) a different CTA ("Frame this clip") was read as "View Final".
Establish which before changing gates: pull the account's profile DB read-only (see
`reference_changing_env_data` / `reference_dev_per_user_db_edits` memory) and check
`raw_clips.auto_project_id` + `projects.has_final_video` for that play.

Independently of the crash (T10230), the requested behavior is a real gap: `NO_PROJECT` has no
action, so the only way to create a clip from an existing play is the edit-mode "Create clip"
affordance.

## Solution

1. `getClipStage` `NO_PROJECT` branch exposes TWO actions for a saved play with no clip:
   - **Create Clip**: creates the auto-project (same backend path as the editor's
     `createProject: true` save) and stays in Annotate, toast "{name} is now in Clips".
   - **Frame Clip**: same create, then `onOpenInFocus(newProjectId)` (the exact
     `openClipInEditorMode(id, EDITOR_MODES.FRAMING)` gesture). Needs the new project id
     returned synchronously from the create path (today `handleFullscreenCreateClip` returns only
     `saveOk`; the id arrives via `setAutoProjectId`). Thread it back; T10290's "Save and Frame"
     needs the same seam, so build it once.
2. Render both in every place the stage CTA appears: `ClipDetailsEditor.jsx:381-412` (desktop
   sidebar) and the editor `stageCta` in `AnnotateFullscreenOverlay.jsx:808-827` (strip + mobile
   sheet).
3. "View Final" gate hardening: derive `has_final_video` from the freshest projects list at
   render time and never from a memoized snapshot that can outlive a re-export; if the account
   probe in Problem (a) shows a genuinely wrong `has_final_video`, that is a backend data bug to
   fix at its source (no defensive UI fallback).
4. Vocabulary: labels go through `displayNames.js` (ANNOTATE block); "Frame Clip" must use
   `MODE_NAMES.FRAMING`.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/clipStage.js`
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx`
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx`
- `src/frontend/src/containers/AnnotateContainer.jsx:1246-1375` (`handleFullscreenCreateClip`)
- `src/frontend/src/screens/AnnotateScreen.jsx:230-243`
- `src/frontend/src/config/displayNames.js`
- Backend: `src/backend/app/routers/clips.py` (`_create_auto_project_for_clip`, the update path
  that flips `createProject` on an existing raw clip)

### Related Tasks
- Depends on: T10230 (crash verdict) so the navigation target is known-good
- Shares the create-then-navigate seam with T10290 (Save and Frame); implement together or in
  sequence on one branch

## Acceptance Criteria

- [ ] A saved play with no clip shows exactly "Create Clip" and "Frame Clip"; neither is disabled
- [ ] "Frame Clip" lands in Framing with that clip loaded, on desktop and mobile
- [ ] "View Final" never renders unless the linked project's current `has_final_video` is true
- [ ] Unit tests for `getClipStage` cover NO_PROJECT actions; e2e drives Frame Clip end to end
- [ ] `hello@reelballers.com` probe result recorded (why "View Final" showed)

## Implementation (2026-09-17, branch feature/T10240-frame-clip-cta-and-save-and-frame)

Commit `9e335873`. Frontend-only, no schema. Shared with T10290 (`2cc9b9d1`) on one branch.

**Shared create-then-navigate seam (built once here):** `handleFullscreenCreateClip` and
`updateClipRegionWithSync` (`AnnotateContainer.jsx`) now resolve `{ saveOk, projectId }` instead of a
bare `saveOk`. `projectId` is set only when the call created the auto-project (`result.project_created`),
so a caller (`ClipDetailsEditor` "Frame clip", `AnnotateFullscreenOverlay.handleSaveAndFrame`) gets the id
SYNCHRONOUSLY instead of waiting for the later `setAutoProjectId` re-render.

**Stage CTA:** `getClipStage` NO_PROJECT now carries `createActions:[{key:'create',navigate:false},
{key:'frame',navigate:true}]` (bare `label`/`action` kept for back-compat). `ClipDetailsEditor` renders
both "Create clip" / "Frame clip" (via `ANNOTATE.CREATE_CLIP` / `FRAME_CLIP`), always enabled, on desktop
AND mobile (produced-stage CTA stays `!isMobile`); a `creatingRef` guards double-create invisibly.
"Create clip" stays in Annotate (reel-created toast from the container); "Frame clip" awaits the seam's
`projectId` then `onOpenInFocus(id)`. `ClipsSidePanel` mobile detail-takeover now receives
`onOpenInFocus`/`onOpenInOverlay`.

**"View Final" gate — no change needed:** `getClipStage` already reads `has_final_video` off the live
`useProjectsList()` lookup at render time (no memoized snapshot), so a re-export reflects immediately.

**Account probe:** NOT runnable in the permission-free container (no R2 creds, no backend venv, no local
`user_data`). Per T10230's ground-truth (same day), the reported play "Great Control Pass" genuinely had a
real `final_video_id` (`has_final_video=true`), so "View Final" was CORRECT for that play at observation
time, not a stale/wrong `useProjectsList()` value — scenario (a) of the Problem section, with the value
being right rather than wrong. No backend data bug found to fix; no defensive UI fallback added.

**Tests:** `clipStage.test.js` (NO_PROJECT createActions), `ClipDetailsEditor.reel.test.jsx` (two create
actions, Create-clip-no-nav vs Frame-clip-navigates, mobile renders them). Relevant unit set green
(173 pass across clipStage / ClipDetailsEditor / overlay / AddDetailsPopup). Live-drive QA + a Frame-clip
e2e spec are deferred to the supervisor's staging run (no e2e in Branch CI; app not runnable in-container).
