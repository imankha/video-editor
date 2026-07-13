# T5060: Clear the deprecation warnings surfaced by the starlette 0.37.2 bump

**Status:** TODO
**Impact:** 2
**Complexity:** 2
**Created:** 2026-07-13
**Updated:** 2026-07-13

## Problem

T5020's root-cause fix (starlette 0.32.0.post1 → 0.37.2, fastapi 0.108.0 →
0.110.1) made the backend test suite emit deprecation warnings that are
harmless today but WILL break on a future starlette/fastapi major:

1. `@app.on_event("shutdown")` in `app/main.py` (~line 404) — deprecated in
   favor of lifespan handlers; fastapi has warned for a while, and on_event is
   slated for removal.
2. starlette TestClient per-request `cookies=` deprecation — tests pass
   cookies per-request; newer starlette wants them set on the client instance.
3. httpx's own `Client(app=...)` shortcut deprecation warning appears in a few
   places (distinct from the removed-kwarg crash T5020 fixed) — audit any
   remaining direct `httpx.Client(app=...)` usages in tests and move them to
   `transport=ASGITransport(app=...)`/`WSGITransport`.

Observed counts from the first green CI run (29274441558) and the wave's local
runs: 10-73 warnings depending on selection, all in these three classes.

Fixing them now is cheap; fixing them during a forced major-version migration
later means doing it under pressure alongside real breakage.

## Solution

- Convert `@app.on_event("shutdown")` (and any `startup` twin — grep
  `on_event` across app/) to the fastapi `lifespan=` context-manager pattern.
  This touches app startup/shutdown ordering — verify `init_pg_pool`/cleanup
  hooks still run by asserting in a TestClient lifespan test.
- Update tests passing per-request `cookies=` to set them on the TestClient
  instance (or use the documented replacement); mechanical, test-only.
- Replace any remaining `httpx.Client(app=...)`/`AsyncClient(app=...)` in
  tests with the `transport=` form.
- Acceptance: run the backend suite with `-W error::DeprecationWarning`
  filtered to starlette/fastapi/httpx modules (pytest `filterwarnings` ini or
  CLI) and get zero from these three classes. Do NOT turn all
  DeprecationWarnings into errors globally — third-party libs emit unrelated
  ones.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/main.py` — on_event → lifespan
- `src/backend/tests/**` — cookies= per-request usages, httpx app= usages
  (grep `cookies=` in TestClient calls and `Client(app=` / `AsyncClient(app=`)
- `src/backend/pytest.ini` / `pyproject.toml` — optional filterwarnings pin so
  the three classes STAY at zero (regression guard)

### Related Tasks
- T5020 (landed) — created the surface; this clears the residue
- No file overlap with T5050 (different tests), but both are low-priority
  test-hygiene — fine to bundle in one wave/worker if convenient

### Technical Notes
- Lifespan conversion is the only piece with runtime behavior: app shutdown
  currently closes the PG pool (check what the on_event handler does before
  moving it). Keep the handler body identical; only the registration changes.
- Backend tests only against a throwaway Postgres (suite truncates shared
  tables) — same setup note as T5050.

## Implementation

### Steps
1. [ ] Grep the three patterns; list exact sites in this file before editing.
2. [ ] lifespan conversion + a test asserting shutdown hook still fires.
3. [ ] Mechanical test updates (cookies=, transport=).
4. [ ] filterwarnings guard for the three classes; full suite green.
5. [ ] CI verdict green on the branch.

## Acceptance Criteria

- [ ] Zero starlette/fastapi/httpx deprecation warnings from the three classes
      in a full backend suite run
- [ ] Shutdown behavior proven unchanged (test asserts the hook runs)
- [ ] filterwarnings guard prevents silent regrowth
