# T17550: Prototype: check browser decoders and colors

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-18
**Updated:** 2026-11-18

## In plain words

Check the remaining facts the design rests on: which browsers really cannot show iPhone video, whether our test browser reproduces it, whether exports of HDR iPhone video already look right, and whether a 4K copy plays smoothly on a modest laptop.

## How we got here

Design facts F1, F4, F5 and risks R4 (preview SDR vs export colors), R8 (4K H.264 on weak laptops). See [EPIC.md](EPIC.md) for the owner ruling of 2026-11-18 and the order. Design: [T17390-design.md](../T17390-design.md).

## Solution

On real machines and the /dotask container: test HEVC 8-bit and 10-bit playback and WebCodecs decode in Windows Chrome and Edge with and without hardware HEVC, Firefox, Safari, and the container's Playwright Chromium. Export one highlight from an HDR iPhone game uploaded in Safari and compare its colors with the editor preview. Play a 4K H.264 copy on a modest laptop.

## Relevant Files

See the design doc's section for this phase and `.claude/knowledge/modal-gpu.md`, `.claude/knowledge/export-pipeline.md`.

## Acceptance Criteria

- [ ] C1: A browser table (browser, OS, hardware, HEVC 8-bit, HEVC 10-bit, WebCodecs) with how each was checked.
- [ ] C2: F5 answered: does the container Chromium reproduce sound-only.
- [ ] C3: F4 and R4 answered with side-by-side screenshots of preview and export.
- [ ] C4: R8 answered: dropped frames for a 4K H.264 copy on a named modest laptop.
