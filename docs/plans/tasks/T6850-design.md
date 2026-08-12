# T6850 Design — Remove "Minimum reel length" setting + data

**Task:** Remove the dead `intro_min_duration_seconds` ("Minimum reel length")
setting end-to-end — UI, store, endpoints, service helpers, schema column (via a
v043 drop-column migration), and stale design comments.

**Tier:** L (schema change + ~13 files). **Status of this doc:** awaiting approval
(design gate). No implementation code written past this doc.

---

## 1. Why (recap, not re-litigated)

`user_settings.intro_min_duration_seconds` (T5215, profile_db **v041**) gated the
*inherit-the-default-intro* path: don't prepend the profile default intro to a
reel/collection shorter than the threshold. **T6680** removed the default/inherit
concept entirely — every intro is now explicitly attached per reel/collection
(`resolve_intro_card_id`: `0 → None`, `id → id`, `NULL → None`, no duration gate).
The threshold has gated nothing since. It still renders in Manage Profile,
round-trips through two endpoints, and occupies a `NOT NULL` column — pure dead
weight. Remove it.

---

## 2. Current state (what reads/writes this datum today), file:line

**Confirmed by Stage-1 grep: there is NO surviving attachment/resolution-path
consumer.** `get_intro_min_duration` is imported/called only by the settings
endpoint in `profiles.py` and by tests. The task file's core claim holds.

### Frontend
- `src/frontend/src/components/ProfileIntroSection.jsx`
  - `IntroMinDurationInput` component + its doc comment — **L228-300**
  - render site — **L205**: `{profile.isCurrent && <IntroMinDurationInput onError={setError} />}`
- `src/frontend/src/stores/introCardStore.js`
  - `minDuration`, `isMinDurationLoading` state (**L144-151**), `fetchMinDuration`
    (**L153-164**), `updateMinDuration` (**L166-184**), `minDuration: null` in
    `reset` (**L186**)
- `src/frontend/e2e/T5215-intro-attachment.qa.spec.js`
  - whole test `'f: Manage Profile -> Player Intro threshold input …'` — **L428-472**
  - header-comment item `f.` — **L21**
  - (note: L434 already asserts label text `'Minimum reel length for the default
    intro'`, which no longer matches the live JSX label `'Minimum reel length'` —
    a pre-existing stale assertion; moot since the block is deleted)

### Backend
- `src/backend/app/routers/profiles.py`
  - imports `get_intro_min_duration` (**L28**), `validate_intro_min_duration` (**L30**)
  - `UpdateIntroMinDurationRequest` (**L267-268**), `GET /current/intro-min-duration`
    (**L271-283**), `PATCH /current/intro-min-duration` (**L286-313**)
- `src/backend/app/services/intro_cards.py`
  - `DEFAULT_INTRO_MIN_DURATION_SECONDS` + doc comment (**L159-164**),
    `INTRO_MIN_DURATION_LOWER/UPPER` (**L169-170**), `get_intro_min_duration`
    (**L241-254**), `validate_intro_min_duration` (**L257-270**)
  - `from app.database import column_exists` (**L29**) — becomes **unused** after
    the two helpers go (only use is L248); remove it (lint-blocking otherwise)
  - stale collection resolution-order comment (**L354-360**): still documents "the
    duration gate on a collection's OWN inherit-the-default path uses … the SAME
    per-profile `intro_min_duration_seconds`" — rewrite to the post-T6680
    explicit-only model
  - stale attachment-resolution header comment referencing the setting fallback
    (**L159-163**) — removed with the constant
- `src/backend/app/database.py`
  - `intro_min_duration_seconds REAL NOT NULL DEFAULT 20.0` in the `user_settings`
    fresh DDL (**L1266**) + its explanatory comment (**L1254-1260**)
  - `PRAGMA user_version` head at **L1419** is `PROFILE_DB_RUNNER.latest_version`
    — **auto-derives** to 43 once v043 registers; no manual bump needed

