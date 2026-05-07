# T2628: Modal Ingest Timeout & Retry Strategy

**Status:** TESTING
**Impact:** 8
**Complexity:** 3
**Created:** 2026-05-07

## Problem

The Modal ingest function has a 3600s (1 hour) timeout, and `call_modal_ingest()` has no per-attempt timeout — `next(generator)` can block indefinitely. If the network is slow or the CDN is unresponsive, we burn Modal credits for minutes with no way to abort. We saw a Trace import hang for 7+ minutes on cold CDN (Helsinki POP). With 3 retry attempts and no per-attempt cap, worst case is 3 hours of billable Modal time.

### Current State

```
modal_client.py:
  MODAL_JOB_RETRY_ATTEMPTS = 3
  MODAL_JOB_RETRY_DELAY = 3.0
  MODAL_JOB_RETRY_BACKOFF = 2.0
  classify_modal_error() → "transient" / "deterministic"
  _translate_modal_error() → user-friendly string

  call_modal_ingest():
    for attempt in range(1, 3+1):
      gen = ingest_fn.remote_gen(...)
      while True:
        update = next(gen)     # ← NO TIMEOUT, blocks forever
        ...
      if transient error → retry with backoff
    return {"status": "error", "error": _translate_modal_error(last_error)}
```

**Missing:**
1. No per-attempt timeout — `next(generator)` can block indefinitely
2. No progress stall detection — if no update for N minutes, should cancel
3. Modal function timeout is 3600s (should be 2x expected time)
4. Error message after exhaustion is generic, no guidance for user

## Solution

### 1. Reduce Modal Function Timeout

Set the Modal `@app.function(timeout=...)` based on **2x the expected time**:

| Source Type | Expected Time (optimized) | Worst Observed | Timeout (2x expected) |
|-------------|--------------------------|----------------|----------------------|
| Veo (3GB direct) | ~2 min | ~3 min | 5 min (300s) |
| Trace (1.2GB HLS per half) | ~3 min | ~8 min (cold CDN) | 10 min (600s) |

Since the Modal function handles both source types with a single timeout, use the larger value: **600s (10 min)**.

```python
@app.function(
    image=ingest_image,
    cpu=2,
    memory=8192,
    timeout=600,  # was 3600 — 2x worst expected time
    secrets=[modal.Secret.from_name("r2-credentials")],
)
```

### 2. Per-Attempt Caller-Side Timeout

Wrap each `next(generator)` call with `asyncio.wait_for` to enforce a per-attempt time limit. If one attempt times out, it counts as a transient error and triggers retry.

```python
# In call_modal_ingest():
INGEST_PER_ATTEMPT_TIMEOUT = 600  # seconds — matches Modal function timeout

attempt_start = time.time()

while True:
    elapsed = time.time() - attempt_start
    remaining = INGEST_PER_ATTEMPT_TIMEOUT - elapsed
    if remaining <= 0:
        raise asyncio.TimeoutError(f"Ingest attempt timed out after {INGEST_PER_ATTEMPT_TIMEOUT}s")
    
    update = await asyncio.wait_for(
        loop.run_in_executor(None, next_item, gen),
        timeout=remaining,
    )
    ...
```

### 3. Progress Stall Detection

If no progress update arrives for 180s (3 min), treat as a stall and abort the attempt. This catches cases where the Modal container is alive but stuck (e.g., CDN connection hanging).

```python
PROGRESS_STALL_TIMEOUT = 180  # 3 minutes with no progress update

last_update_time = time.time()

while True:
    try:
        update = await asyncio.wait_for(
            loop.run_in_executor(None, next_item, gen),
            timeout=min(PROGRESS_STALL_TIMEOUT, remaining),
        )
    except asyncio.TimeoutError:
        raise asyncio.TimeoutError(
            f"Ingest stalled — no progress for {PROGRESS_STALL_TIMEOUT}s"
        )
    
    if update is not None:
        last_update_time = time.time()
    ...
```

### 4. User-Friendly Exhaustion Message

After all 3 attempts fail, return a specific error message instead of the generic `_translate_modal_error`:

```python
# After retry loop exhaustion:
if all attempts failed:
    return {
        "status": "error",
        "error": "Import failed after multiple attempts. The video server may be slow right now — please try again later, or upload the file directly.",
        "error_code": "INGEST_EXHAUSTED",
    }
```

The `error_code` field lets the UI distinguish exhaustion from other errors and show appropriate guidance (see T2630 error states).

### 5. Classify Timeout as Transient

Ensure `classify_modal_error()` treats `asyncio.TimeoutError` as transient so it triggers retry:

```python
def classify_modal_error(error: Exception) -> str:
    if isinstance(error, asyncio.TimeoutError):
        return "transient"
    # ... existing logic
```

## Scope

**Stack Layers:** Backend + Modal
**Files Affected:** 2 files
**LOC Estimate:** ~30 lines changed
**Test Scope:** Backend (unit test for timeout behavior)

## Relevant Files

- `src/backend/app/modal_functions/video_processing.py` — `@app.function(timeout=...)` change
- `src/backend/app/services/modal_client.py` — per-attempt timeout, stall detection, exhaustion message

## Testing

1. Verify existing integration tests still pass (no regressions from timeout change)
2. Manually test with a valid Veo URL — should complete well within 600s timeout
3. (Optional) Simulate stall by temporarily setting `PROGRESS_STALL_TIMEOUT = 5` and adding a `time.sleep(10)` in the Modal function

## Risks

- **Trace cold CDN**: Worst observed was ~8 min. With 600s timeout, this fits. But if CDN is slower than 2x worst case, all 3 attempts will timeout. This is by design — we cap cost and tell the user to try later.
- **Progress stall false positives**: 180s is generous. The longest gap between progress updates is during ffmpeg remux startup (~10-20s). No risk of false trigger.

## Prior Task Learnings (T2627)

- Benchmarking showed Veo fresh upload: ~2 min (warm CDN), ~3 min (cold CDN)
- Trace fresh upload: ~1.5 min (warm CDN), ~8 min (cold Helsinki CDN due to 995 HLS segments over Atlantic)
- CDN edge warming is the primary variable — first request populates the edge cache, second is served from it
- Modal container startup adds ~5-10s (cold start) but is amortized across retries
- `classify_modal_error` already distinguishes transient vs deterministic — timeout should be transient
