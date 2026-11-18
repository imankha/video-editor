# T17560: Playable copy foundation

**Status:** BLOCKED
**Impact:** 6
**Complexity:** 4
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

The groundwork for playable copies: the encoder settings and the place the copy's status is kept. Nothing changes for parents.

## How we got here

Phase A of the T17390 design. Blocked until the prototypes T17520 to T17550 are done and the owner approves the design update (see EPIC.md). See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

As in design Phase A, adjusted by the prototype results: pure encoder module (`needs_playable_copy`, the ffmpeg command), the Postgres `playable_copies` table with its migration and `_SCHEMA_DDL`, and the repository (claim, mark ready, mark failed, derived status). The probe fields come from T17510.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: The design's Phase A acceptance criteria A1 to A5, as updated after the prototypes, all pass.
