# T7020: Remux uploaded game videos with faststart (moov at front)

**Status:** TODO — deliberately deferred, sequenced first after T5140 (see Progress Log)
**Impact:** 6
**Complexity:** 4
**Created:** 2026-08-14
**Updated:** 2026-08-14

## Problem

Uploaded game videos are stored exactly as the source device wrote them — no remux step exists
in `games_upload.py::finalize_upload`. Consumer devices frequently write the `moov` atom (the
index a player needs before it can seek anywhere) at the **end** of the file rather than the
front, since that's cheaper for the device to write during recording.

Found 2026-08-14 while investigating a user report that T6820's Not-Started-draft hover preview
took ~4s. Traced the actual R2 request sequence for one hover (backend log,
`app.routers.clips [clip-stream]` lines) against a real ~3GB source game video:

```
window=moov      range=0-10485759            -> FAILS to find a complete moov here
window=moov_tail range=3050340352-3051071722 -> falls back toward the end of the file
window=moov_tail range=3051061248-3051071722 -> refines further
window=moov      range=131072-10485759       -> re-fetches the front now that moov is located
window=clip      range=2018312192-2037246187 -> FINALLY the actual clip data
```

5 sequential round trips (~250-400ms of R2 latency each) before any clip content streams — all
because `moov` isn't at the front. This isn't specific to hover previews: it's the SAME cost
paid by Annotate scrubbing, the bounded clip-stream proxy, and anywhere else the app seeks into
a raw game video (`clips.py::stream_working_clip_bounded`, T1430/T1440's three-window strategy).

**Not a new artificial delay** — T6820's reveal-delay policy (2026-08-14) already waits exactly
as long as real content takes and no longer, confirmed by the user. This task is about making
the *real* latency shorter, not about padding removal (already done).

## Solution

Add a remux pass to `finalize_upload` (or wherever the upload pipeline's last write-time step
lives) that runs `ffmpeg -i <source> -c copy -movflags +faststart <output>` — a **lossless,
copy-only remux** (no re-encoding, no quality loss, no dimension/bitrate change), just moves the
`moov` atom to the front. This is the exact same flag already used elsewhere in this codebase
for output/export paths (`ai_upscaler/video_encoder.py:785`, `modal_functions/video_processing.py`
multiple sites) — reuse the pattern, don't invent a new one.

**Scope decisions to make explicit:**
- **New uploads only, no backfill.** Remuxing every existing game video in R2 is a large,
  separate migration-shaped effort with its own risk profile; this task should NOT attempt it.
  Existing videos keep today's latency until they're naturally superseded or a backfill task is
  filed separately.
- **Where does the remux run? DECIDED: Modal-dispatch, not inline.** A synchronous inline
  version was prototyped and measured — see Progress Log — and rejected because it added
  65-78s to `finalize_upload` (matching the original upload time) by round-tripping the file
  through R2 twice more. `finalize_upload` must instead fire-and-forget dispatch to a Modal
  function, mirroring T4945's `stitch_members` pattern (a durable job independent of the Fly
  machine's lifecycle, sidesteps the T1537 fire-and-forget constraint) — full comparison +
  sequence diagrams in the [design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c),
  Option A. The moov-probe + fail-open remux logic itself (`game_remux.py`, embedded in
  "Preserved Implementation" below) is dispatch-agnostic and moves into `modal_functions/`
  largely unchanged — only its caller changes. **No "remux pending" state is needed**: because
  the remux is fail-open and always replaces the SAME `r2_key` in place, a hover/scrub that
  lands before the async remux completes just reads the still-moov-at-end original (today's
  behavior, not a regression) and a later request after completion transparently gets the fast
  path — no state machine, no client-visible pending status.
- **Multi-video games** (T1440's video_sequence): each video file in the sequence needs its own
  remux pass independently.
- **Failure handling**: if the remux fails for any reason, the ORIGINAL upload must still
  succeed and be usable (no-silent-fallback rule — log loudly, keep the un-remuxed file, don't
  block the user's upload on this optimization).

## Context

### Relevant Files
- `src/backend/app/routers/games_upload.py:264` — `finalize_upload`, where the remux step would
  be added
- `src/backend/app/routers/clips.py` — `stream_working_clip_bounded` (T1430/T1440), the bounded
  clip-window proxy that pays this cost on every seek; reference only, not modified by this task
- `src/backend/app/ai_upscaler/video_encoder.py:785` — existing `+faststart` usage to mirror
- `src/backend/app/modal_functions/video_processing.py:406,556` — existing `+faststart` usage to
  mirror (also shows the established ffmpeg-args style for this codebase)

### Related Tasks
- Follows: T6820 (hover preview for Not Started drafts) — found this during that task's
  post-merge investigation; T6820 itself needs no changes, this is a genuinely separate
  ingest-side improvement
- Also benefits: Annotate scrubbing, any future feature that seeks into a raw game video

### Technical Notes
- Confirm with a real measurement whether `-c copy -movflags +faststart` on a multi-GB file is
  fast enough to run synchronously in `finalize_upload` before committing to the inline approach
  — don't assume, measure on a real large source file first.
- `blake3_hash` (used for dedup/change-detection elsewhere, e.g. `games.blake3_hash`) will
  change after a remux even though the content is perceptually identical (byte layout changes)
  — check whether anything relies on hash stability across this operation before shipping.

## Progress Log

**2026-08-15**: Implemented as a synchronous, inline remux — works, CI green, and a real
reliability bug found live-testing it (a transient R2 502 during the re-upload step was
silently not retried; `is_transient_error` didn't recognize boto3's `S3UploadFailedError`
wrapper) is fixed and regression-tested. Branch: `feature/T7020-game-video-faststart-remux`,
commit `7f2aeb4e`, **kept on origin, not merged**.

Measured end-to-end on a 278MB test upload: the synchronous remux adds 65-78s to
`finalize_upload`'s response — roughly as much as the 58.5s original upload itself — because it
round-trips the file through R2 twice more (download + re-upload; `ffmpeg` itself is
negligible, ~1440MB/s). User does not want ANY upload-time increase, ever.

Presented a design note comparing the current synchronous approach against dispatching the
remux to Modal (mirrors T4945's `stitch_members` — a durable job independent of the Fly
machine's lifecycle, sidesteps the T1537 fire-and-forget constraint) — full comparison +
sequence diagrams: [design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c).
User decision: **prefers the Modal-dispatch redesign.** Response would stay near-instant
(~1-2s, matching pre-this-task finalize time) regardless of upload size — satisfies the
zero-upload-time-cost bar the synchronous version can't.

**Not merging the synchronous branch.** Held for more thorough testing and the Modal-dispatch
rework; resequenced to be the FIRST task picked up after T5140 (the tutorial reshoot) rather
than left in the general backlog. When resumed: keep the retry-classifier fix and the
correctness logic (moov-position probe, fail-open semantics) from the current branch, replace
the synchronous `remux_game_faststart()` call in `finalize_upload` with a fire-and-forget
Modal dispatch per the design note's Option A.

**2026-08-14 (later): branch deleted, logic folded in below.** Rather than keeping
`feature/T7020-game-video-faststart-remux` (commit `7f2aeb4e`) parked on origin indefinitely,
the reusable pieces are embedded verbatim in "Preserved Implementation" below so this task file
is self-sufficient when picked back up — no branch checkout needed. The only piece that does
NOT carry forward as-is is the `finalize_upload` integration point itself (the synchronous
`remux_game_faststart(r2_key)` call) — that's exactly what the Modal-dispatch redesign replaces;
see Option A in the [design artifact](https://claude.ai/code/artifact/27a9f3e5-38fb-44bd-8dcb-50655873f81c)
for the fire-and-forget dispatch shape to build instead.

## Preserved Implementation (from the parked branch, pre-Modal-redesign)

Three pieces below survive the redesign untouched — only the caller changes (sync call ->
Modal dispatch). Diffs are against master as of commit `7f2aeb4e`.

### 1. Retry-classifier fix (`src/backend/app/utils/retry.py`) — ALREADY ON MASTER

**Landed independently 2026-08-15, do not reimplement.** General-purpose fix, not specific to
this task — `is_transient_error` didn't recognize boto3's `S3UploadFailedError`/
`S3TransferFailedError` wrapper (used by `client.upload_file`'s multipart transfer manager)
around a transient status code, so a 502/503 mid-multipart-upload was silently classified as
non-retryable anywhere in the codebase using that call path, not just this remux. Cherry-picked
onto master ahead of the rest of T7020 since it's a correctness fix with no dependency on the
remux feature.

```python
# after the existing ClientError status_code in (403, 404) check:
if error_type in ("S3UploadFailedError", "S3TransferFailedError"):
    match = re.search(r"an error occurred \((\d+)\)", error_msg)
    if match and int(match.group(1)) in (429, 500, 502, 503):
        return True
    if match and int(match.group(1)) in (403, 404):
        return False
```
(needs `import re` added to the file's imports)

Regression tests to restore in `test_retry.py`: `test_s3_upload_failed_error_502_is_transient`,
`test_s3_upload_failed_error_403_is_not_transient`,
`test_s3_upload_failed_error_unparseable_message_is_not_transient` — construct a dynamic
`S3UploadFailedError` exception type with a boto3-formatted message
(`"...An error occurred (502) when calling the UploadPart operation..."`) and assert the
classification.

### 2. Storage helpers (`src/backend/app/storage.py`)

- Refactor `_probe_local_mp4_moov` to extract a shared `_probe_mp4_moov_bytes(buf: bytes)`
  helper (walks top-level MP4 boxes to find `moov`/`mdat`/`moof`, returns `(verdict, boxes)`
  where verdict is `FASTSTART`/`MOOV-AT-END`/`UNKNOWN`) — both the pre-upload check and the
  remux skip-decision need this logic and it shouldn't be duplicated (it previously was,
  inline, in `upload_bytes_to_r2`).
- Add `upload_file_to_r2_global(key, local_path, *, content_type="video/mp4") -> bool`: streams
  a local file to a full (env-prefixed) R2 key via boto3's managed multipart transfer (so
  multi-GB files never load into memory), using the existing `TIER_1` retry tier. Never raises;
  logs and returns `False` on failure. This is the re-upload half of the remux (download via
  existing `download_from_r2_global`, remux locally, re-upload via this new helper).

### 3. `src/backend/app/services/game_remux.py` (new module, in full)

The moov-probe + fail-open remux logic — this is the actual optimization and doesn't change
under the Modal redesign, only who calls it:

```python
"""
Game video faststart remux (T7020).

Consumer devices (phones, action cams) frequently write the MP4 `moov` atom —
the index a player needs before it can seek — at the END of the file, because
that's cheaper to write while recording. A player/seek then pays several extra
R2 round trips locating `moov` near EOF before any content streams (documented
5-request sequence in the T7020 task file). This module runs a lossless,
copy-only remux (`ffmpeg -c copy -movflags +faststart`) that moves `moov` to the
front — no re-encode, no quality/dimension/bitrate change, just a byte-layout
change — so every seek into a newly-uploaded game starts fast.

It NEVER raises: a remux failure must fail open — the original upload stays in
R2 and remains fully usable (CLAUDE.md no-silent-fallback: the failure is
logged loudly, never swallowed silently).

FINDING (T7020): the R2 key is `games/{blake3_hash}.mp4` where `blake3_hash` is
the client-computed hash of the ORIGINAL uploaded bytes. The remux changes the
stored bytes, so they no longer hash to the key. This is SAFE: the hash is the
identity of the source video (used for dedup) and the server NEVER re-hashes
the stored object to verify it. Nothing depends on hash-stability of the
stored bytes across this operation.
"""

import logging
import tempfile
from pathlib import Path

from app.services.ffmpeg_errors import run_ffmpeg
from app.storage import (
    _probe_local_mp4_moov,
    download_from_r2_global,
    upload_file_to_r2_global,
)

logger = logging.getLogger(__name__)

_REMUX_TIMEOUT_S = 30 * 60


def remux_game_faststart(r2_key: str) -> bool:
    """Download the game video at `r2_key`, remux it with `+faststart`, and
    overwrite the object in place. Skips files whose `moov` is already at the
    front. Returns True if the stored object is now faststart because of this
    call, False if it was skipped or the remux failed (fail-open). Never raises.
    """
    try:
        with tempfile.TemporaryDirectory(prefix="game_remux_") as tmp:
            src = Path(tmp) / "src.mp4"
            dst = Path(tmp) / "faststart.mp4"

            if not download_from_r2_global(r2_key, src):
                logger.error(f"[GameRemux] download failed for {r2_key} — skipping")
                return False

            verdict, boxes = _probe_local_mp4_moov(src)
            head = " ".join(boxes[:4]) if boxes else "-"
            if verdict == "FASTSTART":
                logger.info(f"[GameRemux] {r2_key} already faststart — skipping")
                return False

            logger.info(f"[GameRemux] remuxing {r2_key} verdict={verdict} head=[{head}]")

            run_ffmpeg(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
                 "-c", "copy", "-movflags", "+faststart", str(dst)],
                timeout=_REMUX_TIMEOUT_S,
            )

            if not dst.exists() or dst.stat().st_size == 0:
                logger.error(f"[GameRemux] ffmpeg produced no output for {r2_key} — skipping")
                return False

            out_verdict, out_boxes = _probe_local_mp4_moov(dst)
            if out_verdict != "FASTSTART":
                logger.error(
                    f"[GameRemux] remuxed output for {r2_key} is not faststart "
                    f"(verdict={out_verdict}) — NOT overwriting"
                )
                return False

            if not upload_file_to_r2_global(r2_key, dst):
                logger.error(f"[GameRemux] re-upload failed for {r2_key} — skipping")
                return False

            logger.info(
                f"[GameRemux] {r2_key} remuxed to faststart "
                f"({src.stat().st_size} -> {dst.stat().st_size} bytes)"
            )
            return True
    except Exception as e:
        logger.error(
            f"[GameRemux] unexpected failure remuxing {r2_key}: "
            f"{type(e).__name__}: {e}", exc_info=True,
        )
        return False
```

**What changes under the Modal redesign:** only the caller in `finalize_upload`
(`games_upload.py`) — replace the direct `remux_game_faststart(r2_key)` call with a
fire-and-forget dispatch to a Modal function (mirror T4945's `stitch_members` pattern: durable,
independent of the Fly machine's lifecycle, sidesteps the T1537 fire-and-forget constraint).
The function body above can likely move into `modal_functions/` largely unchanged — `ffmpeg`,
the moov probe, and the fail-open semantics are the same regardless of where it executes.

## Acceptance Criteria
- [ ] `finalize_upload`'s response time stays near-instant (~1-2s, matching pre-T7020 finalize
      time) regardless of upload file size — measured on a multi-GB upload. This is the entire
      reason the Modal-dispatch design was chosen over the synchronous prototype (which measured
      65-78s added on a 278MB file); a fix that reintroduces upload-time cost does not satisfy
      this task, however cleanly it reuses the remux logic below.
- [ ] Remux is dispatched to Modal (fire-and-forget, mirrors T4945's `stitch_members`), not run
      inline in the request path
- [ ] New game video uploads get a lossless faststart remux before being marked ready
- [ ] Multi-video games: every video in the sequence is remuxed independently
- [ ] Remux failure never blocks or corrupts the underlying upload (fails open to the original)
- [ ] Measured: a hover-preview / clip-stream seek into a NEWLY uploaded game needs
      meaningfully fewer round trips than the 5-request sequence documented above (ideally 1-2)
- [ ] No backfill of existing videos — explicitly out of scope for this task
- [ ] Tests pass
