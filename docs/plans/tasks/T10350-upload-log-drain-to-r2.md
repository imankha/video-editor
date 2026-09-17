# T10350: Upload/app log drain to R2 (D2 follow-up to T10270)

**Status:** TODO
**Impact:** 3
**Complexity:** 4
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

T10270's design (§ D1 vs D2) split the upload-failure observability work into two pieces: D1, a durable Postgres record of every failure event (shipped in T10270), and D2, a raw application/upload log drain to durable storage so `[UPLOAD_FAILURE]`/`[UPLOAD_BEACON]` log lines survive past Fly's log retention window instead of scrolling off after a few days. T10270 shipped D1 only — it already satisfies the acceptance criteria on its own (a durable, queryable record exists), but the raw log trail is still ephemeral.

## Solution

A Fly log shipper: a separate small app/process running Vector, consuming the org's NATS log stream (Fly's log-shipping mechanism), sinking to R2 under a `logs/` prefix with lifecycle expiry (mirrors `upload_failures`' own 90-day TTL, or whatever retention is decided). Infra + Vector config work, no application code changes.

## Context

### Relevant Files (REQUIRED)
- New: a Vector config + Fly app definition for the log shipper (no existing files, greenfield)
- Reference: `docs/plans/tasks/T10270-design.md` § D1/D2 split, `.claude/knowledge/backend-services.md` (T10270's writer/fence documentation)

### Related Tasks
- Follow-up to T10270 (upload-failure observability), which shipped D1

### Technical Notes
- This is infra, not app code — no Migration agent, no schema, no Reviewer gate in the usual sense; closer to a deploy/ops task.
- Not urgent: D1 already answers "do we have enough logging" for the specific upload-failure question; D2 is a general debuggability improvement, not a data-loss risk.

## Implementation

### Steps
1. [ ] Decide retention window and R2 prefix/lifecycle rule
2. [ ] Vector config to consume the Fly NATS log stream
3. [ ] Sink to R2, verify lines land and are queryable
4. [ ] Document how to search the drain (for whoever debugs a future incident)

### Progress Log

**2026-09-17**: Filed from T10270's implementation report as its named D2 follow-up.

## Acceptance Criteria

- [ ] App/upload log lines are durably retrievable past Fly's live-log window
- [ ] No app code changes required to keep working
