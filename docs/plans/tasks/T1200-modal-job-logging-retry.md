# T1200: Modal Job ID Logging & Failure-Aware Retry

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-04-08
**Updated:** 2026-04-08

## Problem

When Modal jobs fail (e.g., overlay broken pipe at frame 303), our server logs don't have enough context to diagnose the issue. The annotate path logs `object_id` but framing and overlay paths don't log the call ID, job type, input parameters, or any identifying information. You end up looking at a generic error with no way to correlate it to a specific Modal run.

Additionally, all Modal failures are treated the same — the server reports the error and gives up. Some failures are transient (network timeouts, cold starts, temporary resource pressure) and should be retried automatically. Others are deterministic (bad input, OOM on specific content, FFmpeg pipe errors from malformed video) and retrying would just fail again.

## Solution

### 1. Rich Modal Job Logging Across All Paths

Every Modal call should log comprehensive context — not just the call ID, but the job type, input parameters, and any identifying info we have. This makes it possible to correlate server-side errors with Modal dashboard entries and understand what was being processed.

Log on job start:
- **Modal app name** (the Modal App the function belongs to)
- **Job type** (framing_ai, framing_ai_multiclip, overlay)
- **Modal call ID** (`object_id` from the function handle)
- **Job ID** (our internal export/render job ID)
- **User ID**
- **Key input params** (clip count, resolution, video duration, etc.)

Log on job completion/failure:
- All of the above, plus elapsed time, error message, error classification

### 2. Failure Classification & Conditional Retry

Classify Modal failures into retryable vs non-retryable categories:

**Retryable (transient):**
- Network errors / connection reset
- Cold start timeouts
- Modal infrastructure errors (503, capacity)
- Generic timeout (job didn't start)

**Non-retryable (deterministic):**
- FFmpeg pipe errors (broken pipe, malformed input)
- OOM kills
- Invalid input parameters
- Application-level errors (bad crop dimensions, missing video)

On retryable failure, retry up to N times (configurable, default 2) with backoff. On non-retryable failure, log the call ID and error classification, then propagate the error immediately.

## Context

### Relevant Files
- `src/backend/app/services/modal_client.py` — All Modal call paths (`call_modal_framing_ai`, `call_modal_framing_ai_multiclip`, `call_modal_overlay`); `remote_gen()` is the streaming interface
- `src/backend/app/routers/exports.py` — Export endpoints that call modal_client functions
- `src/backend/app/routers/framing.py` — Framing render endpoint

### Related Tasks
- Related: T1190 (Session-to-Machine Pinning) — machine pinning ensures retry hits the same machine with the same DB state
- Related: T1110 (Never Block Server on Export) — retry logic must work with async/background processing

### Technical Notes

- `remote_gen()` returns a generator. The Modal `object_id` (call ID) is available on the function call object, not directly from the generator. Need to investigate the exact API for capturing it.
- The annotate path already logs `object_id` — use that as the reference pattern.
- Retry should happen at the `modal_client.py` level, not in the router, so all callers benefit.
- Progress WebSocket messages should indicate retry attempts (e.g., "Retrying... attempt 2/3") so the user sees feedback instead of silent waiting.

## Implementation

### Steps
1. [ ] Audit `remote_gen()` usage — find how annotate path captures `object_id` and replicate for framing/overlay
2. [ ] Add rich structured logging at job start (job type, call ID, job ID, user ID, key input params) and on completion/failure (+ elapsed time, error class)
3. [ ] Define error classification function (regex/pattern matching on error messages)
4. [ ] Implement retry wrapper with configurable max attempts and backoff
5. [ ] Send retry status through WebSocket progress channel
6. [ ] Add structured logging: `{modal_call_id, path, attempt, error_class, error_msg}`
7. [ ] Test with simulated transient failure (e.g., network disconnect)

## Acceptance Criteria

- [ ] All Modal calls (framing, multiclip, overlay) log job type, call ID, job ID, user ID, and key input params on start
- [ ] Completed/failed Modal calls log elapsed time + error classification for dashboard lookup
- [ ] Transient failures retry automatically (up to configured limit)
- [ ] Deterministic failures fail immediately without retry
- [ ] User sees retry status via WebSocket progress updates
- [ ] No behavior change for successful jobs
