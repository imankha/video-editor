# T7280: Single-Clip Upload Goes Straight to Framing

**Status:** WIP
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

A real user uploaded a single 20-second clip of his son scoring a goal and was confused:
the app dropped him into Annotate, but he expected to go straight to Framing — there is
nothing to annotate in a clip that IS the play. Today every upload is treated as a full
game: navigation to Annotate is decided at `ProjectsScreen.jsx` (`handleAnnotateWithFile`
→ `setEditorMode('annotate')`) BEFORE the file is even inspected. There is no duration
branch anywhere in the flow.

This is also the future landing experience for clip contributors in the Game Pools /
Dual-Camera epic (a parent adding one iPhone clip to a shared game should frame it and be
done) — but this task is deliberately standalone and ships first; it must not depend on
any epic work.

## Solution

Duration-based fast path, decided at file pick (metadata is already extracted client-side
in `extractVideoMetadata`):

1. **If duration ≤ CLIP_THRESHOLD (2 minutes): treat as a clip upload.**
   - Create the game container exactly as today (same upload pipeline: blake3 →
     prepare/finalize/activate; same credit charge — pricing changes are out of scope).
   - Auto-create ONE `raw_clips` row spanning the full file (`start_time=0`,
     `end_time=duration`, `video_sequence=1`) with `create_project: true` so the draft
     reel exists — this reuses the existing `POST /api/clips/raw/save` gesture rails, no
     new backend surface expected.
   - Navigate to **Framing** with that clip selected instead of Annotate.
2. **Inline escape hatch, not a modal:** a quiet, dismissible notice on arrival —
   "Looks like a single play — jumped straight to framing. · **Treat as full game**" —
   where the escape switches to Annotate with the same game (and removes nothing; the
   auto clip region is still valid there and can be edited/deleted normally).
3. **Annotate stays one tap away, never forced.** The game exists on the Games tab as
   usual; opening it from there behaves per existing rules. The user can add more videos
   to the game later (halves, more clips) via existing flows.
4. Uploads longer than the threshold are byte-identical to today.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/ProjectsScreen.jsx` — `handleAnnotateWithFile` (~line 339):
  the single nav seam; add the duration branch here
- `src/frontend/src/containers/AnnotateContainer.jsx` — `handleGameVideoSelect` (~line
  350): metadata extraction + upload kickoff; the clip path needs the equivalent without
  entering Annotate mode
- `src/frontend/src/utils/videoMetadata.js` — `extractVideoMetadata` (duration source)
- `src/frontend/src/services/uploadManager.js` — `uploadGame` / `onGameCreated` callback
  (the game_id needed for the auto clip save)
- `src/frontend/src/stores/uploadStore.js` — upload state consumed by the editor screens
- `src/frontend/src/hooks/useRawClipSave.js` (or the container's `saveClip` path) — the
  gesture rail for the auto clip + `create_project: true`
- `src/frontend/src/screens/FramingScreen.jsx` (or framing entry container) — accepting
  a pending clip selection on entry (see T3960 select-on-load pattern in
  `AnnotateScreen.jsx:407-464` for the existing "select clip once loaded" precedent)
- `src/backend/app/routers/clips.py` — `save_raw_clip` (should need NO change;
  verify idempotency on the natural key for the auto clip)

### Related Tasks
- Feeds into: Game Pools / Dual-Camera epic (tasks/dual-camera/EPIC.md) — clip-kind
  feeds reuse this landing flow. No dependency in either direction.
- Precedents: T3960 (select-clip-on-load timing), T4000/T4060 (never gate a load path on
  "some video src exists" — the fast path must not break the pendingGame breadcrumb
  contract), T7010 (`raw_clips.game_id` write-once; the auto clip must carry the new
  game's id from `onGameCreated`, never a stale active-game id)

### Technical Notes
- **Persistence stays gesture-based.** The upload button IS the gesture; the auto clip
  save is a direct consequence of that gesture (one surgical POST once `onGameCreated`
  fires), not a reactive effect watching state. Do not implement it as a
  `useEffect`-watches-upload-state write; wire it into the upload callback chain.
- Threshold constant in ONE place (frontend), e.g. `SINGLE_CLIP_THRESHOLD_SECONDS = 120`,
  next to the other upload constants — greppable, not computed.
- The clip's blob URL should be usable for instant Framing preview the same way Annotate
  uses it today (upload continues in background; framing edits persist against the
  game_id — verify the framing screen tolerates a still-uploading source the way
  Annotate does via the upload-store restore effects).
- Multi-file selection (per-half flow) never takes this branch regardless of durations.
- Quest note: this game upload still counts as `upload_game`; the auto-created clip
  should count as `add_clip` naturally via the same rails (verify quest probes don't
  double-fire).

## Implementation

### Steps
1. [ ] Add duration branch in `handleAnnotateWithFile` (single-file only, ≤ threshold)
2. [ ] Clip path: start upload without entering Annotate; on `onGameCreated`, save the
       full-span raw clip with `create_project: true`
3. [ ] Enter Framing with the new clip selected (blob URL preview while upload runs)
4. [ ] Inline "Treat as full game" escape → switches to Annotate for the same game
5. [ ] Tests: unit for the branch + threshold; e2e for upload-short-clip → lands in
       Framing → escape hatch → Annotate shows the same game/clip
6. [ ] Real-browser verify (jsdom false confidence on navigation/timing — T5380 lesson)

### Progress Log

**2026-08-19**: Filed from the Game Pools design session (user: "let's do the straight
to Framing task as an Upcoming priority and different than the rest of this epic").

## Acceptance Criteria

- [ ] A single file ≤ 2 min lands in Framing with a full-span clip + draft reel, no
      Annotate detour
- [ ] "Treat as full game" escape lands in Annotate with the same game, nothing lost
- [ ] Files > 2 min and multi-file uploads are byte-identical to today
- [ ] Upload cost, quest counting, and game-card behavior unchanged
- [ ] Tests pass (unit + e2e), real-browser verified
