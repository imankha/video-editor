# T7480 Verification Evidence

## Container environment constraint (stated honestly, not faked)

This task was implemented in a permission-free container that **cannot reach real R2
the way staging does, and cannot launch a browser**:

- `R2_ENABLED = False`, `get_r2_client()` is `None` (no R2/AWS credentials in env).
- No Playwright Chromium binary is installed (`~/.cache/ms-playwright` empty).

So the mandated **real-browser throttled-network repro against real R2 was NOT run
here**. The behavioral logic of every fix is instead pinned by automated tests (below),
and the end-to-end staging repro is handed to a human with exact steps.

## Automated verification run in-container (PASS)

Backend — `src/backend/tests/test_t7480_upload_resilience.py` (11 passed):
- `PART_SIZE == 5MB` (regression pin for the outage fix).
- Resume part-size guard `r2_multipart_parts_match_size`: accepts all-current-size
  parts (incl. correct short tail), rejects an old 25MB part, rejects a non-tail short
  part, rejects empty/unreadable part list (safe default = restart fresh).
- UploadId hygiene: `r2_list_multipart_uploads` filters to the exact key;
  `r2_abort_orphan_multipart_uploads` aborts both leaked multiparts, and spares
  `keep_upload_id`.
- Failure beacon handler: returns 204 on a valid body, and NEVER throws on malformed
  JSON or a non-dict body (the failure path cannot be broken).

Frontend — `src/frontend/src/services/uploadManager.stall.test.js` (4 passed):
- Stall watchdog aborts a part after 30s of ZERO progress (retryable `stalled`), and
  `xhr.abort()` is called.
- Stall watchdog does NOT abort while progress keeps flowing (progress resets the
  timer), then resolves on a 2xx.
- A non-2xx response rejects without aborting.
- Honest progress: the reported bar is driven by COMPLETED parts (0% while part 1 is
  fully buffered-but-not-done; 50% only when part 1's PUT returns 2xx; 100% at the end)
  — buffered `upload.onprogress` bytes never move the bar.

Regression (PASS): existing frontend upload suite (`uploadManager.test.js`,
`uploadStore.test.js`, `useGameUpload.test.js`, `UploadProgressIndicator.test.jsx` = 40
tests) and backend `test_game_deduplication.py` / `test_games_create_requires_video.py`
/ `test_storage_extension.py`. `ruff` + `eslint` clean on all changed files.

## What a HUMAN must verify on staging/prod (real R2, real browser)

Staging build shares master code and the same physical R2 `games/` prefix (per the task
file's own repro). Use the `drive-app-as-user` skill / a real staging account with
credits.

1. **Reproduce the ORIGINAL failure first** on the *pre-deploy* build (if still
   available) to re-confirm the baseline: CDP-throttle uplink to ~0.5Mbps, upload a
   ~17MB video, observe the 4×180s restart-from-0 loop ending in terminal failure with
   0 R2 parts. (The task file already captured this on 2026-08-24; re-confirm only if
   convenient.)
2. **Apply this branch, repeat the SAME throttled repro** and confirm it now SUCCEEDS:
   parts complete individually (5MB each), a stall aborts only the current 5MB part (not
   the whole file), the progress bar advances by completed parts, finalize + activate
   succeed. Expect server logs `[UPLOAD_LIFECYCLE] prepare ...` then `finalize success`.
3. **Unthrottled happy path** end to end (prepare → parts → finalize → activate) — must
   not regress working uploads. A small dedup upload should still short-circuit.
4. **Failure beacon**: force a terminal failure (e.g. throttle to ~0 / kill the network
   mid-part until retries exhaust) and confirm a server log line
   `[UPLOAD_BEACON] client upload failure ... reason=...` appears (this is the channel
   that produced ZERO server traffic before).
5. **Abandoned-session visibility**: leave an upload prepared-but-not-finalized, then hit
   `GET /api/admin/users/{user_id}/stuck-uploads?older_than_hours=0` as an admin and
   confirm the pending session shows with its age and live R2 multipart state
   (`r2_multipart_valid`, `r2_parts_uploaded`).
6. **Double-UploadId hygiene**: after a fresh prepare on a key that had a leaked orphan
   multipart, confirm `[UPLOAD_LIFECYCLE] prepare` logs a single `upload_id` and R2's
   ListMultipartUploads shows only that one open multipart for the key.

## Double-UploadId anomaly — RESOLVED (evidence)

The task file's leading hypothesis was "boto3's internal retry." **Refuted**: the R2
boto3 client is built with `Config(retries={"max_attempts": 0})` (`storage.py`), so boto3
does not retry. **Confirmed** source: `r2_create_multipart_upload` wraps
`client.create_multipart_upload` in `retry_r2_call(**TIER_3)` (2 attempts), and
`is_transient_error` classifies `ReadTimeoutError` (read_timeout=30) as retryable. A
CreateMultipartUpload that R2 executed but answered slower than 30s times out on read →
the app-level retry fires a second create → two open multiparts, only the second stored.
Fix 4 (abort-orphans-before-create) reclaims the leak; the stored UploadId is always the
live one used to finalize.
