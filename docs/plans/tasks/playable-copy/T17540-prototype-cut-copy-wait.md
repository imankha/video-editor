# T17540: Prototype: cut the wait for a playable copy

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

The owner will not ship a wait of about 12 minutes per hour of 1080p video. Find a way to make the copy much faster and set a target the owner approves.

## How we got here

Owner ruling 2026-11-18: Q5 rejected, optimize the wait before shipping. The design had deferred live updates and faster encoding as follow-ups; they now come first. See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

Prototype and measure, on the T17520 files: (1) split the video into segments and encode them in parallel Modal containers, then join; (2) GPU encoding (NVDEC/NVENC with HDR tone mapping; check Modal video driver support); (3) convert the parts that have already arrived while the upload is still going (ties into T8865 and the multipart parts); (4) a live update when the copy is ready instead of a Check again button. Report wait from upload end to playable copy for each, its cost and its complexity, and recommend one with a target wait.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: Measured wait and cost for at least the parallel-segment and GPU approaches on a 1080p and a 4K file.
- [ ] C2: A verdict on converting during upload, with what it needs from the upload path.
- [ ] C3: A recommended approach and a target wait (for example, playable within N minutes of upload end for an hour of 1080p), written into the design doc for owner approval.
- [ ] C4: Joined segments play without visible seams and keep frame timing (checked with the T17530 method).
