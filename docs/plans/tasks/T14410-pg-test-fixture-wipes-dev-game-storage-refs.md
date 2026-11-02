# T14410: Backend test runs wipe every dev user's game_storage_refs

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-02
**Updated:** 2026-11-02

## Problem

Running the backend tests locally deletes every row in `game_storage_refs` on the shared dev
Postgres, for every dev user, not just test users.

Mechanism (found by the T11500 worker, 2026-11-02): the `pg_conn` fixture's `_build_pg_schema`
(`src/backend/tests/conftest.py:227`) replays the Postgres migrations from v005 on first use in
each pytest session. Postgres migration `v025_clear_stale_game_storage_refs.py:30` runs an
unscoped `DELETE FROM game_storage_refs`. That is correct as a one-time prod migration, and
destructive when replayed against the dev database people and stacks are using.

Effect on dev: every account loses its storage refs. Games look unreferenced (expiry/sweep
logic, `game_ref_counts`), and the T11500 dev-account templates fail `--check` (Full had 0 refs
after the worker's test run). The worker restored only the Full template's 4 refs; other dev
users' refs that were wiped are still gone.

T14210 fixed the same fixture for the analytics tables (user_actions/user_segments) but not this
table.

## Solution

The fixture must never delete non-test rows on the shared dev DB. Options, in line with T14210's
decision:
- Don't replay data-mutating migrations against a DB already past them: replay only when the
  ledger is genuinely below the migration (the dev DB is already at head), or
- Skip v025's DELETE in the test replay / scope it to test users, or
- Point the test suite at its own database (the general fix for this class).

Pick with the user; check what T14210 chose and follow it. Also decide whether to restore the
wiped dev refs (e.g. rebuild from each user's profile DB `games` rows the way the T11500 builder's
insert-only helper does) or accept the loss on dev.

## Context

### Relevant Files (REQUIRED)
- `src/backend/tests/conftest.py` - `_build_pg_schema` migration replay
- `src/backend/app/migrations/postgres/v025_clear_stale_game_storage_refs.py` - unscoped DELETE

### Related Tasks
- Same class as: T14210 (analytics tables)
- Found by: T11500 (template builder `--check` caught it)

### Technical Notes
- Bug depth: test tooling, but it destroys shared dev data (storage refs), so above other test bugs.
- Landmine recorded by the T11500 worker in `.claude/knowledge/backend-services.md`.
- Every other replayed migration with an unscoped DELETE/UPDATE has the same risk; audit them in the same pass.

## Implementation

### Steps
1. [ ] Red test: seed a non-test `game_storage_refs` row, run the fixture's schema build, assert it survives
2. [ ] Fix per the chosen option; audit other replayed migrations for unscoped data writes
3. [ ] Decide on restoring wiped dev refs
4. [ ] Tests pass; ruff clean

### Progress Log

**2026-11-02**: Filed from the T11500 worker report.

## Acceptance Criteria

- [ ] A backend test session leaves non-test `game_storage_refs` rows on the dev DB untouched
- [ ] No replayed migration deletes or rewrites non-test rows
- [ ] Red-to-green test
