# Play Editor Autosave (no Save/Update button) + mobile trim layout

**Status:** TODO
**Started:** 2026-09-19
**Impact:** 8 | **Complexity:** 6 | **Priority:** 1.3
**Decision artifact (problem reproduction + mockups, 2026-09-19):** https://claude.ai/artifact/2oxojEQTrAhJhfG23UmJus

## Goal

The Mark Play / Edit Play editor stops being a form you submit. Every control persists on
its own gesture, so there is no "Save play" / "Update play" button anywhere, nothing is
ever "unsaved", and closing the editor never discards work. Then, with no pinned Save
button to protect, the mobile portrait editor becomes a short strip UNDER a video that
stays visible while you trim (today's `max-h-[85vh]` bottom sheet hides the video the
trim handles refer to). The Focus/Overlay bottom action band gets its narrow-width
stacking fix at the same time (found in the same mobile sweep).

User ruling 2026-09-19: "I want to get rid of the update button here. I acknowledge that
means creating a set of tasks, the first being architectural and the others being UX."

## Why this is allowed under the persistence rule

CLAUDE.md § Persistence bans REACTIVE persistence (a `useEffect` watching state and writing).
It explicitly endorses SURGICAL gesture persistence: `gesture -> handler -> POST with ONLY the
changed field`. Autosave here means each control's own gesture (drag-end, blur, tap) fires
its own surgical write from its own handler. No effect watches form state. This is the
pattern `ClipDetailsEditor.jsx` (the clips-sidebar play editor) ALREADY uses for every
field (`onUpdate({rating})`, `onUpdate({tags})`, `handleDragEnd -> onUpdate({startTime,
endTime})`, ...), routed through `AnnotateContainer.updateClipRegionWithSync ->
useRawClipSave.updateClip -> PUT /api/clips/raw/{id}` (partial body, `Depends(durable_sync)`).
The epic extends that one existing seam to the other editor; it does not build a second
persistence mechanism.

## Tasks (strict order for T10600 -> T10610 -> T10620; T10630 is file-disjoint and may run in parallel)

| ID | Task | Tier | Status |
|----|------|------|--------|
| T10600 | [Architect design: per-gesture autosave model for the play editor](T10600-autosave-architecture-design.md) | design gate | TODO |
| T10610 | [Implement autosave: create at Mark Play, persist per gesture, delete the Save/Update buttons](T10610-implement-autosave-no-save-button.md) | L | TODO |
| T10620 | [Mobile portrait: compact editor strip under a visible video](T10620-mobile-portrait-compact-strip.md) | M | TODO |
| T10630 | [ActionBand stacks on narrow widths (Focus/Overlay export bar)](T10630-action-band-mobile-stack.md) | S | TODO |

File-ownership map (for the /dotask queue plan): T10600 writes only `docs/plans/tasks/T10600-design.md`.
T10610 + T10620 both own `AnnotateFullscreenOverlay.jsx`, `AnnotateModeView.jsx`,
`AnnotateContainer.jsx` -> never concurrent. T10630 owns only `components/ActionBand.jsx`.

## Design decisions (settled 2026-09-19; the T10600 design doc refines mechanism, not these)

