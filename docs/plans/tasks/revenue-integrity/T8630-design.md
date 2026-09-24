# T8630 Design — Deletion preserves the financial record and is auditable

**Epic:** Revenue Record Integrity (2/6) — see [EPIC.md](EPIC.md)
**Task:** [T8630-deletion-preserves-financial-record.md](T8630-deletion-preserves-financial-record.md)
**Depends on:** T8620 (APPROVED, STAGING) — the `payments` table + `payments_ledger.py`.
See [T8620-design.md](T8620-design.md) §3 (append-only), ruling 2, §4a (`fill_missing_charge_id`).
**Status:** (see bottom)
**Author:** Architect
**Date:** 2026-09-24
**Branch:** feature/T8630-deletion-preserves-financial-record

This doc confirms/refines the schema in the task file, resolves the decisions the task
left open, and specifies contracts precisely enough that the implementor adds no design
judgement. Mechanical details (exact param tuples) are left to implementation except where
the exact shape is load-bearing. All line numbers verified against master `1ff3962b`.

**Classification:** Tier L (already produced; not reproduced here). Agents: Architect
(this doc), Tester Phase 1, Implementor, Migration, Reviewer.

---

## Approved rulings 2026-09-24

The user approved this design with the following rulings. They supersede the sections
named below; the rest of the doc stands as written.

**A. `account_deletions` primary key (design bug fix).** `user_id TEXT PRIMARY KEY` is
wrong: `_reset_test_account` re-creates the same `user_id`, so a second reset of the same
test account would hit a duplicate-key error inside the delete transaction. Fixed to
`id BIGSERIAL PRIMARY KEY` plus an index on `(user_id, deleted_at)` — one row per deletion
event, not one row per user. Supersedes §3.1's schema, §3.2's `ON CONFLICT (user_id) DO
NOTHING`, §5.4's diagram text, and §8's DDL (see the corrected blocks in place below). A
new test proves two resets of the same test account write two audit rows and both succeed
(§11, T2 amendment).

**B. Legal wording fix.** Nowhere may the copy call the retained record "not personal
data" — pseudonymous data is still personal data under GDPR Recital 26. The
`data-retention-policy.md` "What IS Retained" sentence (§7.4) is corrected to: "It is a
pseudonymous financial record with no name, email, or card details, and retaining it never
delays or limits the erasure of your other personal data." No other changed surface
(`PrivacyPolicy.jsx`, `docs/legal/privacy-policy.md`, `AccountSettings.jsx`) makes the
"not personal data" claim, so §7.1-7.3 stand as written.

