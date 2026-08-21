# T4330: Unified Action Client — Serialization + Versioning + 409 Conflicts

**Status:** WAITING ON USER (retest branch pushed, awaiting test + merge —
feature/T4330-unapproved-retest @ dbd38a3e, cut from master + this branch's
original feature/T4330-action-client-serialization @ 6d0ba8d2, plus two
live-testing fixes below. NOT merged to master — needs explicit user go-ahead.)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-07-03
**Epic:** [write-correctness](EPIC.md) · Audit items C8 + G1 + B6

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

## Progress Log

**2026-08-20/21 (live two-tab testing found + fixed two real bugs)**:

1. **Version tracker never seeded from initial load (`dbd38a3e`'s parent, `134f82fe`).**
   Live two-tab testing (open the same clip in two tabs, edit in both) found the
   409 conflict prompt never appeared in either Framing or Overlay. Root cause:
   `actionClient.js`'s `versions` Map only ever gets set from the client's OWN
   echoed action responses -- never from the entity's initial GET. A freshly
   opened tab's FIRST action therefore always omits `expected_version`, and the
   backend explicitly treats a missing version as "skip the check" (intentional
   back-compat) -- so a tab's first edit could never trigger a 409, no matter how
   stale its view actually was. Fixed: `actionClient.seedVersion(ids, version)`,
   wired into both load paths (`useProjectLoader` for clips'
   `framing_version`, `OverlayScreen` for the project's `version`), backed by
   new `WorkingClipResponse.framing_version` / `get_overlay_data`'s `version`
   response fields (both values already existed in the DB/query, just never
   returned to the client).

2. **`sqlite3.Row` membership check broken by an UNRELATED lint fix (`dbd38a3e`).**
   Fixing pre-existing ruff SIM118 warnings in the two touched backend files (a
   whole-file lint gate, not scoped to new lines) removed `.keys()` from several
   `'column' in row` presence checks. `in` on a `sqlite3.Row` checks VALUES, not
   column names (unlike a plain dict, where ruff's suggestion is correct) -- so
   every one of those checks became permanently False, and `rotation`,
   `framing_version`, `width`, `height`, `fps`, `highlight_color` silently
   defaulted regardless of the real DB value. This directly undermined fix #1
   (seeding from a value that's always 0). Caught via a live curl bypassing the
   browser/dev-server entirely (debug log showed the row correctly held
   `framing_version=1`; the JSON response still said 0). Fixed: restored
   `.keys()` everywhere with an explanatory comment, noqa'd SIM118 instead of
   "fixing" it. New regression test
   (`TestClipsListExposesFramingVersion`) asserts the real value round-trips
   through the endpoint -- the existing rotation-migration-window test only
   checked a raw SELECT, never the handler's response construction, which is
   why this slipped through initially.

Both fixes verified live end-to-end (real HTTP calls, not mocks): a stale
`expected_version` from a simulated "second tab" now correctly returns 409
with the accurate `current_version` and refresh-prompt message, for both
Framing and Overlay.

## Acceptance Criteria

- [x] One transport implementation; both action files declarative
- [x] Same-entity actions provably serialized (unit test with deferred fetch mocks)
- [x] Concurrent edit from a second tab → 409 → visible refresh prompt, zero silent loss
- [x] No action POST path bypasses the client
