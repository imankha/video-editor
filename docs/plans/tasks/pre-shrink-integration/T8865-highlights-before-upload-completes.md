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

## Solution

Unlock a play for Framing/Spotlight as soon as **the footage it covers** is available,
instead of when the whole game is. User direction 2026-10-18 sets the mechanism, in this
order of preference:

1. **First choice: the play's footage is already uploaded.** Use it directly.
2. **Otherwise: the client uploads just the snippet of video for that play**, cut from
   the local file it is already uploading, and the highlight is made from the snippet.

When the full game lands, the clip moves back to the game video with no rewrite step
(see "Source resolution" below).

### Implementation details

**What "already uploaded" means.** An R2/S3 multipart object is not readable until
`CompleteMultipartUpload`, so a half-uploaded file cannot be served, whatever parts have
arrived. "Already uploaded" therefore means a COMPLETE object:
- A multi-file game (camera folder, halves): each file is its own `game_videos` row
  (`blake3_hash`, `sequence`, `duration`, `offset_seconds`) and its own
  `games/{hash}.mp4` object. The game stays `status = 'pending'` until every file is in,
  but a finished file is already a complete, readable object. A play wholly inside a
  finished file can use it today.
- With pre-shrink (T8860), each segment is uploaded as its own file, so the same rule
  covers shrunk segments.
- A single-file game mid-upload never has its footage "already uploaded": every play on
  it takes the snippet path. A play that spans two files, one not yet finished, also
  takes the snippet path.
- Readiness is decided on the backend from the upload's own completion record for that
  file (finalize/complete), never inferred from the client's store.

**The snippet (client side).**
- Trigger: the user's highlight gesture on a play whose footage is not available (Make a
  highlight / choosing an orientation slot / Frame or Spotlight). Never reactive: no
  effect that notices a play and uploads.
- Cut by REMUX, not re-encode, so quality is identical to the source: demux the local
  file with mp4box.js (added to the app by T8845), take the samples from the sync sample
  at or before `start - pad` through `end + pad`, and mux them with mp4-muxer. T9070's
  client `stss` keyframe index gives the start sample without scanning. `pad` = the trim
  extension Focus allows on a game-backed clip (find the constant), so trimming in Focus
  behaves the same as on a game-backed clip, within that window.
- Cut from the ORIGINAL local file, not a shrunk segment, when both exist (see the
  quality note below).
