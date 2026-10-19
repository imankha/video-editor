# T13230: Add Clip: import Veo highlights as clips (no game)

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Tier:** M (frontend, ~4 files, no schema; reuses T8370's batch upload unchanged)
**Created:** 2026-10-18
**Updated:** 2026-10-18
**Epic:** [Veo Highlights Import](EPIC.md) (Path B). Depends on T13200; its "link to game" option depends on T13150.

## Problem

A parent with only the Veo zip (no full game) cannot use it: Add Clip rejects a zip, and unzipping
by hand gives 40 drafts named `06 001444_-_Goal.mp4` with no tags.

## Solution

1. Add Clip (`ProjectManager.jsx` Clips tab entry, `useClipUpload.js`) accepts `.zip`; a Veo zip opens
   a **pick list** (EPIC.md Path B): merged moments with label, `mm:ss`, duration, lazy poster, label
   filter chips, Select all. Default selection per V2 (recommended: nothing selected). A non-Veo zip
   gets a visible "Only Veo highlights zips are supported" message.
2. Upload selected moments: for each, `extractEntry` the moment's primary entry (one at a time) ->
   the existing per-file `ensureVideoInR2(kind='clip')` -> one `uploadClipsBatch` with
   `name="{Label} {mm:ss}"`, `tags` per V3, `notes="Veo: {labels}"`, rating per V3.
3. **Faststart:** 35 of 41 measured entries are moov-at-end. Verify whether the clip path already
   faststarts (it does for games via `_hashAndAnalyze`); if not, faststart client-side before hashing
   (reuse the game path's code; do not write a second implementation).
4. Optional "These are from game ..." picker after upload, linking every created clip via the T10300
   link gesture (hidden until T13150 is fixed).
5. Loose Veo mp4s picked directly get the same naming/tagging without the pick list.
6. Respect the existing caps, size-limit modal (T10250) and completion behavior (T10260).

## Acceptance

1. e2e (real R2 on dev): pick 3 moments from a small synthetic Veo zip -> 3 drafts named
   "Goal 14:44" etc., Goal tag set, one credit charged, each plays in Focus.
2. A moov-at-end entry plays (streams) in Focus without a full download.
3. Exact duplicate and folded-overlap entries upload once.
4. No request to any non-ReelBallers host besides R2 presigned PUTs (T2680 rule).

## Knowledge docs
`.claude/knowledge/backend-services.md` (Pre-cut clip upload T8370), `.claude/knowledge/annotate.md` (T10300, upload intake).
