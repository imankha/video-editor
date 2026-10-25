# T13200: Veo zip reader + manifest parser (client library)

**Status:** WIP
**Impact:** 6
**Complexity:** 3
**Tier:** M (frontend only, new pure module + Web Worker, ~3 files, one new dependency)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Veo Highlights Import](EPIC.md) (read its "The format" table first)

## Problem

Both import paths need the same thing: turn a user-picked Veo highlights zip (or its loose mp4s)
into a list of moments `{stamp_s, duration_s, labels[], entries[]}` without uploading it.

## Solution

A pure module `src/frontend/src/utils/veoHighlights/` (no React, no store), plus a worker:

1. **Reader** over a `File`, using a maintained zip library (fflate `Unzip` streaming or
   `@zip.js/zip.js`; pick one, justify, pin an exact version). Reads the central directory via
   `Blob.slice` (ZIP64 supported). Returns entries `{name, crc32, size, compressedSize}`.
2. **Detector:** `isVeoHighlightsZip(entries)`: `.veo-zip` present OR >= 80% of mp4 entries match
   `^(\d+) (\d{2})(\d{2})(\d{2})_-_(.+)\.mp4$`.
3. **Parser:** index, `stamp_s = h*3600+m*60+s`, label = tag with `_` -> space. Strict: a non-matching
   mp4 entry is reported back (visible "N files skipped"), never guessed.
4. **Durations (Web Worker):** walk the MP4 boxes of each entry's inflated stream; for faststart
   entries stop after `moov`; for moov-at-end entries stream-inflate the whole entry, retaining only
   bytes after the last `mdat` boundary, and read `mvhd`. Progress callback per entry. No fixed-length
   assumption (lengths vary 9 to 25 s).
5. **Merge:** exact duplicates (same CRC + size) collapse, labels unioned; then sort by stamp and fold
   moments overlapping by more than half the shorter one into one moment spanning the union. Label
   priority Goal > Shot on goal > Attack > Highlight > other (first = display label). Each moment
   keeps its entries, with the highest-priority entry marked as the one Path B would upload.
6. **Loose files:** the same parser accepts a `File[]` of mp4s whose names match the pattern.
7. `extractEntry(entry) -> File` (streaming inflate into a Blob) for Path B.

## Fixtures

Commit **filename + CRC + size + duration manifests** (JSON, no media) for the 7 surveyed zips
(EPIC.md "Survey of 7 real zips"): the Rebels zip in `formal annotations/u14 phillips/` and the six
`Veo highlights *.zip` files the user put in `C:/Users/imank/Downloads` on 2026-10-18 (SD Surf, Beach FC,
Scrimmage 10_4_25, Legends 1st Half, Legends 2nd Half, LA Breakers). Generate them with a script that
reads the zips in place; never commit media. Synthetic tiny zips (a few KB of
real mp4 boxes) for the reader/worker tests, including one moov-at-end and one ZIP64 entry.

## Acceptance

1. Rebels manifest: 41 parsed, 1 skipped (`.veo-zip`), 40 after exact dedupe, **35 moments** after
   folding; the four folded groups are the four goals at 883, 1631, 4827 and 4966 s, each labeled Goal first.
2. Durations from the worker equal ffprobe's within 0.05 s for a faststart and a moov-at-end fixture.
3. A non-Veo zip returns `isVeoHighlightsZip=false`; a malformed name is reported as skipped.
4. Every surveyed manifest parses with zero skips and reproduces the EPIC survey table's dedupe/fold
   counts (e.g. SD Surf 88 -> 87 -> 73). Unknown labels (e.g. "Defence") pass through verbatim.
5. `halfMarker(zipName)` returns 1/2/null for `(1st Half)`/`(2nd Half)`/none (for V6 preselection).

## Knowledge docs
`.claude/knowledge/annotate.md` (upload intake section for existing file-handling utilities).
