# T3330: Embed Quest Definitions in Bundle

**Epic:** [Initial Load Time](EPIC.md)
**Priority:** P1
**Complexity:** 1
**Impact:** 5
**Status:** TODO

## Problem

`GET /api/quests/definitions` returns static, hardcoded data (no DB query) but still requires a full HTTP round-trip: DNS, TCP, TLS, auth validation, and response serialization. The data is defined as a Python constant (`QUEST_DEFINITIONS` in `quests.py:247`) and never changes at runtime.

## Evidence

- quests.py:247 returns a hardcoded constant, no DB access
- App.jsx:170 calls `fetchDefinitions()` on every page load
- Server wait: 200-500ms for data that could be a JS import (~0.7KB)

## Implementation

### 1. Create frontend quest definitions

Create `src/frontend/src/data/questDefinitions.js` containing the same quest definitions currently hardcoded in `quests.py:247`. Export as a constant.

### 2. Update questStore

In `src/frontend/src/stores/questStore.js`:
- Import definitions from the new file
- Set `definitions` in the store's initial state (not via fetch)
- Remove `fetchDefinitions()` or make it a no-op
- Remove the `fetchDefinitions()` call from App.jsx

### 3. Keep backend endpoint

Keep `GET /api/quests/definitions` for potential future versioning, but the frontend no longer calls it on page load.

## Files

| File | Change |
|------|--------|
| `src/frontend/src/data/questDefinitions.js` | New: quest definitions constant |
| `src/frontend/src/stores/questStore.js` | Import definitions instead of fetching |
| `src/frontend/src/App.jsx` | Remove `fetchDefinitions()` call |

## Acceptance Criteria

- [ ] Quest definitions available immediately without network request
- [ ] No `GET /api/quests/definitions` call in HAR on page load
- [ ] Quest UI renders identically (same data, same behavior)
- [ ] Backend endpoint still works if called directly
