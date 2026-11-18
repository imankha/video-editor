# T17580: Serve the playable copy

**Status:** BLOCKED
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

Once a copy is ready, every browser plays it; exports keep the original.

## How we got here

Phase C of the T17390 design. Blocked on T17570. Deploy gate: the Postgres migration must have run in that environment first. See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

As in design Phase C: `browser_playback_key`, the status fields, the two direct presign sites, a characterization test first.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: The design's Phase C criteria (C3-a, C-1 to C-3) all pass.
