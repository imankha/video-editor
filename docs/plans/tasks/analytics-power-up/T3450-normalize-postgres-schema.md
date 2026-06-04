# T3450: Normalize Postgres Schema

**Status:** TODO
**Priority:** P0 (blocks all other tasks in epic)
**Impact:** 8 | **Complexity:** 5

## Summary

Replace the wide `user_milestones` table with two focused tables: `user_segments` (cohort dimensions + spend) and `user_actions` (event counts). Implement origin propagation so viral users inherit their inviter's campaign origin. Track total spend per user.

## Why

`user_milestones` is a 25-column wide table storing four distinct concerns: segment info, milestone timestamps, lifetime counts, and session tracking. The timestamps and counts are **redundant** with `user_flow_events` (which already has first_at and count per event). This makes the table hard to extend (adding a new event means adding columns) and queries awkward.

Additionally, the current origin model (`organic | viral | ad_campaign`) loses campaign attribution on viral chains -- if campaign "ig_summer" brings in User A who invites User B, User B is just "viral" with no link back to the campaign. We need to see total revenue from "ig_summer" including all its viral descendants.

See [EPIC.md](EPIC.md) for design decisions and origin model.

## Schema Changes

### New: `user_segments`

```sql
CREATE TABLE IF NOT EXISTS user_segments (
    user_id TEXT PRIMARY KEY REFERENCES users(user_id),
    acquired_at DATE NOT NULL DEFAULT CURRENT_DATE,
    origin TEXT NOT NULL DEFAULT 'organic',
    referrer_id TEXT REFERENCES users(user_id),
    signup_method TEXT CHECK (signup_method IN ('google', 'otp')),
    total_spent_cents INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_segments_acquired ON user_segments(acquired_at);
CREATE INDEX IF NOT EXISTS idx_segments_origin ON user_segments(origin);
CREATE INDEX IF NOT EXISTS idx_segments_referrer ON user_segments(referrer_id);
```

**`origin`** is either:
- `"organic"` -- user arrived directly, no referral
- A campaign ID string (e.g., `"ig_summer_camp"`) -- user arrived via `?ref=ig_summer_camp` where that ref did not resolve to an invite code, OR user was referred by someone whose origin is that campaign ID

**`referrer_id`** is set when the user was invited by another user (viral). NULL for organic/direct-campaign users.

**`total_spent_cents`** is a running counter incremented on each payment completion.

### Rename: `user_flow_events` -> `user_actions`

```sql
ALTER TABLE user_flow_events RENAME TO user_actions;
-- Also rename the column for clarity
ALTER TABLE user_actions RENAME COLUMN event TO action;
```

Same shape: (user_id, action, first_at, count).

### Drop: `user_milestones`

After migration only. All data migrated to `user_segments` + `user_actions`.

### Keep: `daily_counters`

No structural changes. Update the `origin_type` values to match the new origin model: daily_counters rows will use `"organic"` or a campaign ID string instead of the old 3-way enum.

### Keep: `referrals`

The existing `referrals` table stays as an audit log of referral events (channel, source_id, created_at). `user_segments.referrer_id` is the canonical "who invited this user" field for analytics queries.

## Origin Propagation Logic

Update `_get_origin_for_user()` in auth.py:

```python
def _determine_origin(user_id: str, ref: str | None) -> tuple[str, str | None]:
    """Determine origin and referrer_id for a new user.

    Returns (origin, referrer_id).
    """
    from app.services.sharing_db import resolve_invite_code

    # 1. Try ref as invite code
    if ref:
        referrer_id = resolve_invite_code(ref)
        if referrer_id:
            # Viral: inherit inviter's origin
            inviter_origin = _get_user_origin(referrer_id)
            return inviter_origin, referrer_id

        # 2. ref didn't resolve to invite code -> treat as campaign ID
        return ref, None

    # 3. Try share-based attribution
    from app.services.sharing_db import find_earliest_sharer
    sharer_id = find_earliest_sharer(user_id)
    if sharer_id:
        # Viral via share: inherit sharer's origin
        sharer_origin = _get_user_origin(sharer_id)
        return sharer_origin, sharer_id

    # 4. No attribution -> organic
    return "organic", None


def _get_user_origin(user_id: str) -> str:
    """Look up a user's origin from user_segments."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT origin FROM user_segments WHERE user_id = %s", (user_id,))
        row = cur.fetchone()
    return row["origin"] if row else "organic"
```

### Signup flow change

In `_find_or_create_user()` (auth.py), after creating the user and recording the referral:

```python
# After record_referral and attribute_from_existing_shares:
origin, referrer_id = _determine_origin(user_id, ref)
create_user_segment(user_id, origin, referrer_id, signup_method)
```

### Total spend tracking

In the payment webhook/verify handler, after granting credits:

