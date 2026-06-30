# T4130: Recap Playback Annotations Overlay + Real "Create Clip"

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-28
**Updated:** 2026-06-28

## Problem

Two issues in the Recap viewer (`RecapPlayerModal`):

1. **No playback annotations.** When watching a game recap, the per-clip annotation
   (name / notes / rating) is shown only in the sidebar list — it is never overlaid on the
   video during playback. Annotate already overlays this via `NotesOverlay`; the recap does
   not reuse it.

2. **"+Create Clip" doesn't create a clip.** The button (`handleCreateClip`,
   [RecapPlayerModal.jsx:161-166](src/frontend/src/components/RecapPlayerModal.jsx#L161-L166))
   navigates to the Annotate screen at the current playback time (`setPendingGame` ->
   `EDITOR_MODES.ANNOTATE`). This "restores the full annotation view", which is wrong: an
   expired game's full video isn't accessible from there. It should instead create the clip
   as a draft directly — the same outcome as creating a clip in Annotate — without sending
   the user back into the full-game annotation flow.

## Decisions (confirmed with user)

- **Overlay default:** annotations **visible by default**, with a **show/hide toggle**.
- **Overlay scope:** **Annotations tab only** (the recap/annotations tab). The Highlights
  tab clips are all 5-star with no notes/tags, so the overlay adds nothing there.
- **Create Clip selection model:** acts on the **currently-playing/active clip** — "a clip
  is selected" means a clip is currently active in playback. No new explicit-selection UI.
- **Create Clip enablement:** enabled only when ALL of:
  1. a clip is active (playing), AND
  2. a usable source video is present (`recapData.video_kind != null`, i.e. the existing
     `canCreateClip` gate), AND
  3. that clip is **not already a draft** (disable if it already exists in drafts).
- **Scope = UI only.** **No storage / sweep / per-clip-source changes.** Create Clip is
  gated to "source exists". See "Explicitly out of scope" below.

## Key context the implementer must know

- **A recap clip's `id` IS its `raw_clip` id.** See
  [games.py:1131-1144](src/backend/app/routers/games.py#L1131-L1144) (recap-data enrichment
  loop already looks up `raw_clips` by the clip id). raw_clips persist even for expired games.
- **`raw_clips` are pure metadata — no per-clip video file exists.** `filename` is always an
  empty string ([clips.py:1024](src/backend/app/routers/clips.py#L1024),
  [database.py:569](src/backend/app/database.py#L569)). The full game video
  (`games/{blake3}.mp4`) is the only source. The expiry sweep
  ([sweep_scheduler.py:160-167](src/backend/app/services/sweep_scheduler.py#L160-L167))
  hard-deletes it after a 14-day grace; once gone, clips can't be re-extracted. This task
  does NOT fix that — it only gates Create Clip to "source exists".
- **Canonical "create a draft" path in Annotate:** `handleFullscreenCreateClip`
  ([AnnotateContainer.jsx:766-826](src/frontend/src/containers/AnnotateContainer.jsx#L766-L826))
  -> `addClipRegion` (local) + `saveClip` ([useRawClipSave.js](src/frontend/src/hooks/useRawClipSave.js))
  -> `POST /api/clips/raw/save`. Reuse this backend save path; do NOT build a parallel one.
- **`NotesOverlay`** ([NotesOverlay.jsx](src/frontend/src/modes/annotate/components/NotesOverlay.jsx))
  is the existing overlay component; see its use in
  [AnnotateModeView.jsx:252-268](src/frontend/src/modes/AnnotateModeView.jsx#L252-L268) for props.
- The recap's active clip is `recap.activeClipId` / `recap.activeClipName` from
  `useRecapPlayback` ([RecapPlayerModal.jsx:92](src/frontend/src/components/RecapPlayerModal.jsx#L92)).

## Solution (high level — DESIGN-GATED, stop at architecture gate)

### Part A — Playback annotations overlay (Annotations tab)
- Render `NotesOverlay` over the recap `<video>` on the Annotations tab, fed from the active
  recap clip (`recapData.clips.find(c => c.id === recap.activeClipId)`): name, notes, rating,
  and game clock (the clips already carry `game_start_time`).
- Visible by default; add a small show/hide toggle (eye icon) in the recap controls/header.
- Hide the overlay when no clip is active (between clips), same as Annotate.

### Part B — Real "Create Clip"
- Replace the navigate-to-Annotate behavior with a direct draft creation for the **active
  recap clip**, reusing the existing `POST /api/clips/raw/save` path with that clip's saved
  metadata (name, rating, tags, notes, game-relative start/end, video_sequence).
- Disable the button when the active clip is already a draft; keep the existing
  `canCreateClip` (source-exists) gate; disable when no clip is active.
- Place the button where it operates on recap clips (Annotations tab). Decide at the design
  gate what happens to the Highlights-tab button (see open questions).

## Open questions for the architecture gate (relay to user)

1. **"Already a draft" detection.** Recommended: add an `in_drafts` boolean per clip to the
   `recap-data` response — the endpoint already queries `raw_clips` by id in its enrichment
   loop ([games.py:1137-1144](src/backend/app/routers/games.py#L1137-L1144)), so this is a
   tiny non-storage backend addition. Alternative: check against the client's loaded clip
   list. Which?
2. **Game-relative times + `video_sequence` for the draft.** For `video_kind == 'recap'`,
   the clip times are recap-relative; the game-relative `start_time` lives in `raw_clips`.
   How should Create Clip obtain the correct game-relative start/end + `video_sequence` —
   extend `recap-data` to return them, or a dedicated "restore draft from recap clip"
   endpoint keyed by `game_id` + clip id?
3. **Highlights-tab button.** The only existing "+Create Clip" button is on the Highlights
   tab and brilliant clips are `final_videos`, not `raw_clips`. Keep its old navigate
   behavior, remove it, or give it the same draft-creation treatment?
4. **Recap-source-only case.** When `video_kind == 'recap'` but the game video is gone, a
   re-created draft still can't be re-extracted later. Acceptable for this task (we only gate
   on `video_kind != null`), or should the gate be stricter?

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/RecapPlayerModal.jsx` — overlay + Create Clip button/handler
- `src/frontend/src/components/recap/RecapClipsSidebar.jsx` — active clip rendering
- `src/frontend/src/components/recap/useRecapPlayback.js` — active clip state
- `src/frontend/src/modes/annotate/components/NotesOverlay.jsx` — overlay component to reuse
- `src/frontend/src/modes/AnnotateModeView.jsx` — reference NotesOverlay usage
- `src/frontend/src/containers/AnnotateContainer.jsx` — canonical create-draft flow
- `src/frontend/src/hooks/useRawClipSave.js` — `saveClip` -> `POST /api/clips/raw/save`
- `src/backend/app/routers/games.py` — `recap-data` endpoint (for `in_drafts` / times, if chosen)

### Related Tasks
- Related: T4080 (recap clip game-time enrichment), T4050/T4010 (re-export source-extract
  failure when game video expired).
- Follow-up (NOT this task): "Always preserve per-clip source so clips outlive game
  deletion" — extract+store per-clip videos, repoint re-export, teach the sweep to delete
  games not clip sources. Explicitly deferred per user decision.

### Explicitly out of scope
- Any R2 / storage-sweep / grace-period change.
- Per-clip source video materialization.
- Changing how an expired game's full video is handled.

## Implementation

### Steps
1. [ ] (Design gate) Resolve open questions 1-4; stop for approval before coding.
2. [ ] Part A: wire `NotesOverlay` into the Annotations tab, visible-by-default + toggle.
3. [ ] Part B: rewire Create Clip to create a draft for the active clip via existing save path.
4. [ ] Enable/disable logic: active clip + source-exists + not-already-a-draft.
5. [ ] Backend (if chosen): add `in_drafts` and/or game-relative times to `recap-data` (no storage change).
6. [ ] Tests (frontend unit; backend if endpoint touched).

## Acceptance Criteria
- [ ] Annotations-tab recap playback overlays the active clip's name/notes/rating, visible by
      default, hideable via a toggle; hidden between clips.
- [ ] "+Create Clip" creates the active clip as a draft (raw_clip) via the existing save path,
      WITHOUT navigating to the full-game Annotate view.
- [ ] The button is disabled when: no clip is active, no source video exists, or the active
      clip is already a draft.
- [ ] No storage/sweep/per-clip-source code is changed.
- [ ] Frontend tests pass (and backend tests if the endpoint was touched).
