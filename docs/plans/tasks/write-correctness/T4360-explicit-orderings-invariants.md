# T4360: Explicit Orderings — BEGIN IMMEDIATE + Invariant Tests

**Status:** DONE (deployed 2026-08-24 prod)
**Impact:** 6
**Complexity:** 3
**Created:** 2026-07-03
**Epic:** [write-correctness](EPIC.md) · Audit items B8 + G3

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

1. [x] Read get_db_connection's transaction behavior; write the chosen locking approach in the Progress Log.
2. [x] Lost-update test (must FAIL if you add an `await asyncio.sleep(0)` between read and write on old code — prove the test detects the race).
3. [x] BEGIN IMMEDIATE on both action endpoints + invariant comments.
4. [x] Activation invariant tests (happy path + kill-between-commits documentation).

## Acceptance Criteria

- [x] A deliberately injected await in an action endpoint makes a test fail (race detector proven)
- [x] Both action endpoints hold an explicit write transaction across RMW
- [x] Activation invariants are executable tests, not comments
- [x] No measurable contention regression (busy_timeout behavior documented)

## Progress Log

**2026-08-24**: Design doc (`T4360-design.md`) approved via artifact gate. Two open questions
confirmed as recommended: (1) the credit/status crash window (Postgres credit deduction just
before the SQLite status flip — two datastores, not one atomic unit) is documented + tested as
today's real, self-healing-on-retry behavior (idempotent `deduct_credits`), not expanded into
merging the two datastores (that stays T4640's job); (2) a `busy_timeout` lock-contention overflow
returns a retryable 503 (`database_locked`), not a generic 500.

`get_db_connection` opens a fresh, unpooled connection per request; Python's sqlite3 default
`isolation_level=""` means a bare SELECT holds no lock — the implicit `BEGIN DEFERRED` only fires
at the first write. `conn.execute("BEGIN IMMEDIATE")` issued as the first statement (before the
read) takes SQLite's RESERVED lock immediately, making the read-modify-write atomic at the DB
level instead of depending on Python's scheduler never interleaving two coroutines across that
span. Inlined at both call sites (only 2 exist — no new helper). `activate_game` deliberately left
unchanged: its multi-connection ordering would deadlock under one enclosing IMMEDIATE transaction;
its bug26p ordering claims are pinned by tests only (restructuring it is T4640's job).

Test-first: the lost-update race detector was proven to actually detect the race — confirmed RED
3/3 runs against unpatched master before any production code changed. Reviewer caught one real
issue (a characterization test hardcoding the OLD `BEGIN DEFERRED` mechanism stayed permanently
red after the fix landed, since it was proving the old bug existed, not exercising production
code) — converted to `xfail(strict=True)`; reviewer also flagged an unrelated pre-existing issue
in `set_rotation`'s exception handling for a future task, not blocking this one. Final: 6 new tests
pass + 1 xfail, 66 existing regression tests unchanged/green, ruff clean, import clean. Branch CI
green on the first push (backend success, frontend correctly skipped — no frontend files touched).

Backend-only, no UI surface — nothing to live-click-through. User approved merge on green CI +
reviewer approval. **MERGED to master `51526cee`.**
