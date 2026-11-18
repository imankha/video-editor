# T17600: Playable saved clips of iPhone games

**Status:** BLOCKED
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

After an iPhone game expires, its saved clips are still HEVC, so Frame plays them with sound only in Chrome. Make those short clips playable too.

## How we got here

Design risk R9. Follow-up after T17590. See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

Re-encode preserved extracts to H.264 when the source needed a copy, instead of a stream copy.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: A saved clip of an expired HEVC game opens in Frame with its picture in a browser without HEVC.
- [ ] C2: H.264 extracts are unchanged.
