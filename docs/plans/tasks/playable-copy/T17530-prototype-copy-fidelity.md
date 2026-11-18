# T17530: Prototype: prove the copy lines up with the original

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

Prove that a copy plays frame for frame and pixel for pixel in the same place as the original, so marked plays and crop boxes stay where the parent put them.

## How we got here

Design facts and risks: F2 (crop keyframes are in source pixels), R2 (timing drift from edit lists, variable frame rate, non-zero start), R3 (portrait rotation). See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

Using the T17520 prototype, convert real iPhone files that have rotation metadata, variable frame rate and an edit list. Compare the copy to the original: displayed width and height, frame count, duration, and frames at fixed timestamps. Then mark a play and set a crop on the original in the app, and check the same play and crop on the copy.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: For each test file, displayed size, frame count and duration match; frames at three timestamps match (SSIM at least 0.9 after the same tone mapping), recorded in the task notes.
- [ ] C2: A rotated portrait file and a variable-frame-rate file are included.
- [ ] C3: A play's start and end and a crop box land in the same place on copy and original, with screenshots.
- [ ] C4: Any mismatch is written up with the ffmpeg flags that fix it, or as a refuted assumption.