### Backend tests (3 files — LARGER than the kickoff's "comment-drift check" note)
- `src/backend/tests/test_t5215_intro_attachment.py`
  - `TestThresholdStorage` (**L153-187**), `TestProfileThresholdEndpoint`
    (**L190-227**), `TestMigrationV041` (**L234-296**) — all min-duration-specific;
    delete. Imports at **L26-29** (`DEFAULT_INTRO_MIN_DURATION_SECONDS`,
    `get_intro_min_duration`, `validate_intro_min_duration`) become unused; remove.
  - `test_collection_freeze_is_never_duration_gated` (**L638+**) sets the dropped
    column at **L648-649** — remove that setup UPDATE + the stale "would block a
    NULL/inherit reel resolution" comment; **keep** the frozen-collection-resolves
    assertion (its real point).
- `src/backend/tests/test_t6030_migration_window_structural_guard.py`
  - `POST_V023_COLUMNS["user_settings"] = ["intro_min_duration_seconds"]` (**L60**)
    — remove the entry (the column no longer exists at head, so the fixture's
    `ALTER TABLE … DROP COLUMN` at L119 would itself error)
  - the v041 audit note (**L87-93**) — replace with a v043 note (drop migration,
    adds no column → nothing to guard)
  - `test_profile_intro_min_duration` (**L314-334**) — delete (imports the removed
    endpoints/const)
  - `HEAD_VERSION_AUDITED = 42` (**L98**) → **43**
- `src/backend/tests/test_t5195_migration_v034.py`
  - `test_registry_head_is_v042` (**L131**) asserts `max(m.version) == 42` (**L140**)
    — this is a **hard assertion**, not comment drift. Rename → `_v043`, bump →
    `== 43`, add a T6850/v043 line to the comment. L148 (`count(42) == 1`) stays
    valid (v042 still unique).

Other head-version references (`test_t4890`, `test_t5090`, `test_t5410`,
`test_t2930`, `test_t6340`, `test_migration_runner`, `test_t5970`, etc.) use the
**dynamic** `RUNNER.latest_version` and auto-adjust — no change needed. The only
files hardcoding `42` are the three above.

---

## 3. Target state

- No "Minimum reel length" control anywhere in Manage Profile.
- `GET`/`PATCH /api/profiles/current/intro-min-duration` removed (**404**).
- `intro_min_duration_seconds` absent from the fresh-DB DDL **and** dropped from
  migrated profile DBs via **v043**.
- No `intro_min_duration` / `minDuration` reference left in `src/` (grep-clean,
  archived docs excluded).
- `resolve_intro_card_id` / `resolve_intro_card` / collection resolution comments
  describe only the post-T6680 explicit-attach model.
- Registry head = **43**; all head-version tests green at 43.

---

## 4. Migration plan — v043 (profile_db, drop column)

**Number: v043** — collision-checked (see §6): free. Head is v042; v037/v039 are
burned (T6345 renumber history); v043 is the next slot.

New file `src/backend/app/migrations/profile_db/v043_drop_intro_min_duration.py`,
mirroring v041's guard shape **in reverse** (the runner hands `up(conn)` a *tuple*
row factory, so `PRAGMA table_info` is read positionally as `row[1]`):

```python
class V043DropIntroMinDuration(BaseMigration):
    version = 43
    description = "Drop dead user_settings.intro_min_duration_seconds (T6850; gate removed by T6680)"

    def up(self, conn) -> None:
        has_user_settings = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_settings'"
        ).fetchone()
        if not has_user_settings:
            return
        cols = {row[1] for row in conn.execute("PRAGMA table_info(user_settings)").fetchall()}
        if "intro_min_duration_seconds" in cols:          # absent-column-safe (idempotent)
            conn.execute("ALTER TABLE user_settings DROP COLUMN intro_min_duration_seconds")
            logger.info("[v043] dropped user_settings.intro_min_duration_seconds")
```

Register in `migrations/profile_db/__init__.py`: import `V043DropIntroMinDuration`
and append `V043DropIntroMinDuration()` to `MIGRATIONS` (last entry → `latest_version`
becomes 43 automatically).

