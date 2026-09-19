# T10600: Architect design — per-gesture autosave model for the play editor

**Status:** DECIDED
**Impact:** 8
**Complexity:** 3
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Epic:** [play-editor-autosave/EPIC.md](EPIC.md) (task 1 of 4, design gate)

## Problem

The Mark Play / Edit Play editor (`AnnotateFullscreenOverlay.jsx`) is a submit-form: local
state for every field, one `handleSave` that sends the whole payload on "Save play" /
"Update play". The user wants that button gone (EPIC.md D1). The codebase already has the
sanctioned pattern (surgical gesture writes; `ClipDetailsEditor.jsx` does it per field
through `updateClipRegionWithSync`), but three things need a real design before code:

1. **Creation.** Today a play does not exist until Save. With no Save, the row must be
   created at the Mark Play tap (EPIC D2) and the editor must open in edit mode on it —
   which changes the selection state machine (`useClipSelection`: `CREATING` vs `EDITING`),
   the container's `handleAddClipFromButton`/`startCreating`, and what "Cancel" means (D6).
2. **Text fields.** `ClipDetailsEditor` writes on every keystroke today (one durable PUT +
   R2 upload per character). The design must give BOTH editors one commit-on-blur/Enter
   pattern (D3) without any `useEffect` write and without debounce timers.
3. **Ordering.** Independent per-field writes can race (trim drag-end then Frame 100ms
   later). D4 wants a per-region in-order chain that the Frame CTA awaits.

## Solution (what this task produces)

`docs/plans/tasks/T10600-design.md` per [2-architecture.md](../../../../.claude/workflows/2-architecture.md):
current state, target state, implementation plan for T10610 (file-by-file, function-by-
function), risks — plus a decision artifact for the user (the design gate). Design only; no
source edits. The design must answer, concretely:

### A. Create-at-tap seam
- Exact call sequence for the Mark play tap: `effectivePause()` -> `requireAuth` ->
  create via `handleFullscreenCreateClip({startTime: t-6, duration: 8, rating: DEFAULT_RATING,
  tags: [], name: <"Play N" default>, notes: '', tagged_teammates: [], my_athlete:
  newClipLayerIsMine, createProject: false})` -> `editClip(newRegion.id)`. Confirm the
  multi-video/angle branch (`fullTimeline`, `isOverlapTimeline`, `activeSourceSequence`,
  `clampToSource`) still runs — it lives inside that seam today, so it should be free.
- Where the "Play N" default name is computed after the move (today: the overlay's
  `defaultClipName` from `nextClipNumber`).
- `useClipSelection`: does `CREATING` survive (e.g. for the auth-modal interstitial) or
  collapse into `EDITING`? Spell out the state table after the change.
- The `!annotateGameId` branch (upload still in progress, no game row): region stays
  local, first field write takes `updateClipRegionWithSync`'s SAVE path (existing code
  ~1454-1494) — confirm no double-create, given `saveClip`'s `pendingSaves` dedup key is
  `game-start-end`.
- What `add_clip_opened` (quest achievement) and `announcePlaySaved` (toast) do now: fire at
  the tap / at creation respectively, once.

### B. One text-commit pattern for both editors
- Overlay: `clipName`/`notes` are already local state; commit handlers on `onBlur` +
  Enter (name) / `onBlur` (notes) call `onUpdateClip(existingClip.id, {name})` /
  `{notes}`. Keep `isNameManuallyEdited` semantics (empty name -> backend derives).
- Sidebar `ClipDetailsEditor`: today `value={displayName}` is parent-driven and
  `handleNameChange` -> `onUpdate({name})` per keystroke. Design the local-echo split:
  recommended = local input state seeded from `region.name`, reset on `region.id` change
  (the exact pattern its own `scrubStartTime`/`scrubEndTime` already use, lines ~117-128),
  commit on blur/Enter. Same for notes. Reject a `{persist:false}` option on
  `updateClipRegionWithSync` unless the local-state approach has a concrete problem.
- Escape / X / Done while a text field has focus: commit first, then close (D3). Name the
  handler.

### C. Per-region ordered delivery + Frame await
- A `Map<regionId, Promise>` tail chain inside `updateClipRegionWithSync` (or a thin
  wrapper the container owns), modelled on `api/actionClient.js`'s FIFO (stored tail is
  `.catch(()=>{})`'d so a failure never wedges the chain; the real result still propagates).
  NO version threading (see EPIC non-goals).
