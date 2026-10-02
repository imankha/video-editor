# T11620: Backend: free highlight pass (table, grant on publish, redeem on export)

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-10-02
**Updated:** 2026-10-02

## Epic Context

This is task 2 of 5 in the Free Second Highlight epic. Read [EPIC.md](EPIC.md) for the design
decisions:
- one row per user
- granted by the publish gesture
- redeemed at credit reservation
- every account gets one pass, no cohort gate

Knowledge docs: `backend-services.md`, `export-pipeline.md`.

Classification hint: **L-tier**. It has a schema change (postgres track) and touches 3+ backend
files. Include Migration.

## Solution

### 1. Schema (postgres track)

- Write migration `src/backend/app/migrations/postgres/v036_free_highlight_passes.py`. v035 is the
  head as of 2026-10-02. Re-check for a version collision with other branches before landing.
- Mirror the table in `_SCHEMA_DDL` in `services/pg.py`.

```sql
CREATE TABLE IF NOT EXISTS free_highlight_passes (
    user_id                TEXT        PRIMARY KEY,
    granted_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at             TIMESTAMPTZ NOT NULL,
    trigger_final_video_id TEXT,
    used_at                TIMESTAMPTZ,
    used_reference_id      TEXT,
    credits_covered        INTEGER CHECK (credits_covered > 0),
    reminder_email_id      TEXT
);
```

- Add the table to `auth._purge_user_data`, alongside the credit tables. Account deletion must
  remove it.
- After deploy the operator runs `POST /api/admin/migrate-postgres`. Note this in the PR.

### 2. Constants + ledger source

- In `services/storage_credits.py`, add:
  - `FREE_PASS_MAX_CREDITS = 40`
  - `FREE_PASS_WINDOW_HOURS = 24`
  - `FREE_PASS_REMINDER_AFTER_HOURS = 19`
- Register `"free_highlight_pass": "free_pass"` in `credit_ledger.KEY_PREFIX`. `credit_key()`
  raises for an unregistered source.

### 3. New service `services/free_pass.py`

- `grant_on_publish(user_id, final_video_id) -> dict | None`:
  - Runs `INSERT ... (expires_at = now() + 24h) ON CONFLICT (user_id) DO NOTHING RETURNING
    granted_at, expires_at`.
  - Returns `{expires_at, max_credits}` only if the row was created, else `None`.
  - Leave a clearly named hook point for T11640's email scheduling. T11640 fills it.
- `redeem(user_id, cost, reference_id) -> int` returns the number of credits covered, or 0:
  - **ONE Postgres transaction:**
    - `UPDATE free_highlight_passes SET used_at = now(), used_reference_id = %s, credits_covered =
      LEAST(%s, 40) WHERE user_id = %s AND used_at IS NULL AND expires_at > now() RETURNING
      credits_covered`
    - then the ledger insert and balance update for `credits_covered`, source
      `free_highlight_pass`, key `credit_key("free_highlight_pass", user_id)`
  - `credit_ledger.grant()` opens its own connection, so either add a cursor-taking variant of
    the grant SQL or inline it. **A pass marked used without the grant must be impossible.**
  - Call `_require_ready()` like the other ledger mutations.
- `active_pass(user_id) -> dict | None`: the unused, unexpired pass for the read path.

### 4. Wire it in

- **Publish:** in `publish_to_my_reels` (`routers/downloads.py:2102`), after `published_at` is set
  successfully, call `grant_on_publish`. Add `free_pass` to the response: the dict, or `null`.
  - If the pass write fails, log at ERROR and still return the successful publish. The pass is a
    bonus and must never break publishing.
- **Export:** at both reservation sites, call `redeem(user_id, cost, reference)` immediately before
  `reserve_credits`, using the same `reference` the reservation uses:
  - `routers/export/framing.py:324-329`
  - `routers/export/multi_clip.py:2162-2168`

  Return the covered amount in the export start response (`free_pass_credits_covered`) so the UI
  can confirm.
- **Read:** `GET /api/credits` (`routers/credits.py:42`) adds `free_pass` from `active_pass`.

## Edge cases (decide nothing new; these follow from EPIC.md)

| Case | Behavior |
|---|---|
| Republish, or publish of a 2nd project while the pass is active | Conflict, no new pass, `free_pass: null` |
| Export started before the pass existed | Not covered (redemption happens only at reserve time) |
| Export cost 55 | Covered 40, net charge 15 |
| Export fails after redemption | Normal reservation refund; the user keeps the covered credits; the pass stays spent |
| Two exports started at the same moment | The conditional UPDATE lets exactly one redeem |
| Pass expired | `redeem` returns 0; `GET /api/credits` returns `free_pass: null` |
| Deleted then re-registered account | Purge removed the row, so the user gets a new pass. Accepted. |

## Tests (red first, through the real endpoints)

- First publish returns `free_pass`; a second publish returns `null`.
- The next export within the window is charged `max(0, cost - 40)` and the ledger shows the
  `free_highlight_pass` row.
- An export after `expires_at` is charged in full. Freeze or patch the clock at the service seam,
  not the SQL.
- Concurrent redeem: exactly one covers.
- Purge removes the row.

## Acceptance

- [ ] Migration v036 + `_SCHEMA_DDL` + purge updated
- [ ] Grant on publish, redeem at both reserve sites, `free_pass` on `GET /api/credits`
- [ ] Pass-used-without-grant is impossible (single transaction), with a test
- [ ] `CreditHistoryModal.jsx` source label is NOT in scope here (T11630)
