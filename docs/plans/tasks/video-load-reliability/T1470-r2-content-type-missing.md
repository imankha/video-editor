# T1470: R2 objects missing Content-Type → browser rejects playback

## Problem

Some/all existing videos under `games/*.mp4` in R2 return no `Content-Type` header
on GET. The `<video>` element rejects these with "Video format not supported",
surfaced to the user as **"Video failed to load"**.

Observed on game 1's video via direct R2 HEAD:

```
Content-Range: bytes 0-1023/3141433333
ETag: "add8292769913626e493f94939c13d49-30"   ← multipart ETag
x-amz-mp-parts-count: 30                       ← uploaded via multipart
(no Content-Type header)
```

## Root cause

Uploads go through R2 multipart (`r2_create_multipart_upload` →
`UploadPart` × N → `CompleteMultipartUpload`) from
[src/backend/app/routers/games_upload.py:200](../../../src/backend/app/routers/games_upload.py#L200).

Current code at [src/backend/app/storage.py:1297](../../../src/backend/app/storage.py#L1297)
**does** default `ContentType="video/mp4"` on `create_multipart_upload`, so
new uploads on current code should be fine. BUT:

1. Existing objects (uploaded before that default landed, or via a prior code
   path) do not have Content-Type persisted → migration required.
2. Needs verification that the current default is actually sticking through
   `CompleteMultipartUpload` on R2 (S3 persists it on `Create`; R2 has been
   observed to occasionally drop headers — investigate before assuming parity).

## Fix

### Code (verification + belt-and-braces)

1. Confirm `r2_create_multipart_upload` is always called with
   `content_type="video/mp4"` (it is, via default — add an explicit pass at
   the call site in `games_upload.py:200` for clarity).
2. Upload a fresh test file via the current multipart path, then HEAD the R2
   object. If Content-Type is present → code is fine, proceed to migration.
   If not → pass `ContentType` explicitly in `complete_multipart_upload` /
   investigate R2 multipart semantics.

### Migration (retroactive stamp)

New script: `scripts/migrate_r2_content_type.py`

For each env (dev, staging, prod):

1. List all objects under `games/` prefix via `list_objects_v2` paginator.
2. For each `*.mp4` object whose HEAD returns no `Content-Type` (or
   `application/octet-stream`), issue:

   ```python
   s3.copy_object(
       Bucket=R2_BUCKET,
       Key=key,
       CopySource={"Bucket": R2_BUCKET, "Key": key},
       MetadataDirective="REPLACE",
       ContentType="video/mp4",
       # Preserve any existing user metadata we care about
   )
   ```

3. Log before/after counts; idempotent (re-runnable).
4. Dry-run flag; `--env dev|staging|prod` gate; confirmation prompt for prod.

Note: `CopyObject` on R2 rewrites metadata **without** rewriting bytes for
objects under 5 GiB. For the 3+ GiB multipart objects we have, this is still
cheap (no egress). If any object is ≥ 5 GiB, fall back to
`UploadPartCopy` multipart copy — add only if the scan finds one.

## Acceptance criteria

- [ ] Fresh upload via current multipart path → R2 HEAD returns
      `Content-Type: video/mp4`.
- [ ] Migration script dry-run prints list of objects missing Content-Type.
- [ ] Migration run on dev: all `games/*.mp4` objects have
      `Content-Type: video/mp4` afterward.
- [ ] Migration run on staging + prod (with user approval).
- [ ] Game 1 (previously failing with "Video failed to load") plays in
      Framing without error.

## Test plan

1. `pytest` on any new helper (migration script should be thin enough to
   skip unit tests; manual run on dev is the validation).
2. Manual: hit Framing for a previously-broken game → video loads.
3. `curl -sI <presigned>` → confirm `Content-Type: video/mp4`.

## Impact / complexity

- **Impact:** Unblocks playback for all pre-fix games. High (without this,
  affected users see total failure on the video editor).
- **Complexity:** Low. ~50 LOC migration script + optional one-line code
  change. No schema or API changes.

## Files

- `src/backend/app/routers/games_upload.py` (verify/explicit ContentType)
- `scripts/migrate_r2_content_type.py` (new)

## Related

- Discovered while debugging "Video failed to load" on game 1 for
  imankh@gmail.com (dev).
- Sibling to T1450 (faststart migration) — same pattern: retroactive R2
  metadata/bytes fix after a codebase change.