- `handleFrameNow` / the editor's stage CTA / "Frame" await the region's chain tail
  before `onOpenInFocus(projectId)`. Decide whether the chain is exposed as
  `awaitRegionWrites(regionId)` on the container API (`AnnotateModeView` needs it for the
  T10310 main-screen Frame row too).
- Failure semantics per D5: local state keeps the user's value; `SaveStatusBadge` shows
  error; Retry re-fires the failed gesture's payload. Say what the Frame CTA does if the
  chain tail rejected (recommend: do not navigate; the Retry toast is already up).

### D. Delete-instead-of-Cancel
- Reuse `ClipDetailsEditor`'s delete-with-confirm (`showDeleteConfirm`, `onDelete` ->
  container `deleteClipRegion`?) in the overlay's layouts; name the shared component if one
  should be extracted (only if BOTH would otherwise duplicate it — abstract on the 2nd copy
  here is fine, it is the same dialog).

### E. Retirement list (D7) with the test file for each
Map every deleted symbol to the test(s) that pin it today so T10610 rewrites rather than
deletes coverage: `explicitOutcomes`, `saveStatus`, `oneTap`, `keys` (Enter-to-save +
Escape), `focusPrompt`, `stayOpen`, `stripLayout`, `mobileStageCta`, `namePreservation`,
`firstClipInvitation` (the `add_clip_opened_no_save` beacon), `AnnotateContainer.reelCreated`.

### F. Knowledge-doc + e2e impact
- `.claude/knowledge/annotate.md`: entries to rewrite (T8140 pinned-footer rationale,
  T9330 stay-open, T9630 tri-state save, T9830 two-outcome buttons, T10290 save-closes).
- e2e specs that click "Save play"/"Update play": `T8490-star-semantics-caption.qa.spec.js`,
  `T9480-one-time-format.qa.spec.js`, `T9580-first-clip-invitation-qa.spec.js` — list the
  new interaction each should drive.

## Context

### Relevant Files (read; this task writes only the design doc)
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — the editor; `handleSave` ~453-565, `hasUnsavedEdits` ~575, reset effect ~300-346, `formBody` ~701, `actionsFooter` ~856, `stageCta` ~892, layouts `strip` ~1003, `landscape-inline` ~1216, `inline` ~1290
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — the sidebar editor that already autosaves per gesture (~117-223); the per-keystroke `handleNameChange`/`handleNotesChange` landmine
- `src/frontend/src/containers/AnnotateContainer.jsx` — `handleAddClipFromButton` ~1217, `handleFullscreenCreateClip` ~1250-1386, `updateClipRegionWithSync` ~1392-1538, `handleOverlayClose` ~1577
- `src/frontend/src/modes/annotate/hooks/useClipSelection.js` — `NONE | SELECTED | EDITING | CREATING`
- `src/frontend/src/hooks/useRawClipSave.js` — `saveClip` (POST /clips/raw/save, dedup key), `updateClip` (PUT, partial), `surfaceClipSyncFailed`
- `src/frontend/src/api/actionClient.js` — the FIFO pattern to mirror (not adopt wholesale)
- `src/frontend/src/modes/annotate/components/ClipScrubRegion.jsx` + `TrimTimeField.jsx` — `onDragEnd(finalStart, finalEnd)` / `onCommitComplete` contract (T9480)
- `src/backend/app/routers/clips.py` — `RawClipUpdate` (all fields optional, ~171), `update_raw_clip` (~1395: partial update, range normalization, `boundaries_version` bump), `save_raw_clip` natural key (~1271)
- `src/frontend/src/modes/AnnotateModeView.jsx` — Mark play / Edit play CTA row ~1017-1110, mobile sheet wrapper ~1244-1270

### Knowledge docs
- `.claude/knowledge/annotate.md` (T9830, T10240/T10290, T10410, T10420, T10590 entries)
- `.claude/knowledge/persistence-sync.md` § T4320 (durable clip gestures), § T4330 (action client FIFO)
- `.claude/references/coding-standards.md` § Persistence: Gesture-Based, Never Reactive

### Related Tasks
- Blocks: T10610 (implements this design), T10620 (depends on the pinned Save footer being gone)
- Prior art: T9480 (trim commit contract), T9630 (save-status tri-state), T10240/T10290 (create-then-navigate seam), T10420 (mobile sheet containing-block bug)

