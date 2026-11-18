# T17520: Prototype: measure copy cost and time

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

Measure what making an H.264 copy really costs and how long it takes, on real iPhone files, before anything is built.

## How we got here

The design's numbers are modeled, not measured (risk R1, assumptions A1 to A4). Modal's CPU price is from memory (A1). See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

A throwaway Modal function (not wired into the app) that takes a presigned URL and writes a copy, run on real iPhone files: 1080p30, 1080p60, 4K30 and 4K60, HDR on. Record frames per second, wall time, billed cost, copy size and disk needed (R7). Confirm Modal's ffmpeg decodes HEVC Main10 and has zscale and tonemap (F3). Confirm the current Modal CPU price on modal.com.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: A results table (resolution, fps, wall time, billed cost, copy size, peak disk) for at least four real iPhone files, in the task notes and the design doc.
- [ ] C2: F3 verified or refuted, with the ffmpeg build info.
- [ ] C3: Current Modal CPU price recorded with its source and date.
- [ ] C4: The prototype code is not imported by the app and lives under scripts/ only, or is deleted.