**C. In-app delete confirmation — exact text ruling.** `AccountSettings.jsx`'s confirmation
copy is fixed verbatim (supersedes §7.1's AFTER text):

> This permanently deletes your account and all personal data. This cannot be undone. We
> keep a record of past payments (amounts and dates only, with no name, email, or card
> details) to meet tax and accounting obligations.

§7.2 (`PrivacyPolicy.jsx`) and §7.3 (`docs/legal/privacy-policy.md`) stay as proposed,
apart from applying ruling B where it recurs.

**Open Questions 1-5, resolved (§10):**
1. `_reset_test_account`: write the audit row, do **not** stamp `payments` rows (Option A,
   as recommended).
2. Actor for the reset path is `self` (as recommended).
3. Ship the TRUNCATE guard now, with the `SET LOCAL reelballers.allow_payments_purge`
   escape hatch and the specified conftest change (as recommended).
4. No trigger on `account_deletions` — out of scope (as recommended).
5. Reserve the `admin` actor value; no code in this task may emit it (as recommended).

**Extra (handed over from T8650, which could not touch `pg.py`):** in `src/backend/app/services/pg.py`
`_SCHEMA_DDL`, add a comment on `user_segments.total_spent_cents` stating it is a per-user
DISPLAY CACHE, and that `payments` is the financial record every aggregate reads (T8650).
Comment only, no DDL change — unrelated to this task's own DDL additions in §8.

---

## 1. Current state (the holes)

T8620 shipped the `payments` ledger, but **nothing writes `account_deleted_at`** (the
column exists, reserved and inert — `pg.py:408`, `v030_payments_ledger.py:28`), and
**no delete path knows the ledger exists**. Two independent holes:

**Hole 1 — deletion is blind to the revenue record.** Three code paths delete a `users`
row; none checks for, warns about, stamps, or preserves any financial record:

| # | Path | File:line | Actor / path label | Transaction seam for the stamp+audit |
|---|------|-----------|--------------------|--------------------------------------|
| 1 | `delete_account` (CCPA self-serve, reachable from `AccountSettings.jsx:57`) | `privacy.py:227` | actor=`self`, path=`privacy_endpoint` | step 2's `with get_pg() as conn:` block (`privacy.py:261`), before `DELETE FROM users` at `:269` |
| 2 | `_reset_test_account` (NUF test-reset emails on login) | `auth.py:154` | actor=`self`(?), path=`reset_test_account` | its `with get_pg()` block (`auth.py:161`), before `DELETE FROM users` at `:177` |
| 3 | `delete_one` in the standalone script | `scripts/delete_user.py:176` | actor=`script`, path=`delete_user_script` | its own `pg_conn` cursor (`RealDictCursor`), committed once in `main()` at `:302` |

All three call `_purge_user_data(user_id)` (`auth.py:79`) FIRST. That shared helper purges
R2 / local / caches / sessions / credits / `game_storage_refs` / `upload_failures` in **its
own separate `get_pg()` transaction** (`auth.py:118-138`) which commits before the caller's
`DELETE FROM users` block runs. Per the task's Technical Notes and knowledge-doc Invariant 0,
`_purge_user_data` **must stay stamp/audit-free** — it is shared by a fourth caller,
`DELETE /api/auth/user` (`auth.py:259`), which purges data but NEVER deletes the users row
(test cleanup, account stays alive). That endpoint therefore gets **no stamp and no audit
row**, correctly. The stamp + audit go in the three callers that actually delete the users row.

**Hole 2 — no record that a deletion happened.** After the 2026-09-03 prod deletion we could
not determine who deleted the account, when, or via which path; the only forensic residue was
two tables (`user_usage_daily`, `impersonation_audit`) that every delete path happens to miss.
Reconstructing an incident from tables nobody remembered to clean is luck, not an audit trail.

The research (EPIC.md §"How this is normally handled") is unambiguous: financial records are
the category erasure rights explicitly carve out (tax/AML legal-obligation exemption), and the
deletion event itself is exactly what a controller is expected to be able to evidence.

---

## 2. Target state (summary)

1. A new `account_deletions` Postgres table (append-only by convention) records one row per
   users-row deletion: user_id, when, actor, path, whether it had payments, net cents, note.
2. On each of the three real delete paths, in the SAME transaction as `DELETE FROM users`:
   (a) STAMP `payments.account_deleted_at = now()` for that user_id (idempotent, gated on
   `IS NULL`); (b) INSERT the `account_deletions` audit row.
3. A DB-level **append-only trigger** on `payments` (the T8620 ruling-2 carry-over) that
   raises on any DELETE and on any UPDATE except the two whitelisted in-place writes.
4. `scripts/delete_user.py` grows a `--force-paid` guard: a paying target is refused (loudly,
   naming the retained record) unless the flag is passed; bulk modes pre-check every target
   and refuse the whole run before the first deletion.
5. Privacy copy (in-app confirmation + policy component + two legal markdown docs) states that
   transaction records are retained after deletion and why (tax and accounting obligation),
   in the existing T1740 voice.

**Non-goals** (§Non-goals below): live dispute webhook, reconciliation deleted-account cause
(T8640), revenue totals from the ledger (T8650), receipts (T8660), an `account_deletions`
trigger, deleting the two residue tables, automated refunds.

---

## 3. Section 1 — `account_deletions` schema + module home

### 3.1 Schema (refined from the task draft; PK corrected by Approved ruling A)

```sql
CREATE TABLE IF NOT EXISTS account_deletions (
    id           BIGSERIAL   PRIMARY KEY,
    user_id      TEXT        NOT NULL,
    deleted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    actor        TEXT        NOT NULL,   -- 'self' | 'admin' | 'script'
    path         TEXT        NOT NULL,   -- 'privacy_endpoint' | 'delete_user_script' | 'reset_test_account'
    had_payments BOOLEAN     NOT NULL,
    net_cents    INTEGER     NOT NULL DEFAULT 0,  -- SUM(payments.amount_cents) at deletion
    note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_deletions_user_id
    ON account_deletions (user_id, deleted_at);
```

**Column verdict vs the task draft:** the draft's `user_id TEXT PRIMARY KEY` is a bug, fixed
by ruling A — `_reset_test_account` re-creates the same `user_id`, so a second reset of the
same test account must be able to write a second row, not collide on a duplicate key. One
row per DELETION EVENT, not one row per user.

- `id BIGSERIAL PRIMARY KEY` with `user_id TEXT NOT NULL` plus an index on
  `(user_id, deleted_at)` — pseudonymous key, **no FK to `users`** (the users row is being
  deleted in the same transaction; a FK would make the audit insert impossible). The write
  is a plain `INSERT` (no `ON CONFLICT`): every real deletion legitimately produces its own
  row, including a second reset of the same test account (§11 T2 amendment covers this).
  **No email column** — the table answers "an account with this id was deleted, by whom, via
  which path, with how much money attached", all without personal data, which is what keeps
  the audit itself erasure-safe.
- `net_cents INTEGER` — `COALESCE(SUM(amount_cents), 0)` over that user's `payments` rows at
  deletion time. Signed (T8620 convention: purchases +, refunds/disputes −), so it is the true
  net revenue, not a gross count. INTEGER is safe (bounded well under 2^31).
- `had_payments BOOLEAN` — `EXISTS(payments for this user)`. Deliberately distinct from
  `net_cents != 0`: a fully-refunded payer has `had_payments=true, net_cents=0`, and the
  distinction matters for AC5 ("did it have money attached").
- `note TEXT` — nullable free text; a caller may pass a reason (e.g. `--force-paid` runs
  record `"forced past payment guard"`); NULL otherwise.

### 3.2 Module home — a NEW `services/account_deletions.py` (single writer of this table)

**Recommendation: create `src/backend/app/services/account_deletions.py` as the sole writer
of `account_deletions`**, exposing one cursor-taking function (modeled on T8620's
`add_usage_seconds`/`record_purchase` — takes an ALREADY-OPEN cursor so it joins the caller's
transaction):

```python
class DeletionActor(str, Enum):
    SELF = "self"
    ADMIN = "admin"
    SCRIPT = "script"

class DeletionPath(str, Enum):
    PRIVACY_ENDPOINT = "privacy_endpoint"
    DELETE_USER_SCRIPT = "delete_user_script"
    RESET_TEST_ACCOUNT = "reset_test_account"

def record_account_deletion(
    cur, *, user_id: str, actor: DeletionActor, path: DeletionPath, note: str | None = None
) -> None:
    # 1) read the ledger for this user: had_payments + net_cents (guarded so a pre-v030
    #    env with no payments table records had_payments=False, net_cents=0 — see §3.3)
    # 2) INSERT INTO account_deletions (...) VALUES (...)  -- plain INSERT, no ON CONFLICT
    #    (ruling A: PK is a BIGSERIAL id, so a second deletion of the same user_id, e.g. a
    #    second test-account reset, legitimately writes a second row, not a collision)
```

The `str, Enum` closed vocabularies (backend type-safety skill) mean a typo cannot silently
create a new actor/path value; `actor`/`path` are validated at the type boundary, not by a
magic string at the call site.

### 3.3 The STAMP helper lives in `payments_ledger.py` (sole writer of `payments`)

The `account_deleted_at` stamp is a write to the **`payments`** table, whose single-writer is
`payments_ledger.py` (T8620 invariant, and the grep AC depends on it). Put the stamp there,
NOT in `account_deletions.py`:

```python
def stamp_account_deleted(cur, user_id: str) -> int:
    # UPDATE payments SET account_deleted_at = now()
    #   WHERE user_id = %s AND account_deleted_at IS NULL
    # returns cur.rowcount (rows stamped this call). Gated on IS NULL for idempotency:
    # a re-run stamps nothing. This is the FIRST of T8620 ruling 2's two permitted
    # in-place writes; fill_missing_charge_id is the second.
```

**Why table-per-writer split (payments stamp in `payments_ledger.py`; audit insert in
`account_deletions.py`):** each Postgres table has exactly one owning module (the T8620
invariant, the credits/`credit_ledger.py` precedent, and the greppability rule). The append-only
grep AC — "the only `UPDATE payments` statements are `fill_missing_charge_id` and the
`account_deleted_at` stamp" — is verifiable only if the stamp lives in the payments module. The
audit table is a different table with a different owner. A single "deletion" service that wrote
BOTH would put an `UPDATE payments` outside `payments_ledger.py`, breaking the grep contract and
the single-writer invariant. So: `stamp_account_deleted` in `payments_ledger.py`,
`record_account_deletion` in `account_deletions.py`; each caller invokes both.

### 3.4 `payments`-table-absent guard (pre-v030 env)

Both the stamp and the audit's ledger read must tolerate an environment where `payments` does
not exist yet (prod is at v25 and owes v026..v031; this task's migration lands behind those, but
the CODE ships before the migration runs). Use the same `to_regclass` tolerance the codebase
already uses (`delete_user.py`'s `table_present`, `_purge_user_data`'s `upload_failures` guard):

- `stamp_account_deleted`: if `to_regclass('public.payments') IS NULL`, no-op return 0.
- `record_account_deletion`: if `payments` is absent, record `had_payments=False, net_cents=0`
  (there is no ledger to protect). The `account_deletions` table itself is created by THIS
  task's migration (v031), so its presence is guaranteed once the code that writes it deploys
  behind the migration; but for the same defense-in-depth, wrap the audit insert so a genuinely
  absent `account_deletions` table (deployed-but-not-migrated window) logs loudly and does not
  500 the user's erasure request — see §5 failure behavior.

---

## 4. Section 2 — the append-only trigger on `payments`

This is the T8620 ruling-2 carry-over (user-approved, not re-litigated). The trigger enforces
at the DB level what the grep AC enforces by convention: `payments` rows are append-only except
for exactly two whitelisted in-place writes.

### 4.1 What the trigger must block / allow

- **Any `DELETE`** → raise. (No `DELETE FROM payments` exists anywhere; the trigger makes it
  impossible.)
- **`UPDATE` of any immutable column** → raise. Immutable columns:
  `id, user_id, kind, amount_cents, currency, stripe_object_id, pack, credits, occurred_at,
  recorded_at, source`.
- **`UPDATE` of `stripe_charge_id`** → allow ONLY NULL→value (the `fill_missing_charge_id`
  path). A non-NULL→anything change raises.
- **`UPDATE` of `account_deleted_at`** → allow (this task's stamp). The stamp only ever sets
  NULL→`now()` (gated `WHERE account_deleted_at IS NULL`), but the trigger need not re-check
  that gate — allowing any `account_deleted_at` change is acceptable because the column is pure
  account-metadata that never affects revenue (T8650); the app-side `IS NULL` gate handles
  idempotency. Keep the trigger's `account_deleted_at` allowance unconditional for simplicity
  and greppability.

**Explicit per-column comparison, NOT dynamic reflection** (greppability rule: a reviewer can
read every guarded column by name). The trigger function is a `BEFORE UPDATE OR DELETE ... FOR
EACH ROW` function that, on UPDATE, compares `OLD.col IS DISTINCT FROM NEW.col` for each of the
eleven immutable columns and raises if any differ; special-cases `stripe_charge_id`
(raise unless `OLD.stripe_charge_id IS NULL`); and ignores `account_deleted_at`. On DELETE it
raises unconditionally. Use `RAISE EXCEPTION` with a clear message naming the violated rule
(e.g. `payments is append-only: UPDATE of amount_cents is forbidden`).

### 4.2 TRUNCATE — recommendation and exact conftest impact

**A row-level trigger does NOT fire on `TRUNCATE`.** `src/backend/tests/conftest.py:244` runs
`TRUNCATE ... payments` to reset the ledger between every `pg_conn` test. So a row-level
trigger leaves TRUNCATE unguarded, and blocking TRUNCATE requires a SEPARATE statement-level
`BEFORE TRUNCATE` trigger — which would then break the conftest TRUNCATE unless there is an
explicit bypass.

**Recommendation: SHIP the TRUNCATE guard, with a session-setting escape hatch.** A ledger that
can be silently emptied by `TRUNCATE payments` is not append-only in any meaningful sense (the
2026-09-03 incident is precisely "revenue vanished"). The guard closes that. Concretely:

- Add a statement-level `BEFORE TRUNCATE ON payments` trigger whose function raises UNLESS a
  session GUC opts out: `current_setting('reelballers.allow_payments_purge', true) = 'on'`.
  (The second arg `true` = `missing_ok`, so the setting being unset reads as NULL/empty, i.e.
  not `'on'`, i.e. the guard fires — the safe default.)
- The ONE legitimate purger is the test fixture. **Exact conftest change** at the TRUNCATE
  statement (currently `conftest.py:244`): split `payments` out of the shared TRUNCATE and
  wrap it (or wrap the whole TRUNCATE) so the session sets the GUC first, in the SAME
  transaction/session:

  ```python
  # was: cur.execute("TRUNCATE otp_codes, ..., upload_failures, payments")
  cur.execute("SET LOCAL reelballers.allow_payments_purge = 'on'")
  cur.execute("TRUNCATE otp_codes, r2_grace_deletions, impersonation_audit, "
              "pending_teammate_shares, game_ref_counts, daily_counters, "
              "upload_failures, payments")
  ```

  `SET LOCAL` scopes the opt-out to the current transaction only, so no production code path
  can inherit it. (`SET LOCAL` requires being inside a transaction; the conftest fixture's
  `setup` connection is already in one — confirm at implementation; if not, use plain `SET`
  on that throwaway setup connection, which is closed immediately after at `conftest.py:255`.)
- A deliberate audited maintenance op that ever needs to purge (none is planned) would set the
  same GUC explicitly — the escape hatch is named and greppable (`reelballers.allow_payments_purge`).

**Alternative considered (defer TRUNCATE guard):** ship only the row-level DELETE/UPDATE guard
now, leave TRUNCATE unguarded. Rejected as the recommendation because it leaves the single
easiest way to destroy the whole ledger wide open, and the conftest change is small and
self-contained. Flagged as an Open Question (§10) in case the user prefers the smaller diff.

### 4.3 DDL location + idempotency (byte-for-byte mirror)

The trigger DDL (both function and trigger objects) must be **byte-for-byte identical** in the
v031 migration's `up()` AND in `pg.py` `_SCHEMA_DDL` (reviewer checks equality, per the v030
precedent). To make both the migration `up()` and the fresh-deploy DDL idempotent, use:

```sql
CREATE OR REPLACE FUNCTION payments_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments is append-only: DELETE is forbidden';
  END IF;
  -- UPDATE: raise if any immutable column changed
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.currency IS DISTINCT FROM OLD.currency
     OR NEW.stripe_object_id IS DISTINCT FROM OLD.stripe_object_id
     OR NEW.pack IS DISTINCT FROM OLD.pack
     OR NEW.credits IS DISTINCT FROM OLD.credits
     OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
     OR NEW.recorded_at IS DISTINCT FROM OLD.recorded_at
     OR NEW.source IS DISTINCT FROM OLD.source THEN
    RAISE EXCEPTION 'payments is append-only: immutable column changed';
  END IF;
  IF NEW.stripe_charge_id IS DISTINCT FROM OLD.stripe_charge_id
     AND OLD.stripe_charge_id IS NOT NULL THEN
    RAISE EXCEPTION 'payments.stripe_charge_id is write-once (NULL->value only)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_append_only ON payments;
CREATE TRIGGER trg_payments_append_only
  BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION payments_append_only();

CREATE OR REPLACE FUNCTION payments_no_truncate() RETURNS trigger AS $$
BEGIN
  IF current_setting('reelballers.allow_payments_purge', true) = 'on' THEN
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'payments is append-only: TRUNCATE is forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_payments_no_truncate ON payments;
CREATE TRIGGER trg_payments_no_truncate
  BEFORE TRUNCATE ON payments
  FOR EACH STATEMENT EXECUTE FUNCTION payments_no_truncate();
```

`CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` before `CREATE TRIGGER` makes the whole
block re-runnable (migration `up()` on an existing DB, and `_SCHEMA_DDL` on a fresh one, both
converge). The exact SQL text above is the load-bearing contract; the implementor copies it
verbatim into both locations. The `RETURN NEW` on the append-only function's UPDATE path is a
BEFORE trigger no-op-passthrough (the update proceeds); on DELETE the function always raises so
control never reaches a RETURN.

### 4.4 Grep AC (carried from T8620, still holds)

After this task, the ONLY `UPDATE payments` statements in the codebase are:
`payments_ledger.fill_missing_charge_id` (sets `stripe_charge_id`, NULL-gated) and
`payments_ledger.stamp_account_deleted` (sets `account_deleted_at`, NULL-gated). **No `DELETE
FROM payments` anywhere.** The DB trigger now enforces this structurally in addition to the grep.

---

## 5. Section 3 — where the stamp + audit writes live, per path + transaction boundaries

**Contract (AC2): every users-row deletion writes exactly one `account_deletions` row and
stamps the ledger, atomically with the `DELETE FROM users`.** Achieved by putting BOTH writes
inside the SAME transaction as `DELETE FROM users`, BEFORE the delete, so if the delete rolls
back nothing is audited, and if the audit/stamp fail the delete never happens.

### 5.1 Path 1 — `privacy.py` `delete_account` (actor=self, path=privacy_endpoint)

Step 1 (`_purge_user_data`, its own committed transaction — irreversible R2/credits purge) is
UNCHANGED. In step 2's `with get_pg() as conn:` block (`privacy.py:261-269`), BEFORE the
existing `DELETE FROM users`, add:

```python
from app.services.payments_ledger import stamp_account_deleted
from app.services.account_deletions import record_account_deletion, DeletionActor, DeletionPath
...
stamp_account_deleted(cur, user_id)
record_account_deletion(cur, user_id=user_id,
                        actor=DeletionActor.SELF, path=DeletionPath.PRIVACY_ENDPOINT)
# ... existing DELETE FROM user_actions / user_segments / referrals / users ...
```

The endpoint **never refuses** an erasure request (Constraint: only the script refuses). The
stamp + audit + delete commit together. The `_purge_user_data` R2/credits purge already
committed in step 1 (existing "irreversible-first" structure), so `had_payments`/`net_cents`
are still readable at audit time because `payments` is never touched by the purge.

### 5.2 Path 2 — `auth.py` `_reset_test_account` (actor=self, path=reset_test_account)

In its `with get_pg()` block (`auth.py:161-177`), BEFORE `DELETE FROM users`, add the audit
write (`record_account_deletion(cur, user_id=user_id, actor=DeletionActor.SELF,
path=DeletionPath.RESET_TEST_ACCOUNT)`). **Do NOT call `stamp_account_deleted` here**
(Approved ruling 1): the reset deletes the `users` row but the same `user_id` is re-created
immediately on the same login, so a persistent `account_deleted_at` stamp would misdescribe
a live, re-created account. The audit row is written regardless — a users-row deletion
genuinely occurred. Actor value is `self` (Approved ruling 2). Because the PK is now
`id BIGSERIAL` (ruling A), a second reset of the same test account writes a second audit
row without colliding.

### 5.3 Path 3 — `scripts/delete_user.py` `delete_one` (actor=script, path=delete_user_script)

In `delete_one`, BEFORE the `DELETE FROM users` (`:235`), add the stamp + audit on the same
`pg_conn` cursor (committed once in `main()` at `:302`, so still atomic with the whole run's
deletes). Guarded by `table_present(pg_conn, 'payments')` and `table_present(pg_conn,
'account_deletions')` for a pre-migration env. **The script imports the app helpers rather than
inlining SQL** (recommendation, §6). The `note` records `"forced past payment guard"` when the
target had payments and `--force-paid` was used (§7), else NULL.

### 5.4 Transaction-boundary invariant (proves AC2)

```
per real delete path:
  [ _purge_user_data: R2/local/caches/credits — its own txn, commits first ]   (irreversible-first)
  BEGIN (the caller's users-deleting txn)
     stamp_account_deleted(cur, user_id)          # UPDATE payments (NULL-gated)
     record_account_deletion(cur, ...)            # plain INSERT account_deletions (id BIGSERIAL PK)
     DELETE FROM users WHERE user_id = %s          # (+ the path's other DELETEs)
  COMMIT
```

No delete → the transaction rolls back → no audit row and no stamp persisted. Delete succeeds
→ audit + stamp committed together. So "exactly one `account_deletions` row per users-row
deletion" holds atomically. (`_purge_user_data`'s prior commit is fine: it is the irreversible
storage purge that intentionally precedes the identity-row delete in the existing design;
`payments` is not in its scope, so the ledger read at audit time is accurate.)

