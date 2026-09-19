# T10610: Implement autosave — create at Mark Play, persist per gesture, delete the Save/Update buttons

**Status:** WIP
**Impact:** 8
**Complexity:** 6
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Epic:** [play-editor-autosave/EPIC.md](EPIC.md) (task 2 of 4, L-tier). **Blocked by T10600** (implements its approved design doc `docs/plans/tasks/T10600-design.md` exactly).

## Problem

See EPIC.md. The play editor (`AnnotateFullscreenOverlay.jsx`, all four layouts) submits a
whole-form payload on "Save play" / "Update play"; the user wants no such button. The
sidebar editor (`ClipDetailsEditor.jsx`) already persists per gesture but writes text
fields per keystroke.

## Solution

Implement `T10600-design.md`. In outline (the design doc's function-level plan governs
where it is more specific):

1. **Create at tap (D2).** `AnnotateContainer.handleAddClipFromButton` non-SELECTED branch:
   inside `requireAuth`, call the existing `handleFullscreenCreateClip` with the default
   window (`DEFAULT_CLIP_BEFORE`/`DEFAULT_CLIP_AFTER` from `clipConstants.js`, `DEFAULT_RATING`,
   `newClipLayerIsMine`, the "Play N" default name, `createProject: false`), then
   `editClip(newRegion.id)`. The same for the fullscreen toolbar's Add Play
   (`AnnotateControls.jsx`) and any other `startCreating()` caller. Fire `add_clip_opened`
   (quest) at the tap and `announcePlaySaved` once on the create response, as the create
   seam already does for bare plays.
2. **Per-gesture writes in the overlay (D3).** Replace `handleSave` with per-field handlers
   that call `onUpdateClip(existingClip.id, {field})`: `ClipScrubRegion.onDragEnd ->
   {startTime, endTime}`; rating popup -> `{rating}`; tag chip -> `{tags}`; layer control ->
   `{my_athlete}`; name `onBlur`/Enter -> `{name}` (respecting `isNameManuallyEdited`);
   notes `onBlur` -> `{notes}`; teammates commit/remove -> `{tagged_teammates}`. Keep
   `onScrubDragChange` side effects. Escape/X/Done commits a focused text field first.
3. **Sidebar text fields (D3).** `ClipDetailsEditor`: local `name`/`notes` state seeded from
   `region`, reset on `region.id` (mirror its scrub pattern), commit on blur/Enter. Rating,
   tags, teammates, trim, layer are already per-gesture — leave them.
4. **Ordered delivery + Frame await (D4).** Per-region promise chain in
   `updateClipRegionWithSync` per the design; `handleFrameNow` (`AnnotateModeView`), the
   overlay's `stageCta`, and `ClipDetailsEditor.handleCreateClip` await the tail before
   navigating. Delete `focusConfirmOpen`/`focusConfirmDialog`/`hasUnsavedEdits`.
5. **Chrome (D1/D6).** Remove the Save/Update + Cancel footer in `actionsFooter`, the
   `strip` controls row button, and the `landscape-inline` button. Close affordance stays
   (X; label it `ANNOTATE.DONE` = "Done" on the mobile sheet). Add Delete play (confirm)
   to the overlay layouts by reusing the sidebar's flow. Remove the create-only "You can
   change all of this later." line and the create-mode heading (always "Edit play").
6. **Feedback (D5).** `SaveStatusBadge` driven by the per-gesture write outcome (saving ->
   saved -> idle after a short hold; error persists). No per-field toast. Failures keep
   local values; the existing `surfaceClipSyncFailed` Retry re-fires the same payload.
7. **Retire (D7).** `handleSave`/`handleSaveRef`, `saveInFlightRef`, the Enter-to-save
   shortcut, `savedThisOpenRef` + the `add_clip_opened_no_save` impression effect, the
   T9330 `focusPending`/`stagePendingCta`/`pendingProjectClipId`/`onResumePlaybackOnly`
   props and plumbing (container + ModeView + overlay), `ANNOTATE.SAVE_PLAY`/`UPDATE_PLAY`
   (+ `SAVE_AND_FRAME` if grep finds no caller). `useClipSelection.CREATING` only if the
   design retires it.