### Technical Notes
- Every write must be traceable to a gesture in its handler. A `useEffect` that persists is
  a design rejection, full stop. Blur is a gesture; "value changed" is not.
- `durable_sync` costs one R2 round trip per write (p95 66-205ms measured, T4320). Per-
  keystroke writes are therefore not merely wasteful, they serialize typing behind R2.
- `existingClip` becomes a NEW object after every surgical write (T10410) — the overlay's
  reset effect already keys on clip id, keep it that way; the design must not reintroduce
  a re-seed on identity churn.

## Implementation

### Steps
1. [x] Load the three knowledge docs above, then read the listed files (no broader audit)
2. [x] Spawn the `architect` agent with this file + EPIC.md; it writes `docs/plans/tasks/T10600-design.md`
3. [x] Build the decision artifact (state table before/after, commit-point table, chain diagram, retirement list) and hand it to the user
4. [x] Status -> WAITING ON USER; on approval -> DECIDED, and T10610 may start

### Progress Log

**2026-09-19**: Filed from the mobile trim audit (decision artifact linked in EPIC.md). Not started.

**2026-09-19**: Architect agent wrote `docs/plans/tasks/T10600-design.md` (750 lines): create-at-tap
call sequence collapses `CREATING` out of `useClipSelection` (3-state machine); one local-echo +
commit-on-blur text pattern for both editors (`closeWithCommit` handles Escape/X/Done); a new
`regionWriteQueue.js` per-region FIFO (modelled on, not adopting, `actionClient.js`) with
`awaitRegionWrites` exposed on the container API for Frame to await; `DeletePlayButton` extracted
as the one sanctioned 2nd-copy abstraction; 15 retired symbols each mapped to the test file that
pins it today plus the replacement assertion (rewrite, not delete). 4 additions beyond the task
file's own ask, each flagged: `NEW_PLAY_DEFAULT_RATING` (resolves a silent 4-vs-3 `DEFAULT_RATING`
collision), `handleDeletePlayFromEditor` must close+deselect before deleting, 4 extra retirement
rows, 3 extra e2e specs needing locator updates. Structurally closes the T9630 stale-closure race
that `annotate.md` had flagged as open/unconfirmed. Backend: zero changes needed (verified).
Decision artifact published: https://claude.ai/artifact/QckNNXNcubCBajm66vexyT. Status ->
WAITING ON USER.

**2026-09-19 (v2):** User asked for a second review (technical + usability) and whether
"discard" is lost. Answer: yes, by D1/D6 — on close everything is already saved; Delete play
and edit-it-back are the only ways back. Review verified v1's load-bearing claims against the
code and found 4 mechanism bugs + 3 consistency gaps, all folded into the doc as v2 with a
pinning test each: (1) `addClipRegion` :1281 opens the editor BEFORE `await saveClip` :1317,
so an early trim would POST a duplicate row -> create is now the queued chain head; (2)
`setRawClipId` is React state, not fresh by the next microtask -> `rawClipIdByRegionRef`
written synchronously; (3) per-region `failed` flag cleared by ANY later success let Frame
navigate on stale bounds -> per-key tracking + Retry through the queue; (4) DELETE could beat a
pending PUT -> queued as chain tail; (5) `onDragEnd` :305 fires on every pointer-up ->
clean-check in `updateClipRegionWithSync`; (6) Escape meant "abandon" in one field and "save
and close" in another -> one `onTextFieldKeyDown` rule; (7) sidebar `(auto)` label must read
`isDefaultPlayName`. User approved folding these in. Artifact republished (same URL).

**2026-09-19: APPROVED by the user (v2).** Design doc committed to master. Status -> DECIDED.
T10610 may start; kickoff for a fresh /dotask session written to `C:\tmp\kickoff-t10610-t10620.md`.

## Acceptance Criteria

- [x] `docs/plans/tasks/T10600-design.md` exists and answers A-F above with named functions, not prose
- [x] Zero `useEffect`-driven writes anywhere in the plan; every write names its gesture
- [x] Sidebar per-keystroke write is explicitly fixed by the same pattern as the overlay
- [x] Frame-after-trim ordering is guaranteed by design (chain + await), not by timing (v2: per-key failure tracking, create as chain head, ref map for `rawClipId`)
- [x] User approved the decision artifact (2026-09-19, v2)
