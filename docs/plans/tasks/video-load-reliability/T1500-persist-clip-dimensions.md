# T1500: Persist clip dimensions, eliminate metadata probe

**Status:** TODO
**Type:** Performance / Architecture
**Follow-up to:** T1490 (first-request 401 fix)

## Motivation

Every project load calls `extractVideoMetadataFromUrl()` once per unique clip URL to pull `width`, `height`, `duration`, and `fps` off an HTML5 `<video preload="metadata">` probe. These values are already known server-side during extraction but are not persisted or returned.

T1490 fixes the 401 that the probe triggers, but the probe itself remains — N clips = N media requests at project load. Persisting the fields on the clip record eliminates the probe entirely for populated rows and removes the detached-`<video>` pattern long-term.

## Scope

1. **Schema** — add `width INT, height INT, fps REAL` (nullable) to `working_clips`.
2. **Extraction pipeline** — wherever clips are created (Modal job / `clip_extraction.py`), capture `ffprobe` output and write the three fields. New clips self-populate.
3. **Backfill** — one-time script that walks existing `working_clips`, pulls the R2 object (HEAD or byte-range moov fetch), runs `ffprobe`, writes the fields.
4. **API** — include the fields in `WorkingClipResponse` ([clips.py:155](../../../src/backend/app/routers/clips.py#L155)).
5. **Frontend** — in [useProjectLoader.js:149-156](../../../src/frontend/src/hooks/useProjectLoader.js#L149), skip `extractVideoMetadataFromUrl` when `clip.width && clip.height && clip.fps`. Fall back to probe (now auth-safe from T1490) only for rows missing fields.

## Acceptance

- New clips have `width`, `height`, `fps` populated on insert.
- Existing clips backfilled (script logs every row updated; zero rows left with `NULL` dimensions after run).
- Project load issues zero `/stream` requests from metadata probes for populated clips.
- Crop defaults in [useClipManager.js:44-46](../../../src/frontend/src/hooks/useClipManager.js#L44) read from clip fields, not probe output.

## Risks

- R2 backfill cost: one `ffprobe` invocation per existing clip. For 10Ks of clips, run as a batched Modal job.
- Probe fallback must remain working for rows that fail backfill (corrupted R2 object, etc.) — do not delete `extractVideoMetadataFromUrl` in this task.

## Out of scope

- The 401 auth fix (T1490).
- Deleting `extractVideoMetadataFromUrl` — keep as fallback.
