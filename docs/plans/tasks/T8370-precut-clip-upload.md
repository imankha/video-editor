# T8370: Pre-cut clip upload support (clips without a full game)

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-09-02

Filed from the T7620 guided-Help design round (user directive 2026-09-02): the guided
path's very first fork asks "full game or pre-cut clips?", but the pre-cut branch has
nothing real to point at - the app only ingests full games. **User directive: this ships
BEFORE the tutorial launches** (gates T7640 rollout, not T7620/T7630 implementation).

## Problem

A meaningful slice of the audience arrives with pre-cut clips, not full games: phone
captures from the sideline, Veo/Trace auto-cut highlights, clips received from other
parents. Today the only ingest path is Add Game (full-game semantics: heavy upload,
per-game credits, annotate-to-extract workflow).

Observed real failure (2026-08 ux investigation, cited in T7620-design.md): a user
uploaded four pre-cut clips as four separate GAMES - credits burned, zero output, because
the game workflow assumes you extract clips FROM the video, and a 15-second clip "game"
makes every downstream step nonsensical.

What "support clip uploads" means: an uploaded video file becomes a CLIP (ready for
Focus -> publish), not a game.

## Architectural constraint (the design gate's core question)

**Clips have NO independent source today** (T4130 finding, recorded in memory): a
`raw_clips` row is a time window into its game's video; `working_clips`, exports, recap,
and the Modal pipeline all resolve pixels through the game's source hash. Two candidate
shapes, to be decided by the Architect (with real tradeoffs - do not pre-commit):

1. **Wrapper game**: each upload (or batch) creates a lightweight, possibly hidden,
   auto-game whose video is the clip file; a `raw_clips` row spans its full duration.
   Cheapest reuse of every pipeline invariant, but reintroduces the observed failure
   shape unless the wrapper is genuinely invisible (games list, credits copy, storage
   UI, game tiles must not surface it as a "game" the user manages).
2. **Independent clip source**: `raw_clips` (or a sibling) gains its own source video
   ref. Cleaner model, but touches every seam that assumes clip -> game -> hash
   (exports, storage refs/expiry, recap, share materialization, ref-counting - the
   T6770 minefield), and needs a profile_db migration.

Either way the design must cover: upload flow reuse (multipart, R2, blake3 dedup, the
T8160 UploadId lesson), credit pricing for small files (flat ceil(seconds) is the
existing model - is a 5x 15s batch 5 credits or priced differently? user call), storage
refs + expiry semantics, batch upload (multiple clips in one gesture), and what Annotate
shows for such clips (there is nothing to annotate - they skip straight to the Clips
surface / Focus).

## Analytics + naming (already-reserved hooks to honor)

- **`clip_uploaded` event**: T7860 (STAGING) reserved the name + funnel position in
  FLOW_EVENTS/FUNNEL_STEPS, distinct from `clip_created` (annotation-sourced), and
  DEFERRED the `daily_counters.clips_uploaded` PG column to avoid a dead column. This
  task implements the emit + adds the column (Migration agent, postgres track).
- **Naming**: T8130's approved naming table rejected "New Clip" for the assembly button
  and reserved it "for T7860's future direct-clip upload" - i.e. THIS feature. The
  user-facing entry point is T8380's "Add Video" button on the Clips screen; reconcile
  the reserved "New Clip" name vs "Add Video" at design time (T8380 owns the UI naming,
  this task owns the vocabulary being consistent).

## Context

### Relevant Files (initial map - Architect refines)
- `src/backend/app/routers/games.py` / upload seams - the existing multipart upload +
  finalize flow to reuse (NOT duplicate)
- `src/backend/app/routers/clips.py` - raw_clips model, `clip_created` emit (:1292)
- `src/backend/app/database.py` - profile_db schema (raw_clips/working_clips/projects);
  migration if shape 2
- `src/backend/app/analytics.py` - `clip_uploaded` reserved slot (FLOW_EVENTS/FUNNEL_STEPS)
- `src/backend/app/services/pg.py` - `daily_counters.clips_uploaded` column (postgres track)
- Storage ref / expiry seams (`game_storage`, ref-count derivation - T6770)
- `src/frontend` upload components (Add Game flow) - reuse surface for T8380

### Related Tasks
- Blocks: [T8380](T8380-clips-screen-add-video.md) (the UI entry), **T7640** (tutorial
  rollout - user directive: clip upload ships first)
- Feeds: T7620's F1 fork pre-cut branch (guided path points here once live)
- Related: T7860 (reserved `clip_uploaded`), T8130 (naming reservation), T5495 (Game
  Pools video-optional games - shares the "game without the classic upload" territory;
  check its awaiting-video game shape before inventing a new one), T448 (PWA Share
  Target - future camera-roll entry, same capability underneath), Multi-File Ingest epic
  (different problem: giant multi-file GAME footage; do not conflate)
- The 30fps/pricing question (T8280) may interact with clip-upload pricing - reference
  only.

### Technical Notes
- L-tier, **Architect design gate required** (the clip-source-model decision above).
- Wrapper-game shape, if chosen, must be provably invisible: games list filter, credits
  ledger copy, storage/expiry UI, admin metrics (T8220's tried/succeeded pair must not
  count wrapper games as game uploads - use `clip_uploaded`, not `game_created`).
- Migration agent: postgres track for the counter column; profile_db track if shape 2.
- Upload reliability lessons apply: R2 UploadId instability (T8160), durable_sync on
  finalize (T8150), cascade cleanup on failure (T7470-T7510 epic).

## Acceptance Criteria

- [ ] Architect design doc approved (clip source model decided with tradeoffs shown)
- [ ] An uploaded video file becomes a clip ready for Create Reel / Focus with no
      annotate step and no user-visible "game"
- [ ] Batch upload (multiple files in one gesture) works
- [ ] Credits charged per the design's approved pricing rule; failure paths refund per
      the upload-integrity epic's rules
- [ ] `clip_uploaded` emitted (funnel + user detail + pulse) with the
      `daily_counters.clips_uploaded` column added; `clip_created` untouched
- [ ] Storage refs/expiry correct for clip sources (no ref-count drift class)
- [ ] Tests pass (upload seam + pipeline + analytics emit)
