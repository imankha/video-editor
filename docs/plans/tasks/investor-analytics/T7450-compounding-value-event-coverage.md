# T7450: Flow-event coverage: clip-library & repeat-usage signals

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-08-20

## Problem

Requirement 2.3 names the clip library (collections — "value that compounds across a season") as our structural retention asset whose "usage should be tracked and grown deliberately." Today no `FLOW_EVENTS` entry covers collections/library usage: `FLOW_EVENTS` (analytics.py:124-161) tracks the creation funnel and some overlay steps, but viewing/curating the season library (My Reels collections tab, ranking votes, collection shares/downloads exist as `collection_downloaded` only in milestones sprinkled elsewhere — verify exact current coverage at implementation) has no retention-signal events. T7430's clip-library retention view has nothing to read.

## Solution

Add the minimal set of collection/repeat-usage flow events through the EXISTING `record_milestone` path — no new tables, no new store. New rows land in the existing PG `user_actions` upsert (bounded: one row per user × action × platform, count increments — the epic's "latest + count" shape) and per-user `user_action_log` (which T7400's rollup then aggregates).

See [EPIC.md](EPIC.md) for directives.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/analytics.py` — new `FLOW_EVENTS` entries (all `daily_col: None` — no daily_counters columns, keep PG untouched)
- `src/backend/app/routers/collections.py` — milestone calls at the gesture endpoints (view/rank/share already have endpoints; find the right ones)
- `src/frontend/src/...` — only if a tracked gesture lacks a backend call today (server-side preferred; do NOT add client-only events)

### Related Tasks
- Feeds: T7430's action-level retention toggle (via T7400's rollup)
- Related: T3570 (annotation playback frequency event) — same shape, stays its own standalone task; don't absorb it

### Proposed events (trim/confirm against real endpoints at implementation)
| Event | Gesture | Why it's a retention signal |
|---|---|---|
| `collection_viewed` | opening a collection / My Reels collections tab | season library as the return destination |
| `ranking_vote_cast` | pairwise ranking vote (T3630 Glicko game) | deliberate curation = compounding investment |
| `collection_shared` | sharing a collection | library value being exercised outward |

Rules: server-side only, gesture-traceable (CLAUDE.md persistence rule applies to analytics too — every milestone call sits in a named gesture's endpoint, never a reactive effect), once per gesture (no view-spam: viewing the same collection 5x in a session is 1-5 counts, that's fine — count semantics, no dedup machinery).

## Implementation

### Steps
1. [ ] Verify current coverage (grep `record_milestone` in collections/ranking paths) — do not double-count anything already tracked
2. [ ] Add FLOW_EVENTS entries + milestone calls at the gesture endpoints
3. [ ] Tests: each new event fires once per gesture endpoint hit; no daily_col (grep)

## Acceptance Criteria

- [ ] Clip-library engagement visible in `user_actions` counts and (post-T7400 rollup) in T7430's action-level retention
- [ ] Zero new PG columns/tables (rows in existing upsert table only); zero client-only events