### 5.5 Failure behavior

- **Stamp/audit raise inside the users-deleting txn** (e.g. Postgres error): the whole
  transaction rolls back, the users row is NOT deleted, the endpoint/script surfaces the error
  (privacy.py already wraps step 2 in try/except → HTTP 500 "Failed to delete account records";
  keep that). This is correct: we do not half-delete an account without an audit trail. R2 is
  already purged (step 1), which is the existing accepted behavior for a step-2 failure
  (documented at `privacy.py:250-258`) — unchanged by this task.
- **`payments` / `account_deletions` table absent** (deployed-but-not-migrated window): the
  `to_regclass` guards (§3.4) make the stamp a no-op and record `had_payments=False`. If
  `account_deletions` itself is absent, log CRITICAL and skip the audit insert rather than
  500 the user's erasure request — the erasure must still succeed; the missing audit row in
  that narrow pre-migration window is an operational note, not a data-integrity failure of the
  ledger (which is what actually must survive). This window closes the moment
  `migrate-postgres` runs post-deploy.

---

## 6. Section 4 — the `--force-paid` guard in `delete_user.py` (incl. bulk pre-check)

**AC3: the script refuses a paying account without `--force-paid`, and refuses a bulk run
containing one before deleting anything.**

### 6.1 New flag + per-user payment check

