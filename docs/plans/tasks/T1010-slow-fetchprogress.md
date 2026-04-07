# T1010: Slow fetchProgress Response

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-04-07
**Updated:** 2026-04-07

## Problem

`GET /api/quests/progress` takes ~1229ms on localhost, which is unexpectedly slow for what should be simple SQLite queries. This adds noticeable delay to the quest UI update after export.

Profiling from the Frame Video flow showed:
- `saveClipState`: 1411ms
- `WebSocket connect`: 13ms
- `render POST (202)`: 4337ms → optimized to ~30ms (T760 background task)
- **`fetchProgress`: 1229ms** ← this task

After the render POST optimization, fetchProgress becomes the next bottleneck (~1.2s of the remaining ~2.7s total).

## Solution

Profile the backend `/api/quests/progress` endpoint to identify where the time goes:
- SQLite query time for each quest step check
- JSON serialization
- Middleware overhead (auth, session lookup)
- Any N+1 query patterns

Likely fixes:
- Batch quest step checks into a single query instead of per-step queries
- Cache quest definitions (they rarely change)
- Ensure SQLite indexes cover the step check queries

## Context

### Relevant Files
- `src/backend/app/routers/quests.py` - Progress endpoint
- `src/frontend/src/stores/questStore.js` - Frontend fetchProgress caller

### Related Tasks
- Part of quest framing investigation (fix/quest-framing-progress branch)

### Technical Notes
The progress endpoint checks each quest step by running individual SQL queries (e.g., `SELECT 1 FROM export_jobs WHERE type = 'framing' LIMIT 1`). With 15+ steps across 4 quests, this could add up.

## Implementation

### Steps
1. [ ] Add server-side timing to each step check in quests.py
2. [ ] Identify slowest queries
3. [ ] Optimize (batch queries, add indexes, or cache)

## Acceptance Criteria

- [ ] fetchProgress < 200ms on localhost
- [ ] No regression in quest step accuracy
