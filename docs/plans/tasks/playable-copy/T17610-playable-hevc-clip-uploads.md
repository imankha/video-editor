# T17610: Playable HEVC clips uploaded directly

**Status:** BLOCKED
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

A play uploaded directly as an iPhone clip is still HEVC and plays sound only in some browsers. Give it a playable copy too.

## How we got here

Design risk R10. Follow-up after T17590; T17500 adds the message now. See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

Apply the same copy mechanism to direct clip uploads.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: A directly uploaded HEVC clip plays with its picture in a browser without HEVC.
- [ ] C2: H.264 clip uploads are unchanged.
