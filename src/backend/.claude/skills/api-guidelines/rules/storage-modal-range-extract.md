# storage-modal-range-extract

**Priority:** CRITICAL
**Category:** Storage Patterns

## Rule

**Never download full source videos on Modal or in local GPU substitutes.** For any FFmpeg or OpenCV operation that only needs a sub-range of a source video, generate a presigned URL and extract only the required range with FFmpeg using pre-input `-ss`/`-to` and stream copy. Operate on the local scratch file from that point on.

## Rationale

Game videos are 1–4 GB. Downloading the full file to pull a 10-second clip wastes minutes of job time and gigabytes of egress. Presigned URL + HTTP Range extraction transfers only the bytes inside the requested range.

Two patterns were considered; only pattern #1 is safe:

1. **Scratch-extract (USE THIS):** FFmpeg CLI with `-ss url -to -c copy scratch.mp4`, then decode/process `scratch.mp4` locally.
2. **Direct URL decode (DO NOT USE):** `cv2.VideoCapture(presigned_url)` — sequential reads work, but `cap.set(CAP_PROP_POS_FRAMES, ...)` hangs 30+ seconds per seek and triggers HTTP timeouts. One stray seek in code we don't control breaks the job. Verified on Modal's `upscale_image` with a 3.46 GB game video — see T1220 tracer results.

Pattern #1 also works identically in Modal and in local GPU substitutes, so the code path is the same everywhere.

## Incorrect Example

```python
# BAD: downloads the full 3 GB game video to extract one 10s clip
r2 = get_r2_client()
input_path = os.path.join(temp_dir, "input.mp4")
r2.download_file(bucket, f"{user_id}/{input_key}", input_path)

subprocess.run([
    "ffmpeg", "-i", input_path, "-ss", "60", "-to", "70",
    "-c", "copy", output_path,
])
```

**Why this is wrong:**
- Full 3 GB transfer for a clip that needs 18 MB
- Post-input `-ss` forces FFmpeg to decode from start before seeking (even worse with re-encode)
- Modal jobs start minutes later than necessary
- Requires R2 credentials on Modal — blocks credential removal

## Correct Example

```python
from app.storage import generate_presigned_url_global, generate_presigned_url

# Global (games/...) OR user-scoped — pick based on the key prefix
if input_key.startswith("games/"):
    source_url = generate_presigned_url_global(input_key)
else:
    source_url = generate_presigned_url(user_id, input_key)

scratch_path = os.path.join(temp_dir, "input.mp4")

# Pre-input -ss/-to with stream copy: HTTP Range under the hood,
# transfers only the requested slice. Runs in ~1-2s regardless of source size.
subprocess.run([
    "ffmpeg", "-y",
    "-ss", str(source_start),   # BEFORE -i is critical
    "-to", str(source_end),
    "-i", source_url,
    "-c", "copy",
    scratch_path,
], check=True)

# All downstream work (FFmpeg filters, OpenCV decode, AI upscaling) runs on
# the local scratch file — fast seeks, no HTTP surprises.
```

## Additional Context

### Pre-input vs post-input `-ss`

```
ffmpeg -ss 60 -to 70 -i url -c copy out.mp4   # GOOD — seek before decode, Range request
ffmpeg -i url -ss 60 -to 70 -c copy out.mp4   # BAD  — downloads full file, then seeks
```

Pre-input seek is mandatory. Post-input seek defeats the purpose.

### Multi-clip loops

Generate a **fresh presigned URL inside the loop** for each clip. Presigned URLs are signed locally (no network call), so regeneration is free, and it eliminates the 30-min / 4-hour expiry class of bugs for long-running jobs.

```python
for clip in clips_data:
    source_url = generate_presigned_url_global(clip["input_key"])  # per-iteration
    subprocess.run(["ffmpeg", "-y", "-ss", clip["start"], "-to", clip["end"],
                    "-i", source_url, "-c", "copy", scratch_path], check=True)
    # ... process scratch_path ...
```

### Audio

Stream copy (`-c copy`) preserves audio without re-encoding. Pre-input seek aligns to the nearest keyframe, and MP4 audio is indexed against video keyframes — audio pre-roll is preserved. No separate audio extraction step needed for the scratch file.

### When to use this pattern

- All Modal GPU functions in `app/modal_functions/`
- Local GPU substitutes in `app/services/local_processors.py`
- Any endpoint that needs a sub-range of an R2 video

### When NOT to use this pattern

- When the caller genuinely needs the entire source file (rare — verify before deciding).
- When the source is already a small pre-extracted clip (user-uploaded clips < 100 MB): full download is fine there. Check for `input_key.startswith("games/")` to distinguish games (large) from user clips (small).

### Helpers

- `generate_presigned_url_global(key, expires_in=14400)` — for `games/...` keys (default 4h expiry).
- `generate_presigned_url(user_id, relative_path, expires_in=3600)` — for user-scoped keys.

Both are in [app/storage.py](../../../app/storage.py).
