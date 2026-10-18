# T8865: Make highlights from plays before the whole game video has uploaded

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-10-18
**Updated:** 2026-10-18

## Problem

A parent can mark plays in Annotate while their game uploads, but cannot turn any of
them into a highlight until the WHOLE upload finishes. On a big game over a slow
connection (the exact case the Pre-Shrink milestone exists for: tens of GB, hours of
upload) that means marking plays, then waiting hours before Framing (Focus) or Spotlight
(Overlay) will open. The wait sits right at the clip cliff, the step where users drop off.

Today this is a deliberate, enforced lock (shipped 2026-10-17, commit 58b109087,
"T0: no highlight path while the game is still uploading"):
- Backend: a clip whose source game is still `pending` raises `GameSourceUploading`
  (HTTP 409 `{"code": "source_uploading"}`, `src/backend/app/routers/games.py`) because
  `games/{hash}.mp4` does not exist in R2 yet.
- Frontend: `useIsGameUploading(gameId)` (uploadStore) locks the orientation slots, skips
  the 5-star highlight-choice card, hides Frame/Spotlight in the header, and the guide
  rules `annotate.uploading.*` steer to marking plays only. Home excludes drafts waiting
  on an upload. Full description: `.claude/knowledge/guidance.md` invariant 8,
  "Uploading games never steer toward a highlight".

User direction 2026-10-18: lift this as part of Video Pre-Shrink.

## Solution (direction, not a design; Architect gate required)

Unlock a play for Framing/Spotlight as soon as **the footage it covers** is available,
instead of when the whole game is. The Architect picks the mechanism. Candidates, all of
which build on the pre-shrink pipeline:

1. **Per-segment availability.** The pre-shrink pipeline (T8860) already uploads a game
   as an ordered set of segments (segment i shrinks while i-1 uploads). Make each
   finished segment its own readable R2 object. A play that lies wholly inside uploaded
   segment(s) becomes extractable, and the backend gate becomes per play, not per game.
   Open question: how a play that spans a segment boundary is handled, and what the
   game-level `video_sequence` / playback model has to become.
2. **Client-side play cut.** The shrink worker already decodes and encodes locally
   (WebCodecs). On "make a highlight", cut just that play's range from the local file(s)
   and upload it first, at high priority, as the clip's source. This works for a play
   anywhere in the game, but it needs a canonical answer for which bytes are the clip's
   source once the full game lands (see Technical Notes).
3. **Priority upload of the play's byte range.** Reorder the upload so the parts that
   cover a marked play go first. Probably not viable on its own: an R2/S3 multipart
   object is not readable until `CompleteMultipartUpload`, so uploaded parts cannot be
   served mid-upload. Listed so the Architect rules it out explicitly rather than by
   omission.

Whatever the mechanism, the user-facing contract is:
- A play whose footage is available shows the normal highlight path (slots, choice card,
  Frame/Spotlight). A play whose footage is not yet available stays locked, with copy
  that says it unlocks when that part finishes uploading. No silent dead ends.
- Exports from early footage are byte-for-byte as good as exports after the upload
  completes (Annotate/Focus quality-tier rule: Focus exports the best available source).
- Closing the tab, reload, other device: the lock state comes from the backend, not
  just the in-tab uploadStore. This also closes the residual documented in guidance.md
  invariant 8, where a pending game opened with no store entry is ungated and Focus
  renders a blank player on the 409.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games.py`: `GameSourceUploading`, `resolve_game_source_status`, the clip source seams that raise 409
- `src/backend/app/routers/clips.py`: clip extraction and source resolution
- `src/frontend/src/stores/uploadStore.js`: `useIsGameUploading`, upload queue
- `src/frontend/src/components/instructions/resolveGuide.js`: `annotate.uploading.*` rules (become per-play)
- `src/frontend/src/modes/annotate/components/HighlightOrientationSlots.jsx`, `HighlightChoiceCard.jsx`: `locked` / `offersHighlightChoice`
- `src/frontend/src/components/shared/UnifiedHeader.jsx`: Frame/Spotlight hidden while uploading
- `src/frontend/src/components/ProjectManager.jsx`, `DraftTile.jsx`: Home `drafts` fact excludes upload-blocked drafts
- `src/frontend/src/services/shrink/` (created by T8845): worker + client API, if candidate 2 is chosen
- Upload path from T8860 (two-slot segment pipeline)

### Related Tasks
- Depends on: T8860 (segment upload pipeline), and through it T8845 + T8850
- Builds on: commit 58b109087 (the current upload lock this task relaxes)
- Related: T9070 (client `stss` keyframe index; makes a client-side cut seek-accurate and cheap), T9080 (proxy poster frames)

### Technical Notes
- **Single canonical source per clip.** If a clip is cut from early footage (a segment
  object or a client-cut file), decide whether it stays bound to that object or is
  re-pointed to `games/{hash}.mp4` once the game completes. Either is fine, but it must
  be one rule, and its migration/re-point must not be reactive (no "on load, notice the
  game finished, rewrite the clip" fixup). See CLAUDE.md "Correct data, not workarounds"
  and the T4130 note that clips have NO independent source today.
- **Content-hash identity.** Game objects are keyed by blake3 of the full file. Segment
  or clip objects need their own identity and storage accounting (ref counts:
  `project_game_video_refcount_drift` history) and cleanup when the game completes or
  the upload is abandoned.
- **Credits.** Upload credits are charged from actual uploaded bytes (T8860). An early
  clip cut must not double-charge the same footage.
- **Failure.** If the full upload later fails or is abandoned, highlights already made
  from early footage must keep working, or the user must be told clearly what happened.
- Knowledge docs: `.claude/knowledge/annotate.md`, `.claude/knowledge/export-pipeline.md`,
  `.claude/knowledge/persistence-sync.md`, `.claude/knowledge/guidance.md`,
  `.claude/knowledge/modal-gpu.md`.

## Implementation

### Steps
1. [ ] Architect design doc `docs/plans/tasks/T8865-design.md`: choose the mechanism (rule out candidate 3 with evidence), the per-play availability model, the canonical-source rule, storage identity/cleanup, credits, the failure story; user approval
2. [ ] Backend: per-play (not per-game) source availability; 409 only when THIS play's footage is missing
3. [ ] Frontend: lock and guide copy driven by per-play availability from the backend, not just the in-tab store
4. [ ] Migration if the schema changes (Migration agent)
5. [ ] e2e: mark a play in an already-uploaded part while the rest uploads, frame it, export it; a play in a not-yet-uploaded part stays locked with the right copy

### Progress Log

**2026-10-18**: Filed (user direction). Not started; gated on T8860.

## Acceptance Criteria

- [ ] With a game mid-upload, a play whose footage is already uploaded can be framed, spotlighted, and exported
- [ ] A play whose footage is not yet uploaded stays locked with copy saying it unlocks when that part finishes
- [ ] The export is identical in quality to one made after the upload completes
- [ ] Lock state survives reload / another device (backend-derived); a pending game opened from a direct link never shows a blank Focus player
- [ ] No double credit charge; an abandoned upload leaves already-made highlights working (or clearly explained)
- [ ] Guide rules `annotate.uploading.*` updated to per-play behavior; guidance.md invariant 8 rewritten
