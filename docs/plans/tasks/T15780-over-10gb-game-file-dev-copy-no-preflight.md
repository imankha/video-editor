# T15780: A game file over 10 GB is refused with developer copy and no path forward; a prepare 500 row carries no cause

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-11-09
**Updated:** 2026-11-09
**Milestone:** Production incident 2026-11-04 (bugs first), see PLAN.md

## Source

Read-only prod pull 2026-11-09 of `upload_failures` (2026-10-20 to 2026-11-09, 124 rows, 12 users) while
confirming build #7102's 54% upload success. Every row was classified; these are the ones with no task.

## Problem

**1. Over-10 GB game files (2 users in 3 weeks, 4 rows).**
- kevxboxstanley, 2026-10-23, `DJI_20261023185837_0001_D.MP4`, 17.2 GB, Windows desktop, build 6500.
- smokinem14, 2026-11-08, `11 8 26.mp4`, 24.5 GB, Windows desktop, build 7102 (one of the two
  non-collision failures in the build-7102 cohort).

Both rows carry a `blake3_hash`: the client has no size check of its own for games, so it sampled-hashed
the file (`hashFile`, ~1 s, five samples) and called `prepare-upload`, which refused it at
`games_upload.py:334` with `"Invalid file size. Must be between 1 byte and 10GB."` That string is the
`detail` shown to the parent (T14540 did not cover it) and there is no next step (what to do with a
24 GB DJI file: the T14810 help page, trim, the shrink work in T8860). Neither user has a later
successful upload. The clip path already refuses client-side (`MAX_CLIP_UPLOAD_BYTES`,
`uploadManager.js:~923`, T10250); the game path does not.

**2. A prepare 500 from `CreateMultipartUpload` leaves a cause-less row.** samuel@ifvaster,
2026-10-30 09:51, 29 MB game: `r2_create_multipart_upload` returned None, the server wrote
`stage=preparing reason=sync_failed http_status=500` with no `error_text`, and the client beacon added
only "Failed to initiate multipart upload". `storage.py` does log the exception class (L2736-2745) but the
log is gone (ephemeral `/tmp/logs`, T12890), so the cause of the one R2 multipart-create failure in 90
days is unknowable. The `upload_failures` row is the durable record; it should carry what the log line
carries.

## Solution

1. **Client pre-flight size check** in the game upload path, mirroring the clip path's
   `MAX_CLIP_UPLOAD_BYTES` check (T10250). `file.size > MAX_FILE_SIZE` refuses in the modal before
   `hashAndAnalyzeOrBeacon` starts, with the same beacon the clip cap sends (reason `size_over_cap`,
   already in `UPLOAD_FAILURE_REASONS`), so the server refusal becomes the old-client fallback only.
2. **Parent copy for the refusal**, both client pre-flight and the server `detail` at
   `games_upload.py:334` (the server string stays for old clients): the limit in plain words and what
   to do (link to the T14810 help page's "my file is too big" step; name the footage sources whose
   exports are under 10 GB; trim guidance until T8860 ships). Glossary words per T14640.
3. **`error_text` on the server-side `sync_failed` row** written when `r2_create_multipart_upload`
   returns None: `r2_create_multipart_upload` returns (or exposes) the exception class and message it
   logged, and `_write_upload_failure` at `games_upload.py:~552` passes it as `error_text` (capped like
   the existing writer cap). No new reason, no new table (T10270 F1/F3).

## Acceptance Criteria

- [ ] Picking a 10 GB+ game file shows the refusal before any hashing or server call (the row's `blake3_hash` is null) and the copy names the limit and one next step; no "Invalid file size. Must be between 1 byte and 10GB." reaches the UI.
- [ ] The refusal is recorded once: `stage=preparing reason=size_over_cap terminal=true origin=beacon`, `file_size` set, and `game_upload_attempted` is not booked.
- [ ] A `prepare-upload` whose `CreateMultipartUpload` fails writes `error_text` naming the exception class (test with a stubbed client raising `ClientError 403`).
- [ ] Backend test for the row contents; frontend unit test for the pre-flight; the server `detail` string test in T14540's suite updated.

## Context

### Evidence
- Prod pull output (local, gitignored): `C:\Users\imank\AppData\Local\Temp\claude\1ca763295c075470\edbe40a9-7c69-4c77-8847-76151d3edf93\scratchpad\prod_upload_failures.txt`

### Related Tasks
T14540 (server error text; this string was missed), T14810 (upload modal help page), T10250 (clip cap pre-flight, the pattern to copy), T8860 / T9040 (shrink: the real fix for 10 GB+ files), T15050 (flow id), T12890 (log retention), T7950 (CreateMultipartUpload adopt-not-retry).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/games_upload.py` (`MAX_FILE_SIZE` L55; refusal L334; multipart create + `_write_upload_failure` ~L551-560)
- `src/backend/app/storage.py` (`r2_create_multipart_upload` L2687-2748, `_adopt_live_multipart_after_ack_loss`)
- `src/backend/app/services/upload_failures.py` (`UPLOAD_FAILURE_REASONS`, `error_text` cap)
- `src/frontend/src/services/uploadManager.js` (`hashAndAnalyzeOrBeacon`, prepare beacon sites)
- Upload modal component (the T10250 clip-cap pre-flight lives in the clip path; find the game equivalent)
- Knowledge: `.claude/knowledge/backend-services.md` (Upload-failure observability T10270; Pre-cut clip upload T8370)
