# perf-verify-via-grep-chain

**Priority:** HIGH
**Category:** Verify via grep chain

## Rule

A perf fix is not verified until you can produce a before/after grep of the
same request shape showing (a) the chain got shorter or work moved where you
intended, and (b) the chain is still complete — every log line still carries
req_id.

## Workflow

1. **Baseline.** Capture logs for one slow `req_id=<before>`. Reduce with
   `reduce_log grep=req_id=<before>`. Keep it.
2. **Fix.** Apply the change.
3. **Reproduce same condition.** Restart backend if cold-cache matters; keep
   workload identical. Capture logs for `req_id=<after>`.
4. **Compare chains.** `grep req_id=<after>` should show:
   - Expected sub-steps removed/moved (e.g. `[Restore]` no longer on /me).
   - `[REQ_TIMING] total_ms` at target.
   - Every remaining line still has req_id — fix didn't break attribution.

## What counts as "same condition"

- Same cold/warm state (restart before first request if you're testing cold).
- Same user / profile (different users have different R2 restore costs).
- Same concurrency level (if the old slow was due to lock contention,
  single-request retry hides it).

## Anti-Patterns

- **"It feels faster"** — without grep proof, a lucky warm cache looks like a
  fix. Don't ship on vibes.
- **Comparing to a different request shape.** Fixing /me and verifying with
  /api/projects is a different question.
- **Losing req_id on a new log line you added.** Review your diff — every
  `logger.info/warning/error` you touched or added must carry req_id if it's
  on the request path.

## Example verification

Before ( /me, 780ms):
```
[REQ] GET /api/auth/me | user=$1 ... req_id=<old>  (req_id added by this fix)
[R2_CALL] op=HeadObject elapsed_ms=825              (NO req_id — instrumentation gap)
[R2_CALL] op=HeadObject elapsed_ms=77               (NO req_id)
[Restore] Downloaded user.sqlite ... took 1.08s     (NO req_id)
[REQ_TIMING] GET /api/auth/me total_ms=780 ... req_id=<old>
```

After ( /me, 15ms):
```
[REQ] GET /api/auth/me | user=$1 ... req_id=<new>
[Auth] /me: valid session — user=$1
[REQ_TIMING] GET /api/auth/me total_ms=15 handler_ms=0 sync_ms=0 req_id=<new>
```

And the restore cost reappears attributed to the next data request (as
intended), with full req_id attribution:

```
[REQ] GET /api/games ... req_id=<games>
[Restore] First access for user.sqlite ... req_id=<games>
[R2_CALL] op=HeadObject elapsed_ms=110 req_id=<games>
[Restore] Downloaded user.sqlite ... took 0.30s req_id=<games>
[REQ_TIMING] GET /api/games total_ms=349 ... req_id=<games>
```

Both conditions pass: /me fast, and `<games>` still fully attributable.
