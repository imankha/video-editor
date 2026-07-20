# T5656: Prep markers -> Annotate clip candidates

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-07-20
**Epic:** [Multi-File Ingest & Prep](EPIC.md) (task 6/7)

## Epic Context
See [EPIC.md](EPIC.md) + study section 0. The Prep->Annotate bridge: during the low-fi Prep
preview, the user can mark a play they know they want; those markers seed Annotate.

## Problem
A user scanning raw footage in Prep spots plays worth annotating, but that intent is lost between
Prep and Annotate.

## Solution
- Prep preview (LRF playback of the assembled, trimmed timeline) supports dropping **"annotate this"
  markers** (a timestamp + optional label) - the "watered-down animation" the user watches.
- Markers are stored on the created game (timeline times, valid against proxy + master) and surface
  in **Annotate as pre-seeded clip candidates** (not auto-clips - candidates the user confirms/edits).

## Context
### Relevant Files
- Prep container/view (T5652) + preview (LRF playback).
- `.claude/knowledge/annotate.md`; Annotate clip-candidate surface.
- Game-video model (T5651) to persist markers alongside the video.

### Related Tasks
- Depends on T5652 (Prep shell) + T5653 (assembled timeline) + T5654 (Annotate-on-proxy).

### Technical Notes
- Markers are candidates, not clips - keep the human-in-loop model (Annotate is the decision surface).
- Marker times must remain valid post trim+concat (they are set on the ALREADY-assembled timeline).
- Persistence is gesture-based (marker drop = one write); no reactive persistence.

## Acceptance Criteria
- [ ] User drops markers during Prep preview; they persist on the game.
- [ ] Markers appear in Annotate as pre-seeded clip candidates at the right times.