Add `p.add_argument("--force-paid", action="store_true", help="Delete even accounts that have
retained payment records")` to `main`'s argparse.

A per-user check helper (guarded by the existing `table_present(pg_conn, 'payments')` — a
pre-v031 env has no ledger to protect, so the check is skipped entirely):

```python
def payment_summary(pg_conn, user_id):
    if not table_present(pg_conn, "payments"):
        return {"count": 0, "net_cents": 0, "object_ids": []}
    cur = pg_conn.cursor()
    cur.execute("SELECT COUNT(*) c, COALESCE(SUM(amount_cents),0) net FROM payments WHERE user_id=%s", (user_id,))
    row = cur.fetchone()
    cur.execute("SELECT stripe_object_id FROM payments WHERE user_id=%s", (user_id,))
    return {"count": row["c"], "net_cents": row["net"], "object_ids": [r["stripe_object_id"] for r in cur.fetchall()]}
```

### 6.2 Fail-before-first-delete for ALL modes (single, `--all`, `--all-except`)

The check runs as a **PRE-PASS over every target BEFORE any deletion**, so `--all`/`--all-except`
refuse the whole run before the first delete (AC: "fail before the first deletion, not halfway
through"). In `main`, after `rows = cur.fetchall()` and before the `for r in rows:` delete loop:

```python
if not args.force_paid:
    paid = [(r, payment_summary(pg_conn, r["user_id"])) for r in rows]
    paid = [(r, s) for (r, s) in paid if s["count"] > 0]
    if paid:
        print("\n*** REFUSING: the following target(s) have RETAINED payment records ***")
        for r, s in paid:
            print(f"  {r['email']} ({r['user_id']}): {s['count']} payment(s), "
                  f"net ${s['net_cents']/100:.2f} — ledger will be RETAINED")
            for oid in s["object_ids"]:
                print(f"      {oid}")
        print("\nThe payments ledger is preserved on deletion by design (T8630). "
              "Re-run with --force-paid to delete these account(s) anyway; "
              "their payment records will still be RETAINED and stamped account_deleted_at.")
        sys.exit(1)
```

Because this is a single pre-pass over the whole target list, no deletion has happened when it
refuses. With `--force-paid` present the pre-pass is skipped and the run proceeds; each forced
paying deletion records `note="forced past payment guard"` in its audit row (§5.3). The LOUD
block prints net revenue in dollars, every payment `stripe_object_id`, and that the ledger is
RETAINED (not deleted) — the point is intent, not blocking retention.

### 6.3 Script imports app helpers (recommended) vs inlined SQL

**Recommendation: the script imports `stamp_account_deleted` /
`record_account_deletion` from `app.services`** rather than duplicating their SQL. Rationale:
single source of truth for the stamp + audit SQL (the same greppable `UPDATE payments`
whitelist and the same audit-row shape apply whether the deletion came from the app or the
script); the script is already invoked from `cd src/backend` (`.venv/Scripts/python.exe
../../scripts/delete_user.py ...`), so `import app...` resolves. This matches the T8620 backfill
script, which imports `payments_ledger` helpers rather than inlining. The `payment_summary`
COUNT/SUM query is script-local (it is read-only reporting for the guard, not a table write), so
it stays inline in the script — only the two WRITE helpers are imported, preserving
single-writer-per-table.

---

## 7. Section 5 — privacy copy (exact before/after, all surfaces)

Voice: match the existing T1740 documents (concise, factual, no em dashes). Every surface states:
transaction records are retained after deletion, keyed to an opaque account id carrying no
email/name/card data, retained to meet tax and accounting obligations, and the erasure request
is never refused (personal data is still erased). No copy contradicts
`data-retention-policy.md`'s "No data is retained for analytics or research purposes" — the
basis stated everywhere is LEGAL obligation, not analytics.

### 7.1 In-app confirmation — `AccountSettings.jsx:174`

**BEFORE:**
```
This will permanently delete your account and all data. This cannot be undone.
```
**AFTER (Approved ruling C, exact text):**
```
This permanently deletes your account and all personal data. This cannot be undone. We
keep a record of past payments (amounts and dates only, with no name, email, or card
details) to meet tax and accounting obligations.
```

### 7.2 Privacy policy component — `PrivacyPolicy.jsx`

**§4 Data Retention (add one line after the closing `<p>` at line 141):**

BEFORE (line 141):
```
Upon deletion request, all data is permanently removed immediately (within 45 days if via email).
```
AFTER (line 141, add a following paragraph):
```
Upon deletion request, all data is permanently removed immediately (within 45 days if via email).
```
```jsx
<p className="mt-3">Transaction records (payment amounts keyed to an opaque account id, with no name, email, or card details) are retained after account deletion to meet our tax and accounting obligations. Retaining these records does not delay or limit erasure of your personal data.</p>
```

**§5 Right to Delete (line 149):**

BEFORE:
```
<strong className="text-white">Right to Delete:</strong> Delete your account via "Delete My Account" in Account Settings. Deletion is permanent and immediate.
```
AFTER:
```
<strong className="text-white">Right to Delete:</strong> Delete your account via "Delete My Account" in Account Settings. Deletion is permanent and immediate. We retain transaction records (payment amounts keyed to an opaque account id, with no personal details) to meet tax and accounting obligations; this does not delay erasure of your personal data.
```

### 7.3 Legal markdown — `docs/legal/privacy-policy.md`

**§4 Data Retention (add a row to the table at lines 135-142, and a line after 144):**

Add table row:
```
| Transaction records (payment amounts, keyed to an opaque account id; no name, email, or card data) | Retained after account deletion to meet tax and accounting legal obligations |
```
After line 144 (`Upon account deletion request, all data is permanently deleted within 45 days...`), add:
```
Transaction records are the one exception, and only because tax and accounting law requires it: we keep the payment amount keyed to an opaque account id, with no name, email, or card details. This exception does not delay or limit erasure of your personal data.
```

**§5 Right to Delete (line 157):**

BEFORE:
```
You may request deletion of your personal information. Use the "Delete My Account" button in Account Settings or email us. Deletion is permanent and immediate.
```
AFTER:
```
You may request deletion of your personal information. Use the "Delete My Account" button in Account Settings or email us. Deletion is permanent and immediate. We retain transaction records (payment amounts keyed to an opaque account id, with no personal details) to meet tax and accounting obligations. We never refuse your erasure request on this basis; your personal data is still erased, and only the pseudonymous financial record is kept.
```

### 7.4 Legal markdown — `docs/legal/data-retention-policy.md`

**"What Gets Deleted" (lines 39-53):** unchanged (all those categories are still fully deleted).

**"What Is NOT Retained After Deletion" (lines 55-59):** this section currently reads (in part)
"No data is retained for analytics or research purposes". Do NOT contradict it; ADD a
distinct "What IS Retained" subsection immediately after it:

AFTER line 59 (after the existing three bullets), add:
```markdown
### What IS Retained After Deletion

- **Transaction records only, for a legal reason.** We retain the amount and date of each
  payment, keyed to an opaque account id, with no name, email, or card details. This is kept
  solely to meet tax and accounting legal obligations, not for analytics, research, or any
  product purpose. It is a pseudonymous financial record with no name, email, or card
  details, and retaining it never delays or limits the erasure of your other personal data.
```

(Approved ruling B: the record is pseudonymous, not "not personal data" — pseudonymous data
is still personal data under GDPR Recital 26.)

**Third-Party Data Handling table (line 77, the Stripe row):** already correct ("Stripe retains
transaction records per financial regulations"). Change the header/first-party framing is not
needed; the new "What IS Retained" subsection above now covers OUR own retained record, which
previously the doc only attributed to Stripe. No edit to line 77.

---

## 8. Section 6 — migration v031 + `_SCHEMA_DDL` mirror plan

**Next free postgres version = v031** (verified: only `origin/master` remote; v030 is T8620;
no sibling branches). Postgres does NOT auto-migrate; operator runs `POST
/api/admin/migrate-postgres` after deploy. Prod is at v25 and owes v026..v030; this task's v031
lands behind those in the same operator call.

**New file `src/backend/app/migrations/postgres/v031_account_deletions.py`:**
- `class V031AccountDeletions(BaseMigration)`, `version = 31`, `description = "T8630: account
  deletion audit table + payments append-only trigger; deletion stamps account_deleted_at and
  records who/when/which-path/how-much, ledger rows preserved."`
- `up(self, conn)`: `cur = conn.cursor()`; execute (a) `CREATE TABLE IF NOT EXISTS
  account_deletions (...)` from §3.1 (Approved ruling A: `id BIGSERIAL PRIMARY KEY`,
  `user_id TEXT NOT NULL` plus the `(user_id, deleted_at)` index, NOT `user_id TEXT PRIMARY
  KEY`); (b) the append-only function + trigger and the no-truncate function + trigger from
  §4.3, verbatim.

**Register in `migrations/postgres/__init__.py`:** `from .v031_account_deletions import
V031AccountDeletions`; append `V031AccountDeletions()` to `MIGRATIONS`. `RUNNER =
MigrationRunner(MIGRATIONS, floor=0)` unchanged (postgres floor stays 0 forever).

**Mirror into `pg.py` `_SCHEMA_DDL`** (fresh deploys): add the identical `CREATE TABLE IF NOT
EXISTS account_deletions (...)` (corrected PK per ruling A) AND the identical trigger/function
DDL, placed after the `payments` block (lines 388-413). **Byte-for-byte identical to the
migration** (reviewer checks equality, per the v030 precedent comment already in the file).
Add a comment naming `services/account_deletions.py` as the audit-table writer and
`payments_ledger.stamp_account_deleted` as the stamp writer, pointing at
`v031_account_deletions.py`.

**Extra, same migration's `pg.py` edit (handed over from T8650, Approved rulings extra):**
on `user_segments.total_spent_cents` in `_SCHEMA_DDL`, add a comment stating it is a
per-user DISPLAY CACHE and that `payments` is the financial record every aggregate reads
(T8650). Comment only — no DDL change to that column or table.

**Operator step (completion notes):** `migrate-postgres` must run post-deploy (it applies
v026..v031 in order). No backfill is needed for this task (the audit table starts empty; the
stamp only applies going forward).

---

## 9. Section 7 — ASCII diagram of a deletion

```
  user clicks "Delete Forever"  (AccountSettings.jsx)
        │  DELETE /api/privacy/delete-account
        ▼
  privacy.delete_account(user_id)               actor=self, path=privacy_endpoint
        │
        ├─ step 1: _purge_user_data(user_id)     [ its OWN txn, commits ]
        │     R2 objects, local folder, caches, sessions,
        │     credits/credit_transactions/credit_reservations,
        │     game_storage_refs, upload_failures
        │     (payments is NOT touched — it must survive)
        │
        └─ step 2: with get_pg() as conn:  ── ONE transaction ──────────────┐
              stamp_account_deleted(cur, user_id)                           │
                UPDATE payments SET account_deleted_at=now()                │
                  WHERE user_id=%s AND account_deleted_at IS NULL           │
              record_account_deletion(cur, user_id, SELF, PRIVACY_ENDPOINT) │
                reads payments -> had_payments, net_cents                   │
                INSERT INTO account_deletions ... (id BIGSERIAL, plain INSERT) │
              DELETE FROM user_actions / user_segments / referrals          │
              DELETE FROM users WHERE user_id=%s                            │
           COMMIT  ────────────────────────────────────────────────────────┘

  RESULT: payments rows intact + stamped; exactly one account_deletions row;
          users row gone.  The 2026-09-03 questions (who/when/which path/how much)
          are now answerable from account_deletions + payments alone.

  append-only trigger on payments (DB-level):
     UPDATE amount_cents/kind/user_id/...  → RAISE
     UPDATE stripe_charge_id (NULL->val)   → allow (fill_missing_charge_id)
     UPDATE account_deleted_at             → allow (the stamp above)
     DELETE / TRUNCATE                     → RAISE  (TRUNCATE unless SET LOCAL escape hatch)
```

---

## 10. Section 8 — risks

| Risk | Mitigation / stance |
|------|---------------------|
| **Code ships before the v031 migration runs** (prod owes v026..v031). | `to_regclass` guards (§3.4) make stamp a no-op and audit record `had_payments=False` when `payments`/`account_deletions` are absent; audit-table-absent logs CRITICAL and skips the insert rather than 500ing an erasure request. Window closes at `migrate-postgres`. |
| **Trigger blocks a legitimate future in-place write.** | The trigger allow-list matches the T8620 grep AC exactly (both permitted writes: `account_deleted_at`, `stripe_charge_id` NULL->value). Any new legitimate in-place write is a deliberate change that must update BOTH the trigger and the grep AC in the same PR. |
| **TRUNCATE guard breaks the test suite.** | Exact conftest change specified (§4.2): `SET LOCAL reelballers.allow_payments_purge = 'on'` before the TRUNCATE. The GUC is session-scoped and greppable; no production path sets it. |
| **`reset_test_account` stamps a live re-created account.** | Resolved (Approved ruling 1): write the audit row, do NOT stamp (the same user_id is re-created immediately on the same login; a persistent stamp on a live account's payments would be misleading; test accounts realistically have no payments; the stamp never filters revenue so SUM stays correct regardless). |
| **Audit insert reads `payments` after `_purge_user_data` ran.** | Safe: `_purge_user_data` never touches `payments` (it purges credits, a different ledger). `had_payments`/`net_cents` are accurate at audit time. |
| **Script `--force-paid` used carelessly deletes a payer.** | The ledger is RETAINED and stamped even under `--force-paid` (the row survives; only the users row goes). The loud pre-pass names net revenue + every object id + that the ledger is retained; the audit row records `note="forced past payment guard"`. Intent, not prevention, is the design goal. |
| **`account_deletions` has no append-only trigger.** | Resolved out of scope (Approved ruling 4; trigger scope kept to `payments`, the T8620 carry-over). `account_deletions` is append-only by convention (writers only INSERT). Possible follow-up; not blocking. |
| **`account_deletions` PK collides on a re-deleted user_id.** | Fixed by Approved ruling A: `id BIGSERIAL PRIMARY KEY` with `user_id` indexed, not `user_id` itself as PK — a second reset of the same test account writes a second row instead of hitting a duplicate-key error mid-transaction. |
| **Privacy copy overclaims / contradicts existing docs.** | Copy states LEGAL obligation, never analytics; the new "What IS Retained" subsection is added alongside (not replacing) "No data is retained for analytics or research purposes". Reviewer checks no contradiction and no em dashes. |

---

## 11. Test plan (mapped to the 5 acceptance criteria)

Backend pg-backed tests under `src/backend/tests/` (follow the T8620 `pg_conn` harness pattern;
new file e.g. `test_t8630_deletion_audit.py`). Failing-first for behavioral tests, observed
failing against pre-change master for the intended reason, then passing after (Landing Policy).

| # | Test | Proves / AC |
|---|------|-------------|
| T1 | **Ledger survives + stamped**: seed a `payments` row for a user, drive `delete_account` (or a direct call to the privacy path's step-2 logic) → the `payments` row still exists AND `account_deleted_at IS NOT NULL`; the `users` row is gone. Idempotency: a second stamp call stamps 0 rows (NULL-gated). | **AC1** ("deleting an account with payments leaves every `payments` row intact, stamped"). |
| T2 | **Exactly one audit row per deletion**, naming actor + path, with correct `had_payments`/`net_cents`: seed purchase (+ refund) → `net_cents == SUM(amount_cents)`, `had_payments == true`; a user with no payments → row with `had_payments=false, net_cents=0`. Assert across all three paths (privacy_endpoint / reset_test_account / delete_user_script). **Ruling A amendment:** two resets of the SAME test account (same `user_id` re-created between them) write TWO `account_deletions` rows and both inserts succeed (no PK collision) — proves the `id BIGSERIAL` PK, not `user_id` PK. | **AC2** ("every users-row deletion writes exactly one `account_deletions` row naming actor and path"). |
| T3 | **Trigger blocks the forbidden, allows the two whitelisted**: (a) `UPDATE payments SET amount_cents=...` raises; (b) `UPDATE payments SET kind=...`/`user_id`/`stripe_object_id`/`occurred_at` raises; (c) `DELETE FROM payments` raises; (d) `fill_missing_charge_id` on a NULL charge id succeeds; (e) a NULL->value on `stripe_charge_id` succeeds but value->other raises; (f) `stamp_account_deleted` (`account_deleted_at` NULL->now()) succeeds. | Append-only trigger (§4), and the T8620 grep-AC carry-over enforced structurally. |
| T4 | **TRUNCATE guard**: `TRUNCATE payments` raises by default; `SET LOCAL reelballers.allow_payments_purge='on'; TRUNCATE payments` succeeds. (Also implicitly proven green by the whole suite running under the amended conftest.) | §4.2 TRUNCATE recommendation. |
| T5 | **Script refuses a paying account without `--force-paid`, incl. bulk-before-first-delete**: against a throwaway DB, seed two users, one with a payment. `--all` without `--force-paid` → exits non-zero, LOUD block naming net + object ids, AND neither `users` row deleted (fail-before-first). With `--force-paid` → both deleted, both audited, the paying one's `payments` retained + stamped, `note="forced past payment guard"`. Single-`--email` on the paying user without the flag → same refusal. | **AC3** ("refuses a paying account without `--force-paid`, and refuses a bulk run containing one before deleting anything"). |
| T6 | **Full incident-reconstruction from tables**: freshly delete a seeded paying test account, then answer the 2026-09-03 questions purely from SQL — who (`actor`/`path`), when (`deleted_at`), which path, how much (`net_cents`, `had_payments`), and the surviving stamped `payments` rows. | **AC5** ("re-running the 2026-09-03 questions against a freshly deleted test account answers all from tables"). |
| T7 | **Copy assertions**: a frontend test (if one exists for `AccountSettings` — check `src/frontend/src/components/__tests__/`; else a lightweight string presence test) asserts the confirmation text mentions retained transaction records; a docs consistency check (grep) asserts each of the four surfaces contains the retention statement and contains NO em dash. | **AC4** ("the in-app delete confirmation and the privacy policy both state that transaction records are retained, with the reason"). |

**AC coverage map:** AC1→T1; AC2→T2; AC3→T5; AC4→T7; AC5→T6. T3/T4 cover the append-only
trigger (the T8620 ruling-2 carry-over this task owns). If no `AccountSettings` frontend test
harness exists, the confirmation-copy assertion in T7 degrades to a docs/string grep — noted so
the Tester does not invent a component test where none is warranted.

---

## Non-goals (T8630)

- Live dispute webhook handling (T8620 deferred; epic owner files the follow-up).
- Reconciliation classifying deleted-payer rows / `account_deleted` cause (T8640).
- Admin revenue totals reading the ledger instead of the cache (T8650).
- Stripe receipts (T8660), scheduled reconciliation (T8670), dispute webhook rows (T8675).
- Deleting the two residue tables (`user_usage_daily`, `impersonation_audit`) — deliberately
  kept (today the only forensic trail); a separate decision once `account_deletions` exists.
- An `account_deletions` append-only trigger (kept out; convention-only; possible follow-up).
- Any automated refund behavior (epic-wide constraint).
- Adding a stamp/audit to `DELETE /api/auth/user` or to `_purge_user_data` (neither deletes the
  users row; the shared helper must stay stamp/audit-free).

---

## Open Questions — all resolved by Approved rulings 2026-09-24

1. **Stamp on `_reset_test_account`?** Resolved: Option A — write the audit row, do NOT stamp
   on reset (Approved ruling 1).
2. **Actor value for `reset_test_account`.** Resolved: `self` (Approved ruling 2).
3. **Ship the TRUNCATE guard now, or defer it?** Resolved: ship it now, with the `SET LOCAL`
   escape hatch and the specified conftest change (Approved ruling 3).
4. **`account_deletions` own trigger — confirm OUT of scope.** Resolved: out of scope
   (Approved ruling 4).
5. **`admin` actor has no live path in this task.** Resolved: reserve the value, no code in
   this task emits it (Approved ruling 5).

Additionally, a design bug found at approval time is fixed: the `account_deletions` primary
key is `id BIGSERIAL`, not `user_id` (Approved ruling A) — see §3.1.

---

## Status

APPROVED (user, 2026-09-24) — see "Approved rulings 2026-09-24" above. Proceeding to
Tester Phase 1 -> Migration -> Implementation -> Reviewer.