8. **Docs.** Rewrite the affected `.claude/knowledge/annotate.md` entries (T8140 footer
   rationale, T9330, T9630, T9830, T10290) into one "Play editor persistence contract"
   section; note the retired beacon.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — the editor (all layouts)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — sidebar editor text-field commit fix; source of the delete-confirm flow
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` — rating popup's `onRatingChange` now persists directly
- `src/frontend/src/modes/annotate/components/DetailsFields.jsx` / `AddDetailsPopup.jsx` — tags/notes/teammates/sport controls receive commit handlers
- `src/frontend/src/modes/annotate/components/AnnotateControls.jsx` — fullscreen toolbar Add/Edit play buttons
- `src/frontend/src/containers/AnnotateContainer.jsx` — `handleAddClipFromButton`, `handleFullscreenCreateClip`, `updateClipRegionWithSync` (+ chain), `pendingProjectClipId` removal, API surface returned to the screen
- `src/frontend/src/modes/AnnotateModeView.jsx` — Mark/Edit play CTA row, `handleFrameNow` await, mobile sheet props
- `src/frontend/src/modes/annotate/hooks/useClipSelection.js` — state table per design
- `src/frontend/src/config/displayNames.js` — `ANNOTATE.DONE` (new), retired strings
- `src/frontend/src/hooks/useRawClipSave.js` — unchanged unless the design says otherwise (Retry payload shape)
- `.claude/knowledge/annotate.md`
- Tests (rewrite to the new contract; keep the file names so history stays greppable):
  `AnnotateFullscreenOverlay.{explicitOutcomes,saveStatus,oneTap,keys,focusPrompt,stayOpen,stripLayout,mobileStageCta,namePreservation,firstClipInvitation,layer,teammates,details,progressBadges,captureWindow}.test.jsx`,
  `ClipDetailsEditor.{trimPersist,layer,reel,teammates}.test.jsx`, `AnnotateContainer.reelCreated.test.jsx`,
  `useClipSelection.test.js`, `useRawClipSave.syncFailed.test.js` (unchanged, regression only);
  e2e `T8490-star-semantics-caption.qa.spec.js`, `T9480-one-time-format.qa.spec.js`, `T9580-first-clip-invitation-qa.spec.js`

### Related Tasks
- Depends on: T10600 (approved design)
- Blocks: T10620 (portrait strip assumes no pinned footer)
- Reuses: T10240/T10290's `{saveOk, projectId}` create-then-navigate seam; T9480's `onDragEnd`/`onCommitComplete` trim contract; T5350's `surfaceClipSyncFailed` Retry; T10520's rating popup

### Technical Notes (landmines)
- **No `useEffect` write. None.** Reviewer must grep every `useEffect` in the touched files for store/API calls.
- `existingClip` is a new object after every write (T10410); the overlay's reset effect keys on id — do not re-seed on identity churn or every blur wipes the next field.
- `durable_sync` = one R2 upload per write; text commit is blur/Enter ONLY.
- `boundaries_version` bumps on every time change (`update_raw_clip`) — Framing shows "outdated" after a trim; already true for the sidebar path, now true for the overlay. Expected.
- Backend natural key on create is `game_id + end_time + video_sequence`; `saveClip`'s client dedup key is `game-start-end`. Two Mark play taps within the dedup window collapse to one row — expected, keep.
- `X-Client-Game-Id` diagnostic header stays on every write (T7010).
- T10590's Escape fix: the rating popup's `stopPropagation` must survive; Escape at the editor level now means close (commit-then-close), never discard.
- Do not touch `FocusContainer`/`OverlayContainer` autosave paths.

## Implementation

### Steps
1. [ ] Branch `feature/T10610-play-editor-autosave`; load `annotate.md` + `persistence-sync.md` §T4320/§T4330 + `T10600-design.md`
2. [ ] Tester Phase 1: failing tests per D3 row (one gesture -> one payload), create-at-tap, chain ordering, Frame-awaits-chain, sidebar blur-commit, no Save button in any layout, Escape commits-then-closes
3. [ ] Implement steps 1-8 above in that order; commit after each shippable slice (create-at-tap; overlay per-gesture; sidebar; chain+Frame; chrome+retirement; docs)
4. [ ] Relevant set (~15): the rewritten overlay/sidebar/container/selection tests + `useRawClipSave.syncFailed`; lint hooks
5. [ ] Fresh-context Reviewer on the full diff (persistence rule, dead-code completeness, test honesty)
6. [ ] QA live-drive (dev-verify.sh, real browser, desktop 1440x900 + mobile 390x844): tap Mark play -> row exists before any edit; drag trim -> one PUT with start/end; type name + blur -> one PUT; tap rating -> one PUT; close via X/Escape -> nothing lost on reload; Delete play -> row gone; kill network -> Retry toast, value kept
7. [ ] Push; Branch CI verdict; hand off (this is provable by tests -> merge per feedback_merge_when_provably_verified once CI is green)

### Progress Log

**2026-09-19**: Filed. Not started.

## Acceptance Criteria

- [ ] No Save / Update / Cancel button in `strip`, `overlay`, `inline`, `landscape-inline` layouts (assert per layout)
- [ ] Mark play creates a `raw_clips` row (or the local region when no game row yet) BEFORE the editor opens; editor opens in edit mode on it
- [ ] Each D3 row: exactly one `PUT /clips/raw/{id}` carrying only that field per gesture (unit test spies on `onUpdateClip`)
- [ ] Name and notes: zero writes while typing, one on blur/Enter — in BOTH editors
- [ ] Trim drag-end then immediate Frame: the PUT lands before navigation (chain awaited), asserted with ordered mocks
- [ ] Escape / X / Done with a focused text field commits it, then closes; nothing is discarded
- [ ] Delete play (confirm) removes the row; closing never deletes
- [ ] Failed write: value stays on screen, `SaveStatusBadge` error, Retry re-fires the same payload
- [ ] `grep -rn "useEffect" <touched files>` shows no effect that calls `onUpdate*`/`saveClip`/`updateClip`/store writes
- [ ] All retired symbols (D7) are gone, with `grep` evidence in the report
- [ ] `.claude/knowledge/annotate.md` carries the new contract; stale entries rewritten
- [ ] Relevant tests green, lint clean, Branch CI green