```python
# After successful payment:
with get_pg() as conn:
    cur = conn.cursor()
    cur.execute(
        "UPDATE user_segments SET total_spent_cents = total_spent_cents + %s WHERE user_id = %s",
        (amount_cents, user_id),
    )
```

## Migration Plan

1. Create `user_segments` table
2. Populate from `user_milestones` + `referrals`:
   ```sql
   INSERT INTO user_segments (user_id, acquired_at, origin, referrer_id, signup_method, total_spent_cents)
   SELECT
       m.user_id,
       m.install_day,
       CASE
           WHEN m.origin_type = 'organic' THEN 'organic'
           WHEN m.origin_type = 'viral' THEN COALESCE(
               (SELECT s2.origin FROM user_segments s2
                JOIN referrals r ON r.referrer_id = s2.user_id
                WHERE r.referred_id = m.user_id),
               'organic'
           )
           WHEN m.origin_type = 'ad_campaign' THEN COALESCE(m.origin_channel, 'organic')
       END,
       (SELECT r.referrer_id FROM referrals r WHERE r.referred_id = m.user_id LIMIT 1),
       m.signup_method,
       COALESCE(
           (SELECT SUM(amount_cents) FROM ... ), -- derive from credit_transactions if available
           0
       )
   FROM user_milestones m;
   ```
   Note: exact total_spent_cents backfill depends on where payment amounts are stored. May need to iterate user SQLite DBs or use Stripe records. For existing users this can be populated manually or left at 0 if pre-revenue.
3. Backfill session_count as `session_started` action in `user_actions`:
   ```sql
   INSERT INTO user_actions (user_id, action, count, first_at)
   SELECT user_id, 'session_started', session_count, signup_completed_at
   FROM user_milestones
   WHERE session_count > 0
   ON CONFLICT DO NOTHING;
   ```
4. Rename `user_flow_events` to `user_actions`, rename `event` column to `action`
5. Drop `user_milestones` (after verifying all data migrated)
6. Update `daily_counters` origin_type values: map `"ad_campaign"` rows to their origin_channel value, keep `"organic"` and `"all"` as-is, map `"viral"` rows to the appropriate inherited origin (or leave as "viral" for historical data)

## Code Changes

### `analytics.py`
- `create_user_milestones()` -> `create_user_segment()`: INSERT into `user_segments`
- `record_milestone()`: write to `user_actions` (formerly `user_flow_events`)
- `update_session()`: record `session_started` action instead of updating wide columns
- Remove all `UPDATE user_milestones SET last_active_at`

### `auth.py`
- `_get_origin_for_user()` -> `_determine_origin()`: implements origin propagation
- `_find_or_create_user()`: pass origin + referrer_id to `create_user_segment()`
- Handle ref-as-campaign-id case (ref present but not an invite code)

### `admin.py`
- All admin queries JOIN `user_segments` + `user_actions` instead of `user_milestones`
- Users list: show origin (campaign ID or organic), referrer email, total spent
- Channels endpoint: GROUP BY origin, SUM total_spent_cents

### `payments.py`
- On successful payment: `UPDATE user_segments SET total_spent_cents = total_spent_cents + amount`

### `pg.py`
- Update `_SCHEMA_DDL`: replace `user_milestones` with `user_segments` + `user_actions`

## Testing

### Origin propagation (critical path -- new logic)
- **Direct organic:** User visits with no ref -> origin = "organic", referrer_id = NULL
- **Campaign direct:** User visits with `?ref=ig_summer` (not an invite code) -> origin = "ig_summer", referrer_id = NULL
- **Viral from organic:** User A (organic) invites User B -> B.origin = "organic", B.referrer_id = A
- **Viral from campaign:** User A (origin: ig_summer) invites User B -> B.origin = "ig_summer", B.referrer_id = A
- **Viral chain:** A (ig_summer) -> B -> C -> C.origin = "ig_summer", C.referrer_id = B
- **Share-based viral:** User A shares video to email, recipient signs up -> origin inherited from A, referrer_id = A

### Revenue rollup
- Campaign "ig_summer" has 1 direct user ($10) + 2 viral descendants ($5 each) -> campaign total = $20
- Organic has 3 users ($0, $10, $5) -> organic total = $15

### Migration
- All existing `user_milestones` rows have corresponding `user_segments` rows
- All milestone timestamps and counts preserved in `user_actions`
- `daily_counters` historical data still queryable

## Notes

- `origin` is NOT an enum -- it's free text. "organic" is the only reserved value. Everything else is a campaign identifier.
- The `referrals` table remains as an audit log (it stores channel, source_id, timestamps). `user_segments.referrer_id` is the simplified analytics field.
- `total_spent_cents` is denormalized for query speed. The source of truth for individual transactions remains in per-user SQLite credit_transactions.
