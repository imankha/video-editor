# perf-attribute-before-fixing

**Priority:** CRITICAL
**Category:** Attribute before fixing

## Rule

Don't optimize until every millisecond of the slow request is attributed to a
named sub-step. If the chain is broken, fix instrumentation first — then
optimize.

## Workflow

1. **Capture both sides.** Frontend `[SLOW FETCH]` gives wall time + `req_id`.
   Backend `[REQ_TIMING]` breaks that into `handler_ms` + `sync_ms`. The
   middleware gap (`total_ms − handler_ms − sync_ms`) is the unexplained time.
2. **Grep the req_id.** Every tagged sub-step between `[REQ]` entry and
   `[REQ_TIMING]` exit must carry the same req_id. If log lines for `[R2_CALL]`,
   `[Restore]`, or route-level work lack req_id → STOP, fix instrumentation.
3. **Identify the long pole.** One sub-step usually dominates — name it
   explicitly before proposing a fix.
4. **Decide intent.** "Should this work run on this path at all?" Many slow
   requests are caused by work that isn't needed for the route (e.g. /me
   didn't need profile.sqlite).

## Rationale

- **Speculation wastes fixes.** Without attribution, you fix the wrong thing and
  the p99 doesn't move. You also add code you'll regret.
- **Timestamp proximity isn't causality.** Under concurrent load
  (`inflight_entry > 1`), adjacent log lines may belong to different requests.
  Only req_id proves causality.
- **Instrumentation gaps hide regressions.** A sub-step you can't attribute
  today is one you can't regression-test tomorrow.

## Anti-Patterns

- Fixing based on "the obvious" culprit (the slowest-looking log line in the
  vicinity). It may not be on the request's critical path.
- Adding caches before measuring cold cost.
- Writing a "fix" that changes behavior without proving the old behavior was
  actually the bottleneck.

## Quick Check

Before touching code, can you answer:
1. Which req_id is slow?
2. What is `total_ms − handler_ms − sync_ms`?
3. Which tagged sub-step covers that gap (by req_id, not by timestamp)?
4. Is that sub-step necessary for this route?

If any answer is "I'm not sure," you're not ready to fix.