- **SQLite `ALTER TABLE … DROP COLUMN`** needs 3.35+ — container is **3.46.1** (verified). Prod runtime is the same image.
- **Idempotent / absent-column-safe**: the `if "…" in cols` guard makes a re-run
  (or a fresh DB that never had the column) a silent no-op — the reverse of v041's
  `if not in cols` add guard.
- **Self-sufficient**: pure schema introspection + one DDL; no data prerequisites,
  no fallback to raw sources.

### Ordering / skew safety (confirming task file, not re-deriving)
Code stops reading the column FIRST, in the **same deploy** the migration ships in;
the migration drops it after (admin `POST /api/admin/migrate`, never auto-run).
- New code (reads removed entirely) + un-migrated DB (column still present) → fine.
- New code + migrated DB (column gone) → fine.
- Old code never coexists with the dropped column post-deploy.
Because today's reads are already `column_exists`-guarded and we are *removing* the
reads outright, there is no window in which live code SELECTs a missing column.

---

## 5. Tests (Stage 3, red-first) — plan

- **New** `src/backend/tests/test_t6850_drop_intro_min_duration.py`:
  - column present on a below-head DB → dropped after `V043DropIntroMinDuration().up()`
  - already-absent column → `up()` is a no-op, no error (idempotent, re-run twice)
  - full-registry run on a below-v041 DB ends with the column **absent** and
    `user_version == 43`
  - endpoint-removal: importing `get_current_intro_min_duration` /
    `update_current_intro_min_duration` / `UpdateIntroMinDurationRequest` from
    `app.routers.profiles` raises `ImportError` (routes gone → 404 at runtime)
- Edits to `test_t5215`, `test_t6030`, `test_t5195` per §2.
- **Frontend unit**: prune/adjust any `ProfileIntroSection` / `introCardStore` unit
  test asserting the field (Stage 3 will grep the unit specs; none surfaced in the
  Stage-1 `src` sweep beyond the e2e block, but confirm before implementing).

Relevant run set (never the full suite): `test_t6850_drop_intro_min_duration.py`,
`test_t5215_intro_attachment.py`, `test_t6030_migration_window_structural_guard.py`,
`test_t5195_migration_v034.py`, `test_migrations.py` (dynamic head guard), plus the
touched frontend unit specs + the e2e spec compile.

---

## 6. Risks

1. **Version-number collision (checked now).** `git branch -a` shows only
   `master`, `origin/master`, and this task branch — **no in-flight sibling
   migration**. `git log --all` for added `v04*` migration files shows only the
   already-merged v040/v042 (and the c82c108 v039→v042 renumber). No ref defines a
   v043. **v043 is free.** (History confirms the standing hazard is real —
   v037→v041 and v039→v042 both renumbered — but nothing competes for 43 today.)
2. **Three tests hardcode head 42** (`test_t5195`, `test_t6030`, `test_t5215`
   fixture). All three are in §2's edit list; missing any turns Branch CI red. This
   is the main "gotcha" beyond the kickoff's file estimate.
3. **`column_exists` becomes an unused import** in `intro_cards.py` — remove it in
   the same edit or the lint hook blocks the commit.
4. **t6030 fixture breakage** if the `POST_V023_COLUMNS["user_settings"]` entry is
   left in: `_build_below_head_db` would `DROP COLUMN` a column that no longer
   exists at head and raise. Must remove the entry, not just the standalone test.
5. **Low blast radius otherwise** — net-removal, no new abstraction, no data
   preserved (the value gated nothing). No R2/sync/CAS surface touched.

---

## 7. Knowledge-base note (Stage 7)

`backend-services.md` covers the 3-track migration system. The collision-check
turned up nothing new to record beyond the already-known "always check sibling
branches before pinning a version" rule, so no doc change is anticipated unless
implementation surfaces something. Will confirm at Stage 7.

---

## DESIGN GATE — STOP

This is the mandatory L-tier design-gate stop. **Approve to proceed** to Stage 3
(tests) + Stage 4 (implementation). No implementation code has been or will be
written until an explicit resume from the supervisor.
