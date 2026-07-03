# T4330: Unified Action Client — Serialization + Versioning + 409 Conflicts

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [durability-sync](EPIC.md) · Audit items C8 + G1 + B6

## Problem

Three related gaps in the gesture-action transport:

1. **[DRY]** `api/framingActions.js:24-48` and `api/overlayActions.js:25-50` are the same `sendAction` function twice (build `{action, target, data}` → `apiFetch` POST → console.error). Any transport fix (retry, error taxonomy, auth refresh) must be written twice.
2. **[DEP]** Actions are fire-and-forget POSTs. Two in-flight actions on the same clip can arrive **reordered on the network**; the backend does whole-blob read-modify-write, so last-arrival wins — a race with no user-visible cause.
3. **[SYNC]** Only overlay sends `expected_version`, and the backend check is **commented out** (`overlay.py:384-391`) — the version plumbing exists end-to-end and protects nothing. Framing has no versioning at all.

## Solution

1. **`api/actionClient.js`** — `createActionClient({ url: (ids) => ..., tag })`. Both existing files become declarative wrappers (keep per-client result mapping; response contracts differ slightly — compare them first and document the differences in code).
2. **Per-entity FIFO**: the client keeps one promise chain per entity key (projectId+clipId / working_video_id). Each action awaits its predecessor before POSTing. Simple chain, no coalescing in v1 (note coalescing as a future option; don't build it).
3. **Versioning**: client tracks the last `version` returned per entity and sends it as `expected_version` on every action. Backend: implement the scaffolded 409 in overlay's action endpoint; add the same (column exists? check — if `working_clips` lacks a version counter, add one via migration, Migration agent) to the framing actions endpoint.
4. **409 handling**: on conflict, the client re-fetches server state, rebases NOTHING automatically — it surfaces a "someone else edited this" refresh prompt via the existing toast system. (Two-tab editing is the scenario; silent merge is out of scope.)

## Context

- Files: `src/frontend/src/api/framingActions.js`, `api/overlayActions.js`, callers in `FramingContainer.jsx` + `OverlayScreen.jsx:575-745`; backend `routers/export/overlay.py:347-643`, `routers/clips.py:326-542`.
- T3800's persist wrapper (resolve→optimistic→surgical→rollback) sits ABOVE this transport — don't disturb its rollback semantics; the FIFO makes rollbacks deterministic (rollback can't interleave with a later action's echo).
- Migration note: if framing needs a version column, follow memory "Running Migrations" (never reuse version numbers) + include Migration agent in classification.

## Steps

1. [ ] Diff the two sendAction implementations + response shapes; write the contract table into the client's JSDoc.
2. [ ] Tests first: FIFO ordering (fire A,B same clip; B's POST must start after A resolves); 409 → refresh prompt; version threading.
3. [ ] Backend 409 (overlay first — scaffold exists — then framing), each with a two-writer backend test.
4. [ ] Migrate both action files to the client; grep for any direct `apiFetch` action POSTs bypassing it.

## Acceptance Criteria

- [ ] One transport implementation; both action files declarative
- [ ] Same-entity actions provably serialized (unit test with deferred fetch mocks)
- [ ] Concurrent edit from a second tab → 409 → visible refresh prompt, zero silent loss
- [ ] No action POST path bypasses the client
