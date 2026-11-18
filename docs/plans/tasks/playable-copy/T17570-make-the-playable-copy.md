# T17570: Make the playable copy

**Status:** BLOCKED
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

Make the copy automatically after an iPhone game uploads, and from a button for older games, using the fastest approach the prototypes settled.

## How we got here

Phase B of the T17390 design, replaced in part by the T17540 approach. Blocked on T17560. See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

As in design Phase B with the T17540 approach: Modal job, trigger on activate and attach, the one idempotent endpoint, cleanup with the original, staging measurement.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: The design's Phase B criteria B1 to B6, as updated, all pass.
- [ ] C2: The approved wait target is met on staging.
