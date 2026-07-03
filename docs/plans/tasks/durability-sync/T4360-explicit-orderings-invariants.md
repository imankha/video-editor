# T4360: Explicit Orderings — BEGIN IMMEDIATE + Invariant Tests

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-03
**Epic:** [durability-sync](EPIC.md) · Audit items B8 + G3

## Problem

[DEP] Two places where correctness depends on unstated timing/ordering, protected today only by comments or by accident:

1. **Action-endpoint RMW atomicity is an accident.** `clips.py:326` (`framing_action`) and `overlay.py:348` (`overlay_action`) read a whole blob, mutate, and write back inside one `async def` with no `await` between read and commit — atomic ONLY because the event loop can't interleave. One innocent `await` (or moving DB work to a thread) opens a lost-update race between two in-flight gestures.
2. **games.py activation sequencing is comment-hardened.** `activate_game` (:568-758) does a deliberate mid-handler commit to release the SQLite writer lock (:721) with bug26p comments (:543-549, :717-725) documenting hand-managed ordering across 3 datastores. Nothing fails if a future edit reorders it.

## Solution

1. **Action endpoints:** wrap the read→mutate→write span in an explicit transaction (`BEGIN IMMEDIATE` via the connection, or `conn.execute("BEGIN IMMEDIATE")` pattern — check how `get_db_connection` manages transactions first; SQLite autocommit semantics matter here). Add a comment stating the invariant AND a test: two overlapping requests (use an injected `await` seam or threadpool) → both changes survive, no lost update. If `BEGIN IMMEDIATE` causes `database is locked` contention under the 30s busy_timeout, document measured behavior.
2. **Activation invariants as tests:** convert the bug26p comment claims into assertions a test can check — e.g., "after activate: every ready game has a game_storage ref", "credit deduction happens iff activation completed" (this is the invariant the bug26p incident violated: games ready-without-storage-ref). An integration test that runs activate and asserts the cross-table invariants; plus a failure-injection variant (kill between the two commits) asserting the recovery/consistency story — document what IS guaranteed today rather than silently hoping.

## Context

- Files: `src/backend/app/routers/clips.py`, `routers/export/overlay.py`, `routers/games.py`, `src/backend/app/database.py` (connection/transaction management)
- This task does NOT refactor activate_game into a service (that's T4640) — it pins today's behavior with tests so T4640 can refactor against them. [DEP: tests isolate the later work.]
- Related history: bug 26p (silent upload failure + ready-without-storage-ref games), v017 migration.

## Steps

1. [ ] Read get_db_connection's transaction behavior; write the chosen locking approach in the Progress Log.
2. [ ] Lost-update test (must FAIL if you add an `await asyncio.sleep(0)` between read and write on old code — prove the test detects the race).
3. [ ] BEGIN IMMEDIATE on both action endpoints + invariant comments.
4. [ ] Activation invariant tests (happy path + kill-between-commits documentation).

## Acceptance Criteria

- [ ] A deliberately injected await in an action endpoint makes a test fail (race detector proven)
- [ ] Both action endpoints hold an explicit write transaction across RMW
- [ ] Activation invariants are executable tests, not comments
- [ ] No measurable contention regression (busy_timeout behavior documented)
