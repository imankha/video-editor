# Collection Download — Durable Recovery

**Status:** TODO — not yet designed, deliberately deferred
**Started:** —

## Goal

Upgrade [Collection Download](../collection-download/EPIC.md)'s synchronous streamed download
into something recoverable. User direction (2026-08-10), reviewing the original design's Q2
("sync vs job"): **"Recovery mechanic, must be very robust. Feel free to make this its own
epic."** — a stronger requirement than the original design carried, and explicitly split out
rather than bolted onto the mechanism epic.

## Why this is its own epic, not a T4945 sub-task

The mechanism epic ships a synchronous download matching the existing single-reel
`download_file` pattern — no `export_jobs` row, no progress UI, regenerate-on-demand. That's
adequate for a typical collection. "Very robust" recovery is a materially different shape of
work: durable job state, resumability across a dropped connection or a slow/large stitch,
progress reporting, and a recovery path that survives the request that started it dying. That's
the same *class* of problem the [Durability Hardening Campaign](../../PLAN.md) is already
working through for exports generally (T4310 upload-side CAS, T4320 durable create/sync, T4400
backend-authoritative export) — this epic should read those patterns before inventing its own,
not build a parallel recovery mechanism for one feature.

## Scope (not yet broken into tasks)

Undesigned. When this is picked up:
1. Re-read [collection-download/EPIC.md](../collection-download/EPIC.md) Decision 2 for the
   full context of what was deferred and why.
2. Check whether T4310/T4320/T4400 have landed by then — if so, this epic likely REUSES their
   general durable-write/recovery machinery rather than building collection-specific job
   tracking from scratch (the whole point of those tasks being "general guarantees" per
   PLAN.md's Durability Hardening Campaign framing).
3. Needs an Architecture design gate — job-backed recovery is exactly the "async
   timing/persistence/concurrency" class of problem this project routes to the Opus expert
   agent, not a same-session Sonnet build.

## Completion Criteria

Not yet defined — this epic starts at a design pass, not implementation.
