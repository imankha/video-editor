# T6030: Close the migration-window class — the v025 residual, plus a structural guard so it can't reopen

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-07-27
**Follows:** T5970 (merged to master 2026-07-27) — read its report in `.claude/knowledge/backend-services.md`
§ "Migration-window column guard audit (T5970)" FIRST. Do not re-derive the audit.

## Background

Versioned migrations do NOT auto-run on deploy (CLAUDE.md § Migration System). Between a deploy
and the admin `POST /api/admin/migrate`, every per-user SQLite DB sits at the OLD schema while
NEW code is live. Any SELECT/INSERT that *names* a column the pending migration adds raises
`sqlite3.OperationalError: no such column` — a 500, not a degraded read.

T5970 fixed two instances (v027 `detections_data` on the overlay read, v026 `shared_by` on the
bootstrap quests read) and audited every `ADD COLUMN` in `profile_db`/`user_db`. It left **one
documented residual** and did **not** make the class structurally impossible to reopen. This
task does both.

## Part 1 — the v025 residual (the known open defect)

`profile_db/v025_freeze_slowmo_section.py` adds `final_videos.slowmo_section_start` /
`slowmo_section_end`. Two call sites name them explicitly, so both 500 on a below-v025 DB:

| Site | Code | Path | Reachability |
|---|---|---|---|
| `app/routers/downloads.py:1438` | `SELECT id, filename, slowmo_section_start, slowmo_section_end FROM final_videos …` | `POST /publish/{project_id}` → `publish_to_my_reels` | publish gesture on a reel that already exists |
| `app/routers/export/overlay.py:186` | `INSERT INTO final_videos (…, slowmo_section_start, slowmo_section_end) VALUES (…)` | render/finalize | every export that materializes a final video |

T5970 deliberately left these because they are **deliberate export/publish gestures, not a
mass-on-load path** — the blast radius is one user's one action, not every user's bootstrap.
That reasoning is sound and is why this is Impact 7 and not 9. But it is still a 500 on a real
user gesture during the window, and the INSERT site in particular means **no export can complete
at all** until the migrate runs.

Fix both with the sanctioned `column_exists` pattern (`app/database.py:164`):
- SELECT site: omit the two columns and treat them as `NULL` during the window (the migration's
  own default is NULL, and the backfill is what populates them).
- INSERT site: omit both columns from the column list and the `VALUES` tuple during the window.
  **Do not** insert NULL into a column that does not exist. Watch the positional `VALUES`
  placeholders — the tuple must be rebuilt, not just the column list.

Do NOT invent a second guard mechanism. Do NOT blanket-guard columns T5970 classified as
"no guard needed" — its per-column justification is in the knowledge doc and is binding unless
you can show it is wrong, in which case say so explicitly.

## Part 2 — the structural guard (the durable half)

T5970's audit was a **one-time manual sweep**. The next `ADD COLUMN` someone writes reopens the
exact same hole, and nothing fails to warn them. That is the real defect.

Build a regression test that makes the window a *tested* property rather than a remembered one:

- Construct a profile DB at a **below-head** schema (mirror
  `tests/test_t5600_detections_data_migration.py` and T5970's
  `test_t5970_quest_shared_by_migration_window.py` — both are on master and are the precedent).
- Seed it **with real rows**, not just a schema. Memory `reference_migration_runner_rowfactory`
  records a migration that passed schema-only tests and still crashed on real rows for 4 prod
  users. A schema-only assertion is not acceptable evidence here.
- Drive the hot-path reads (bootstrap/quests, games list, clips list, overlay-data, gallery /
  collections, publish, export finalize) and assert **no `OperationalError`**.

Design it so a NEW unguarded column is caught automatically where that is reasonable — e.g.
derive the below-head schema from the migration registry rather than hardcoding one version, so
adding v030 extends the coverage for free. If a fully-automatic form turns out to be more
indirection than it is worth (CLAUDE.md refactoring rule 6 prefers greppable explicitness over
registry magic), then say so and ship the explicit version with a comment naming the tradeoff —
that is an acceptable outcome, but it must be a stated decision, not an omission.

## Explicitly NOT in scope

- Running migrations against staging or prod. You have no credentials for either and must never
  target prod. The supervisor owns that.
- The GameTile recap-gating divergence T5990 surfaced — the user has accepted current behaviour.

## Watch out for

- `ensure_database()` (`app/database.py`) already contains every column in its base schema, so a
  **fresh** DB is always at head. Only a pre-existing below-head DB is at risk — your test must
  build one deliberately.
- `SELECT *` is safe; only an explicitly-named column crashes. Don't "fix" `SELECT *` sites.
- Perf: use the `query_counter` fixture (`tests/test_query_counter.py`) to prove you have not
  added a PRAGMA per row. One probe per request path is fine; one per row is a real regression.
- `migrations/__init__.py` carries pre-existing SIM102 ruff debt — do not fix unrelated files,
  just add no new violations.

## Acceptance criteria

1. Both v025 call sites guarded, with a red-first test proving each 500s before and 200s after,
   driven against a below-v025 DB **containing rows**.
2. The export/finalize INSERT path proven to complete on a below-v025 DB (this is the one that
   blocks all exports, so it needs its own explicit evidence).
3. A structural regression test covering the hot-path reads against a below-head DB, with a
   stated decision on whether it auto-extends to future migrations.
4. `query_counter` evidence that statement count per path stays flat.
5. Full backend suite green. **Baseline on merged master 2026-07-27: 2396 passed, 16 skipped,
   0 failed.** Any new failure is yours.
6. `.claude/knowledge/backend-services.md` updated: v025 moves from "documented residual" to
   "guarded", and the structural guard is recorded so the next task does not re-derive it.