**D1. No submit.** The play editor has no Save / Update / Cancel-that-discards button in
ANY layout (`strip`, `overlay`/`formBody`, `inline` mobile sheet, `landscape-inline`). The
only chrome actions are: close (X / "Done"), the stage CTA (Frame / Apply Spotlight / View
Final, unchanged), and Delete play (new in this editor; reuse the sidebar's confirm flow).

**D2. Mark Play creates the play at the tap.** Tapping "Mark play" (`AnnotateContainer.
handleAddClipFromButton -> startCreating()`) now immediately creates the region AND the
backend row via the EXISTING create seam `handleFullscreenCreateClip` (the default
`DEFAULT_CLIP_BEFORE`=6s / `DEFAULT_CLIP_AFTER`=2s window around the playhead, rating
`DEFAULT_RATING`, layer from `newClipLayerIsMine`, name '' -> the "Play N" default the
editor computes today), then opens the editor in EDIT mode on the new region (selection
`EDITING`, not `CREATING`). Consequence: `existingClip` is always set while the editor is
open; the create/edit fork inside the editor's save path disappears. The `!annotateGameId`
case (game record not yet created during upload) keeps today's behavior: region stays
local and `updateClipRegionWithSync` takes its SAVE path on the first write (existing code,
`AnnotateContainer.jsx` ~1454).

**D3. Commit points per field (each is a named gesture, each sends ONLY its field):**

| Control | Gesture that persists | Payload |
|---------|----------------------|---------|
| Trim start/end (drag handle, typed `TrimTimeField`, step chevrons) | `ClipScrubRegion.onDragEnd(finalStart, finalEnd)` (typed entry/steps already route through it via `onCommitComplete`, T9480) | `{startTime, endTime}` |
| Rating | tap in the rating popup | `{rating}` |
| Tags | chip tap | `{tags}` (full array; it is one field) |
| Play category (My athlete / Team) | segmented-control tap | `{my_athlete}` |
| Clip name | input blur, or Enter | `{name}` (never per keystroke) |
| Notes | textarea blur | `{notes}` (never per keystroke) |
| Teammates | Enter-commit / remove chip | `{tagged_teammates}` |
| Frame / stage CTA | click | `{createProject: true}` when no project yet (unchanged T10240 seam) |

Text fields keep local state while typing (the overlay already does; the sidebar
`ClipDetailsEditor` must be changed to match: today it fires `onUpdate({name})` /
`onUpdate({notes})` on EVERY keystroke, i.e. one durable PUT + R2 upload per character —
a live landmine this epic fixes, not a new pattern). Escape / X / Done while a text field
is focused commits that field first (same handler blur would call), then closes.

**D4. Ordering + Frame.** Writes for one region are delivered in order (a per-region
promise chain in `updateClipRegionWithSync`; mirror `api/actionClient.js`'s FIFO idea, do
not adopt its version threading — `raw_clips` has no version counter and adding one is out
of scope). The Frame / stage CTA awaits the region's chain tail before navigating, so a
trim released 100ms before tapping Frame is on the server before Framing loads. The T8730
"Save this play first?" confirm (`focusConfirmDialog`) is deleted — there is nothing unsaved.

**D5. Feedback.** Per-gesture writes show only the existing `SaveStatusBadge`
(saving -> saved -> idle; error stays). The "Play saved" toast (`announcePlaySaved`) fires
ONCE, at creation (D2), never per field. Failure = the existing `surfaceClipSyncFailed`
persistent toast with Retry re-firing THAT gesture's payload (T5350 pattern); local state
keeps the user's value (no rollback), matching today's failed-save behavior.

**D6. Delete, not Cancel.** A just-marked play the user did not want is removed with
Delete play (confirm, then `deleteClip` — the sidebar's existing `onDelete` flow).
Closing never deletes. Two taps of Mark play at the same playhead within a second still
dedupe into one row (backend natural key `game_id + end_time + video_sequence`,
`clips.py` ~1271 — already true today).

**D7. Dead machinery goes.** `handleSave`, `saveInFlightRef`, `hasUnsavedEdits`,
`focusConfirmOpen`/dialog, the T9330 `focusPending`/`stagePendingCta`/
`pendingProjectClipId`/`onResumePlaybackOnly` stay-open machinery (already flagged dead
by T10290), the T8140 `add_clip_opened_no_save` beacon + `savedThisOpenRef` (its premise —
an open that ends without a save — no longer exists; the server-side `clip_created`
milestone already fires at creation), the Enter-to-save shortcut, `ANNOTATE.SAVE_PLAY` /
`UPDATE_PLAY` (and `SAVE_AND_FRAME` if no caller remains after T10310). Their tests are
rewritten to the new contract, not deleted wholesale (see T10610's test list).

**D8. Mobile portrait layout = Option B from the artifact** (ui-designer recommendation,
user accepted): extend the shipped `landscape-inline` compact-strip pattern to portrait.
Video keeps a guaranteed height; the strip holds trim + name; everything else lives behind
the existing "Notes and Tags" disclosure (`AddDetailsPopup`, which may cover the video —
those fields don't need it). Rejected: the user's original "Edit timing / Edit details"
two-flow split (two taps on the common create path, a third mental model, forks the save
seam) and on-frame trim handles (trim is temporal, not spatial; would occlude the frame).
Because D1 removes the pinned Save footer that was the ONLY reason the sheet was
`position: fixed` (T8140), the portrait strip renders IN FLOW under the video card — which
also retires the T10420 backdrop-filter containing-block landmine for this surface.

## Non-goals

- No version counter / 409 handling on `raw_clips` (single writer per play in practice; a
  second tab editing the same play is last-write-wins today and stays so).
- No debounce timers. Commit on blur/Enter/drag-end/tap only.
- No change to what `PUT /api/clips/raw/{id}` does (partial update, `boundaries_version`
  bump on a time change, `durable_sync`). Backend is untouched unless T10600 finds a gap.
- No change to the Focus/Overlay editors (they already autosave per gesture via
  `focusActions`/`overlayActions`).

## Completion criteria

- [ ] T10600 design approved by the user (decision artifact)
- [ ] No Save/Update button renders in any play-editor layout; every field in D3 persists on its gesture (unit-tested per field, red->green)
- [ ] Mark play creates the row at the tap; closing the editor never discards; Delete play removes it
- [ ] Sidebar `ClipDetailsEditor` no longer writes per keystroke
- [ ] Portrait phone: trimming happens with the video visible (real-device check, 393x852 + iPhone SE)
- [ ] Focus/Overlay bottom band never wraps its captions one word per line at 393px
- [ ] `.claude/knowledge/annotate.md` updated (new persistence contract, retired landmines T8140/T10420 for this surface)
