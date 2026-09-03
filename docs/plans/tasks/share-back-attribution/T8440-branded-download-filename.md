# T8440: Brand the download filename

**Status:** TODO
**Impact:** 2
**Complexity:** 1
**Created:** 2026-09-03

## Problem

`generate_download_filename` (`src/backend/app/routers/downloads.py:645`, the single source
of truth for final-video filenames per its own docstring) produces plain
`{ProjectName}_final.mp4`. The ffmpeg container metadata already carries "Made with
ReelBallers" (visible in Finder/QuickTime "Get Info", Plex, etc. — see
`src/backend/app/services/download_metadata.py`), but the filename itself, the thing a
recipient actually sees in a Downloads folder or when re-sharing the file, carries no brand
signal at all.

## Solution

Add a brand suffix to the generated filename, e.g. `{ProjectName}_ReelBallers.mp4` (replacing
or appending to the current `_final` suffix — pick whichever reads better; either
`{ProjectName}_ReelBallers.mp4` or `{ProjectName}_final_ReelBallers.mp4` is acceptable,
final call is a naming judgment, not a functional one). Zero cost to the recipient, in
keeping with the CapCut-lesson framing from T7690: attribution that never gets in anyone's
way.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/downloads.py:645` — `generate_download_filename`, the single
  source of truth (also called from `shares.py:970` for shared-download filenames — that
  call site needs no separate change, it already goes through this function)

### Related Tasks
- See [EPIC.md](EPIC.md) for the full decision record and shared context.
- Independent of every other task in this epic — no file overlap.

### Technical Notes
- No schema change, no migration. Pure string-generation change in one function.
- Check existing tests referencing this function's exact output string (grep
  `generate_download_filename` in `src/backend/tests/`) and update their expected filenames
  to match — don't let this be a silent test-break.

## Implementation

### Steps
1. [ ] Update `generate_download_filename` to append the brand suffix
2. [ ] Update any tests asserting the exact filename string

## Acceptance Criteria

- [ ] Downloaded files (both direct downloads and shared-link downloads, since both route
      through `generate_download_filename`) carry the brand suffix in their filename
- [ ] Existing filename-sanitization behavior (special-character stripping, space handling)
      is unchanged
