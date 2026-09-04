# T8700: Game upload — surface Opponent/Date, keep video optional-not-hidden, support multiple videos per game

**Status:** WIP (dotask spawn)
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-04

## Problem

User feedback (2026-09-04) live-testing on staging-bound branches:

1. **Opponent Team + Game Date are currently under a de-emphasized "optional" header**
   (`GameDetailsModal.jsx:409`, "Game details (optional - you can edit these later)").
   User: "I dont like ... leaving optional edit Opponent Team and Game Date, I feel like we
   need those." Reads as wanting these fields to feel required/important at creation time,
   not tucked away as skippable.
2. **Video upload should be optional but NOT hidden**, and **users should be able to add
   MANY videos to a game after opening it** (today: confirm exact current behavior via
   Code Expert — filing language suggests video attach is currently tied to game-creation
   time only, with no clear multi-video-per-game upload entry point once a game exists).
   Repeated later in the same feedback session: "I need a way to upload more videos to the
   game."

## Solution (needs a design pass — real UX/IA decisions, not scoped in depth here)

Two related but distinct changes:
- **Game details form**: make Opponent Team + Game Date feel like real, wanted fields
  (not "optional, skip me") without making them hard-blocking (the user did NOT say
  required-to-submit, just "not optional-feeling"). ui-designer should propose exact
  copy/layout treatment.
- **Video attachment**: (a) confirm/keep video upload optional at game-creation time but
  make it visually present, not hidden behind a toggle/collapsed section; (b) add a real
  entry point to attach additional videos to an EXISTING game after it's been created —
  this is new functionality (or needs verifying it doesn't already exist somewhere
  undiscovered — Code Expert pass first, per the T8370-precut-clip-upload precedent where
  Architect found an existing-but-undermaintained upload path rather than needing new
  plumbing).

## Context

### Relevant Files (anticipated — confirm via Code Expert)
- `src/frontend/src/components/GameDetailsModal.jsx` (game creation form — Opponent Team
  L415-420, Game Date presumably nearby, "optional" header L409)
- Game video upload flow (`FileUpload.jsx`? `useGameUpload`? — locate the actual upload
  entry point(s) and whether one exists for an already-created game)
- Backend: game creation endpoint + whatever endpoint (if any) currently supports
  attaching a video to an existing game — check for reuse potential from
  [T8370](T8370-precut-clip-upload.md)'s recently-promoted clip-source upload path

### Related Tasks
- [T8370](T8370-precut-clip-upload.md) (STAGING, merged) — recently promoted an
  undermaintained upload endpoint to first-class for pre-cut CLIPS; check whether its
  pattern/plumbing is reusable for "attach another video to an existing GAME" rather than
  building parallel upload machinery.
- [T8680](T8680-r2-enabled-env-load-order-bug.md) — fixed a real R2-config bug found while
  testing this exact flow; already resolved, no dependency, just context for why upload
  failed during discovery.

### Technical Notes
- **ui-designer pass required** for both the form-field treatment and the multi-video
  entry point placement.
- Data safety: confirm attaching a second video to a game doesn't silently orphan/replace
  data tied to the first video (clips, framing, etc. reference `raw_clips`/game rows —
  check invariants in `.claude/knowledge/annotate.md` before assuming multi-video is purely
  additive).

## Acceptance Criteria

- [ ] Opponent Team + Game Date read as genuinely-wanted fields at game creation (exact
      treatment per the design pass), still not hard-blocking submission
- [ ] Video upload at game-creation time is visibly present (not hidden/collapsed), still
      optional
- [ ] A user can attach additional video(s) to an already-created game from within the app
- [ ] Existing single-video games are unaffected (no forced migration/backfill)
- [ ] Tests pass (unit + e2e covering the new multi-video attach flow)