- Upload through the existing per-clip upload infrastructure (direct clip upload,
  `clips.py` `/clips/upload`: blake3-named object under the user's `raw_clips/`), at a
  priority ahead of the game upload's remaining parts. A snippet is MBs, so it should
  land in seconds even while the game upload saturates the link; pause or throttle the
  game upload while a snippet is in flight if measurement shows it is needed.
- It is the SAME `raw_clips` row (game clip, `source = 'game'`), not a new
  `source = 'upload'` clip: the snippet only gives that play a temporary source.

**Source resolution (backend).** `resolve_clip_source` (`services/export_helpers.py`)
already resolves in order (1) game video present, (2) per-clip extract in
`raw_clips.filename` (T4175's post-expiry preserved extract), (3) recap, (4) visible
failure. The snippet is stored as that clip's per-clip extract:
- While the game is uploading, step 1 misses and step 2 serves the snippet.
- Once the game completes, step 1 wins on its own. The clip moves back to the game video
  with no re-point, no migration and no "on load, notice the game finished" fixup.
- The snippet is padded and keyframe-aligned, so it does NOT start at the clip's
  `start_time`. Store its game-time origin explicitly (a new `raw_clips` column such as
  `extract_start_time`; Migration agent, `profile_db` track) and have step 2 return
  `(extract_url, start_time - extract_start_time, end_time - extract_start_time)`
  instead of `(0, duration)`. T4175 extracts set it to their own start, so both kinds of
  extract use one rule. Do not encode the origin in the filename.
- `flexible` stays False for a snippet: trims are bounded by the padded window. Make sure
  the Focus UI respects that bound, as it does for preserved extracts today.
- Other `raw_clips.filename` readers (about 40 references in the backend) assume
  "non-empty filename on a game clip = post-expiry preserved extract". Audit each one.
  The T4175 expiry sweep must not overwrite or delete a snippet without replacing it, and
  clip delete already removes `raw_clips/{filename}` from R2.
- Verify step 1 for multi-file games: it keys on the game's `blake3_hash`; a play inside
  one finished file of a pending multi-file game must resolve to THAT file's object
  (`game_videos.blake3_hash`, time minus `offset_seconds`).

**Quality note for the design.** Preferring the game video (step 1) is right while the
game is the unshrunk original. If the game went up SHRUNK (T8850's Small preset) and the
clip has a snippet remuxed from the original, the snippet is the better source.
"Focus exports the best available" then means keeping the snippet. Decide this
explicitly in the design. Simplest rule: keep a snippet whose source is the original
whenever the game was shrunk, and record that on the row rather than inferring it.

**The gate.** `assert_clip_source_available` (`routers/games.py`) is per GAME today:
`status == 'uploading'` raises 409 `source_uploading` for every clip. Make it per CLIP:
available if the play's `game_videos` file object is complete, or the clip has a
snippet. 409 only when neither is true. The clip playback-url seam, the `/stream` proxy
and the Focus export entry all share this gate, so they stay in agreement.

**Frontend.**
- Replace `useIsGameUploading(gameId)` as the highlight lock with per-play availability
  from the backend (on the clip/region payload). The in-tab uploadStore only says
  whether a snippet upload is IN FLIGHT. This makes the lock survive reload and other
  devices, and fixes guidance.md invariant 8's residual (a pending game opened from a
  direct link shows a blank Focus player on the 409).
- A play that needs a snippet shows the normal highlight path. The gesture starts the
  snippet upload, with a short "Preparing this play" progress state in place of the
  slots, and opens Framing when it lands. A failure toasts and leaves the play as it was.
  Never a dead end, never a silent no-op.
- Guide rules `annotate.uploading.*` (`resolveGuide.js`) go per play. The 5-star choice
  card (`offersHighlightChoice`), orientation slots (`locked`) and header Frame/Spotlight
  follow the same per-play fact. Home's `drafts` fact stops excluding drafts whose clip
  has a source.
- The local file must still be available for a snippet cut. After a reload with the
  upload paused (no file handle), the play stays locked until the user Resumes the
  upload, and the copy says so.

**Credits and storage.** Upload credits come from actual uploaded bytes (T8860). Do NOT
charge for snippets: the same footage is paid for when the game lands, and snippet
bytes are small. Snippet objects are counted and cleaned like preserved extracts. A
snippet that has been superseded by the game video (and is not kept for the quality
reason above) may be deleted by an explicit step at game activation. That is part of the
activate gesture, not a reactive sweep, and it is optional (a few MB per play).

**Failure and abandonment.** If the game upload fails or is abandoned, highlights made
from snippets keep working, because step 2 serves them independently of the game. When
the game is deleted, its clips (and snippets) follow the existing delete cascade.

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
1. [ ] Architect design doc `docs/plans/tasks/T8865-design.md` built on the Implementation details above. Settle: the pad constant, the `extract_start_time` column, the shrunk-game quality rule, per-file completion as the backend's readiness signal, the snippet upload priority. Get user approval.
2. [ ] Migration: `raw_clips.extract_start_time` (`profile_db`), backfilled for existing T4175 extracts
3. [ ] Backend: `resolve_clip_source` step 2 honours `extract_start_time`, step 1 resolves a finished file of a pending multi-file game; `assert_clip_source_available` becomes per clip (file object complete OR snippet present); audit the other `raw_clips.filename` readers; a snippet attach endpoint (or extend the clip upload) that writes the clip's `filename` + `extract_start_time` and charges no credits
4. [ ] Frontend: client remux cut (mp4box.js + mp4-muxer, `stss` start sample, pad) in the shrink worker; snippet upload ahead of the game upload; per-play availability from the backend replaces `useIsGameUploading` as the highlight lock; "Preparing this play" state; guide rules per play
5. [ ] Tests: backend resolution order (game, then snippet with offsets, then recap); gate per clip; remux keeps the exact frames (frame-hash compare against the source range); e2e: mark a play in an already-finished file of a multi-file game (first choice, no snippet), mark a play in a single-file game mid-upload (snippet), frame and export both, then let the game finish and confirm the clip now resolves to the game video

### Progress Log

**2026-10-18**: Filed (user direction). Not started; gated on T8860.

**2026-10-18**: Mechanism set by the user: use already-uploaded footage first, else the client uploads just that play's snippet. Implementation details written against the current `resolve_clip_source` order and the per-file `game_videos` model.

## Acceptance Criteria

- [ ] With a game mid-upload, a play inside an already-finished file is framed and exported from that file (no snippet uploaded)
- [ ] With a game mid-upload, a play in footage not yet uploaded is framed and exported from a client-uploaded snippet, remuxed with no re-encode
- [ ] Once the game finishes, the clip resolves to the game video with no write to the clip row (except the quality rule for shrunk games)
- [ ] A play whose snippet cannot be cut (no local file after reload) stays locked, with copy telling the user to resume the upload
- [ ] The export is identical in quality to one made after the upload completes
- [ ] Lock state survives reload / another device (backend-derived); a pending game opened from a direct link never shows a blank Focus player
- [ ] No double credit charge; an abandoned upload leaves already-made highlights working (or clearly explained)
- [ ] Guide rules `annotate.uploading.*` updated to per-play behavior; guidance.md invariant 8 rewritten
