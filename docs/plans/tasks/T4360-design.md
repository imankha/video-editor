# T4360 — Explicit Orderings: BEGIN IMMEDIATE + Invariant Tests (Design)

**Tier:** M (by exception — backend-only, no schema change, but design-gated because it pins a DB-level correctness invariant across three handlers).
**Layers:** Backend only.
**Knowledge doc:** `.claude/knowledge/persistence-sync.md` (invariants #3, #6; T6402 section).

This is a **mechanism-confirmation** design, not a product-scope decision. Two concrete code changes (BEGIN IMMEDIATE at two action endpoints) + one test-only change (activation invariants). No option-invention.

---

## 1. Current State (confirmed against master)

### Connection model — `database.py:1451` `get_db_connection`
- Every request gets a **fresh** `sqlite3.connect(str(get_database_path()), timeout=30)` (line 1467) — not pooled — wrapped in `TrackedConnection`.
- Pragmas: `journal_mode=WAL` (1471), `busy_timeout=30000` (1473), `foreign_keys=ON` (1475).
- **`isolation_level` is never set** → Python module default `""`. Under this default the sqlite3 module issues an implicit `BEGIN DEFERRED` **only** immediately before the first DML (INSERT/UPDATE/DELETE/REPLACE). A bare `SELECT` acquires **no lock**.
- Python is **3.11.15** — legacy sqlite3 transaction control; there is **no** `Connection.autocommit` (3.12+). No `BEGIN IMMEDIATE` / `isolation_level` / explicit-`BEGIN` precedent anywhere in `app/`.
- The `with get_db_connection()` block ends in `finally: conn.close()` (1484-1485). SQLite rolls back any open (uncommitted) transaction on `close()`.

### The atomicity gap (Decision 1 crux)
Two concurrent requests can each `SELECT` the same blob (neither takes a lock under `BEGIN DEFERRED`), each mutate in Python memory, and each `UPDATE`+commit — **last writer silently wins (lost update)**. It is safe *today* **only** because there is no `await` between the read and the commit inside a single coroutine, so the event loop cannot interleave two in-flight requests across that span. That is a Python-scheduling accident (persistence-sync.md **invariant #6**), **not** a DB guarantee. One added `await` — or moving DB work to a threadpool — reopens the race.

### RMW spans (exact commit/return points — all must be covered)
- **`clips.py framing_action`** (async def :420): `with get_db_connection()` :447 → read `_get_clip_framing_data` :451 → pure conflict check :459 → mutate :463-704 → commit at multiple exits:
  - `set_rotation` early returns: commit **:691** then return :693; commit **:699** then return :701.
  - normal path: `_save_clip_framing_data` (commits at :392 or :400) called at :707, returns :708.
  - Exception handlers **:710-715** catch `ValueError`/`Exception` and **`return` a JSONResponse without re-raising** — so on error the txn is left uncommitted and rolled back by `finally: conn.close()`.
- **`overlay.py overlay_action`** (async def :608): `with get_db_connection()` :635 → read `_get_overlay_data` :639 → pure conflict check :649 → mutate → commits at:
  - text-overlay sub-branches, each `_save_text_overlays` + `conn.commit()` then early `return` (:1103 confirmed; sibling branches at :988/:1012/:1034/:1052/:1081 per Code Expert).
  - highlight path: `_save_overlay_data` :1110 (does **not** self-commit) + `conn.commit()` :1111, return :1113.
  - Exception handlers **:1119-1134** catch and `return` without re-raising (same rollback-on-error behavior).

### `activate_game` (games.py :575-789) — NOT an RMW fix
Deliberate, comment-hardened (bug26p) ordering that **intentionally spans multiple transactions and connections**:
- read-only until a mid-handler `conn.commit()` at **:735** (metadata backfills) whose sole purpose is to release the writer lock so `insert_game_storage_ref` (opens its **own** connection) can't self-deadlock;
- storage refs written **:740-745**;
- credit deduction **:751** (`deduct_credits`, **idempotent** on `(source='game_upload', reference_id=game_id)`; credits live in **Fly Postgres**, T5840 — a different datastore from the SQLite status);
- status flip → READY + final commit **:764-768**;
- self-heal-on-already-ready branch **:591-603**.
**No BEGIN IMMEDIATE here** — a single enclosing IMMEDIATE txn would deadlock against `insert_game_storage_ref`'s nested connection. T4360's job for games.py is **invariant-pinning-by-test only** (restructure is T4640).

---

## 2. Target State

- Both action endpoints hold an **explicit `BEGIN IMMEDIATE` write transaction** spanning read→mutate→commit, so the RMW is atomic at the **DB level**, independent of Python scheduling. A second concurrent writer's `BEGIN IMMEDIATE` blocks on the RESERVED lock up to `busy_timeout` (30s), then either succeeds (serialized — both edits survive) or surfaces `database is locked` (never a silent lost update).
- Each endpoint carries a one-line invariant comment naming this guarantee (per the task file).
- `activate_game` is unchanged; its bug26p ordering claims become executable assertions.

---

## 3. Decisions

### Decision 1 — explicit-transaction mechanism: **`conn.execute("BEGIN IMMEDIATE")` immediately after opening, `isolation_level` left at `""` (option a)**

Issue `conn.execute("BEGIN IMMEDIATE")` as the **first statement** after `cursor = conn.cursor()`, before the read.

**Why it works under Python 3.11 legacy control:** the implicit `BEGIN DEFERRED` the module would otherwise emit fires only immediately before the first DML *and only when `conn.in_transaction` is False*. Issuing `BEGIN IMMEDIATE` explicitly at the top (before any DML has run) sets `in_transaction = True`, so the module sees an open transaction and **does not** issue a competing implicit BEGIN. The existing `conn.commit()` calls then correctly commit the IMMEDIATE transaction (a `commit()` clears `in_transaction`; there is no second implicit txn to strand). On the exception paths (which `return` without re-raising), the transaction stays open and `finally: conn.close()` rolls it back — **no half-committed state**, verified against both handlers' catch-and-return structure.

**Rejected — (b) `conn.isolation_level = None` (manual mode) + explicit BEGIN/COMMIT:** correct but heavier. It changes the connection's transaction semantics for the whole block and would require auditing that *every* existing `conn.commit()` in the handler still pairs with a live txn (manual mode makes each statement its own implicit txn unless a BEGIN is open). Since option (a) already gives the same DB guarantee without touching module semantics, (b) adds fragility for no benefit. Its failure mode: if any code path in the block runs a statement while no BEGIN is open, that statement autocommits alone — silently breaking atomicity exactly where we're trying to enforce it.

**Rejected — (c) context-manager helper:** see Decision 2.

**Reconciliation with existing commits:** unchanged. Every `conn.commit()` already in both handlers commits the now-explicit IMMEDIATE txn. No commit is added or removed. The only new statement is the single `BEGIN IMMEDIATE` at the top of each handler.

### Decision 2 — inline vs helper: **inline `conn.execute("BEGIN IMMEDIATE")` at both sites**

Exactly **two** call sites. CLAUDE.md: *abstract on the 3rd duplication, never the 1st*; *greppability beats elegance*. The mechanism under option (a) is a **single, self-contained line** — no `isolation_level` toggling, no rollback plumbing (rollback is already handled structurally by the existing `finally: conn.close()`). A helper would hide one grep-able line behind a name for two call sites while adding nothing auditable. **Inline it**, each with the invariant comment the task file requires, e.g.:

```python
# T4360: BEGIN IMMEDIATE takes SQLite's RESERVED lock before the read, so this
# read-modify-write is atomic at the DB level — a concurrent writer blocks (up to
# busy_timeout) instead of silently losing an update. Do NOT rely on the no-await
# accident (persistence-sync.md invariant #6); this guarantee is lock-based.
conn.execute("BEGIN IMMEDIATE")
```

### Decision 3 — activation invariants as testable assertions

Convert bug26p comment claims into checkable assertions. Precise guarantees from the confirmed code:

1. **No `ready`-without-ref.** Storage refs (:740-745) are written **before** the status flip (:764-768). A crash between them leaves the game `pending` with refs present (harmless; refs are idempotent per hash). → **Assert:** after activate, every `ready` game has ≥1 `game_storage` ref; and a crash injected *after* ref-write but *before* the status commit leaves status `pending` (never `ready`-without-ref). The self-heal branch (:591-603) backstops any legacy `ready`-without-ref.

2. **Credit/status crash window — REAL, NARROW, DOCUMENTED (not a silent gap).** Credit deduction (:751, **Postgres**) precedes the final status-flip commit (:764-768, **SQLite**). These are two datastores, **not one atomic unit**. A crash in that window leaves **credits charged but status still `pending`**. This does **not** literally satisfy the task's aspirational phrasing "credit deduction happens iff activation completed." The mitigating fact: `deduct_credits` is **idempotent** on `(source='game_upload', reference_id=game_id)`, so re-activating the still-`pending` game re-runs deduct (no double-charge) and completes the flip → the window is **self-healing on retry**, and a charged-but-pending game is recoverable, not corrupt. → **Assert (documenting today's behavior, not encoding it as ideal):** (a) happy path: after activate → status `ready` AND ≥1 storage ref AND exactly one credit deduction; (b) crash-between-datastores: credits deducted once, status `pending`, and a **re-activation** yields `ready` with still exactly one deduction (idempotency proven). This is flagged in Open Questions rather than silently blessed.

3. **Every `ready` game has a `game_storage` ref** (the bug26p invariant) — asserted as in (1), with the self-heal branch covering pre-existing violations.

### Decision 4 — contention / busy_timeout behavior

Acceptance "No measurable contention regression (busy_timeout behavior documented)" requires: under the two-writer race-detector, the second `BEGIN IMMEDIATE` **blocks-then-succeeds** (serialized; both edits survive) or, if it exceeds `busy_timeout` (30s), raises `sqlite3.OperationalError('database is locked')` — **never** a silent lost write. On that error the handler must **surface a retryable failure** (e.g. a 503 / `database_locked` response), **not swallow it** — aligning with the no-silent-fallback rule. Under normal single-gesture load (one writer at a time) there is no added contention: IMMEDIATE only takes the RESERVED lock the very first DML would have taken microseconds later anyway. Context: T6402 single-process assumption (per-process `get_upload_lock`) — this lock guarantee holds within one process; cross-process contention on the same user DB is out of scope (single Fly machine per user session).

---

## 4. Implementation Plan

| File | Span | Change |
|------|------|--------|
| `clips.py` | after :448 (`cursor = conn.cursor()`), before read at :451 | Insert invariant comment + `conn.execute("BEGIN IMMEDIATE")`. Covers ALL exits: :691/:699 (set_rotation), :392/:400 (`_save_clip_framing_data`). No commit changes. |
| `overlay.py` | after :636 (`cursor = conn.cursor()`), before read at :639 | Insert invariant comment + `conn.execute("BEGIN IMMEDIATE")`. Covers ALL text-overlay sub-branch commits AND the highlight commit at :1111. No commit changes. |
| `overlay.py` / `clips.py` | exception handlers (:1119-1134 / :710-715) | **No code change needed** — they already `return` without re-raising, so the open IMMEDIATE txn is rolled back by `finally: conn.close()`. Add a one-line comment noting rollback-on-error relies on close(). |
| `games.py` `activate_game` | :575-789 | **No change.** Multi-txn/multi-connection ordering is intentional (would deadlock under an enclosing IMMEDIATE). Pinned by tests only. |
| (optional) `clips.py` / `overlay.py` | around the write | If a `sqlite3.OperationalError('database is locked')` can propagate from the commit under contention, catch it explicitly and return a retryable 503 rather than the generic 500 — so the busy-timeout outcome is a named, retryable error (Decision 4). |

Post-change sanity: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`.

---

## 5. Test Plan

**New tests**

1. **Lost-update race detector (must go RED on unpatched code, GREEN after the fix).**
   Harness: two-writer threadpool against a real profile DB (reuse the `ensure_database` + `tmp_path` + `R2_ENABLED=False` fixture pattern from `test_game_activate_consistency.py`). Each worker replicates the handler's read→mutate→write on the same clip/project; inject a barrier/`sleep(0)` between read and write so both threads read before either writes. Under **`BEGIN DEFERRED` (today)** both commit and the later writer clobbers the earlier → assertion "both edits survive" **FAILS** (proves detection). Under **`BEGIN IMMEDIATE`** the second writer blocks on RESERVED until the first commits, re-reads, and both edits survive → **PASSES**. The task also requires the alternate proof: adding an `await asyncio.sleep(0)` between read and write in an action handler makes a test fail on old code — include that as a documented variant driving two overlapping real requests.

2. **Activation invariant tests** (reuse `test_game_activate_consistency.py` seeding + `insert_game_storage_ref`/`deduct_credits` stubbing, and the crash-injection style in `test_t4310_r2_cas_conflict.py` / `test_t4315_restore_on_staleness.py`):
   - happy path: after activate → status `ready` AND ≥1 `game_storage` ref AND exactly one credit deduction.
   - crash between datastores (Decision 3.2): patch to raise after `deduct_credits` (:751) before the status commit (:768) → assert credits deducted once, status `pending`; then re-activate → `ready`, still one deduction (idempotency).
   - `ready`-without-ref cannot persist: crash after ref-write before status commit → status stays `pending` (refs present, harmless); plus the self-heal branch heals a seeded legacy `ready`-without-ref game.

**Existing regression tests that must still pass** (relevant set — not the full suite):
`test_overlay_actions.py`, `test_framing_actions.py`, `test_framing_action_version_conflict.py`, `test_t5225_overlay_text_actions.py`, `test_game_activate_consistency.py`.

---

## 6. Risks

| Risk | Mitigation |
|------|------------|
| **Contention regression** — IMMEDIATE serializes concurrent writers to one user DB | Single-gesture load has one writer; IMMEDIATE only takes the RESERVED lock the first DML would take anyway. `busy_timeout=30000` absorbs bursts; overflow surfaces as a named retryable error (Decision 4), never a silent loss. |
| **`isolation_level=""` fragility** — mixing implicit-BEGIN management with explicit BEGIN | Option (a) issues BEGIN IMMEDIATE **before any DML/implicit BEGIN**; `in_transaction=True` suppresses the module's implicit BEGIN. Verified against every commit/return path in both handlers. |
| **Multi-datastore credit crash window** (SQLite status vs Postgres credits) | Not closed by T4360 (would need T4640's restructure). Bounded by `deduct_credits` idempotency; documented + tested as recoverable-on-retry, and surfaced as an Open Question. |
| **T6402 single-process assumption** | Lock/atomicity guarantee holds within one process (per-process `get_upload_lock`, one Fly machine per user session). Cross-process contention out of scope. |
| **Rollback-on-error depends on `finally: conn.close()`** | Both handlers already `return` (not re-raise) on error, leaving the IMMEDIATE txn open for `close()` to roll back. Add a comment so a future edit doesn't add a stray mid-handler commit. |

---

## 7. Open Questions

- [ ] **Credit/status crash window (Decision 3.2):** the code guarantees *credits-charged-but-pending is recoverable via idempotent re-activation*, **not** the literal "credit deduction happens iff activation completed." T4360 pins this as-is (restructure to one atomic unit is T4640). **Confirm** we test/document today's recoverable-window behavior rather than treating the window as a bug to fix now.
- [ ] **`database is locked` UX:** confirm returning a **retryable 503** on busy-timeout overflow at the action endpoints is acceptable (vs. the generic 500), so the client can auto-retry the gesture.
