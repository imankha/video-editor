# T2910: Referral Graph

**Status:** TODO
**Epic:** [Invite & Referral](EPIC.md)
**Impact:** 7
**Complexity:** 4
**Created:** 2026-05-15
**Depends on:** T2900 (invite code generation + ref param capture on signup)

## Problem

We have no visibility into which users brought in other users, or whether shares are driving signups. Without referral tracking, we can't measure viral growth or optimize acquisition channels.

## Solution

### 1. Postgres Schema: `referrals` Table

Adjacency list pattern -- simple, handles shallow trees (depth 1-3) with recursive CTEs.

```sql
CREATE TABLE IF NOT EXISTS referrals (
    id SERIAL PRIMARY KEY,
    referrer_id TEXT NOT NULL REFERENCES users(user_id),
    referred_id TEXT NOT NULL REFERENCES users(user_id) UNIQUE,
    channel VARCHAR(20) NOT NULL,
    source_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX idx_referrals_channel ON referrals(channel);
```

**Columns:**
- `referrer_id`: The user who sent the invite or share
- `referred_id`: The user who signed up (UNIQUE -- each user referred at most once, first attribution wins)
- `channel`: One of `invite_link`, `game_share`, `annotation_share`, `reel_share`
- `source_id`: Optional context -- the invite_code or share_token that led to signup

### 2. Attribution on Signup

When a new user signs up, check for referral attribution in priority order:

1. **Invite code**: If `ref` param present in signup request, look up which user owns that invite code and record `channel = 'invite_link'`.
2. **Pending share**: If the new user's email has a pending teammate share (in `pending_teammate_shares` or `shares` table), attribute to the sharer with the appropriate channel (`game_share`, `annotation_share`, `reel_share`).

```python
# In auth signup flow, after user creation:
async def record_referral(pg, new_user_id: str, ref_code: str = None, email: str = None):
    # Priority 1: explicit invite code
    if ref_code:
        referrer = await resolve_invite_code(pg, ref_code)
        if referrer:
            await insert_referral(pg, referrer, new_user_id, 'invite_link', ref_code)
            return

    # Priority 2: pending share attribution
    if email:
        share = await get_earliest_share_for_email(pg, email)
        if share:
            channel = map_share_type_to_channel(share['share_type'])
            await insert_referral(pg, share['sharer_user_id'], new_user_id, channel, share['share_token'])
```

### 3. Invite Code Resolution

T2900 generates invite codes as `sha256(user_id)[:8]`. To resolve a code back to a user_id, we need either:

**Option A: Scan users table** -- `SELECT user_id FROM users` and hash each. Works at <10K users but O(n).

**Option B: Store invite codes** -- Add `invite_code` column to users table, populated on first invite-code request. Indexed for O(1) lookup.

**Recommendation: Option B.** Add column + index:

```sql
ALTER TABLE users ADD COLUMN invite_code VARCHAR(8);
CREATE UNIQUE INDEX idx_users_invite_code ON users(invite_code);
```

Populated lazily when `GET /api/me/invite-code` is first called. Lookup is a simple indexed query.

### 4. Admin Queries

Add to admin API or as raw SQL for now:

```sql
-- Direct referrals by user
SELECT u.email, r.channel, r.created_at
FROM referrals r JOIN users u ON u.user_id = r.referred_id
WHERE r.referrer_id = :uid
ORDER BY r.created_at DESC;

-- Referral leaderboard
SELECT u.email, count(*) as referral_count
FROM referrals r JOIN users u ON u.user_id = r.referrer_id
GROUP BY u.email ORDER BY referral_count DESC;

-- Channel effectiveness
SELECT channel, count(*) FROM referrals GROUP BY channel ORDER BY count DESC;

-- Full tree from a user (recursive)
WITH RECURSIVE tree AS (
    SELECT referred_id, 1 as depth FROM referrals WHERE referrer_id = :uid
    UNION ALL
    SELECT r.referred_id, t.depth + 1
    FROM referrals r JOIN tree t ON r.referrer_id = t.referred_id
    WHERE t.depth < 5
)
SELECT count(*) as total_tree_size FROM tree;
```

### 5. Integration Points

**Share acceptance (existing flows):**

When `resolve_pending_shares()` runs for a newly signed-up user and materializes shared content, also check if a referral should be recorded. This hooks into T2830's materialization flow and the core sharing flow (T1750).

Reuse `record_referral()` -- if the user was already attributed (via invite code), the UNIQUE constraint on `referred_id` prevents a duplicate.

## Files Affected

| File | Change |
|------|--------|
| `src/backend/app/services/pg.py` | Add `referrals` table DDL, `invite_code` column on users |
| `src/backend/app/routers/auth.py` | Call `record_referral()` after user creation |
| `src/backend/app/services/sharing_db.py` | Hook referral attribution into share resolution |
| `src/backend/app/routers/admin.py` | Referral stats endpoints |

## Edge Cases

- **Self-referral**: User clicks their own invite link -- skip (referrer_id == referred_id)
- **Duplicate attribution**: UNIQUE on referred_id + INSERT ON CONFLICT DO NOTHING
- **Invite code collision**: sha256[:8] has ~4 billion values. At <10K users, collision probability is negligible (~0.001%). If it happens, the UNIQUE index on invite_code catches it and we can extend to 12 chars.
- **User deletes account**: CASCADE on referrer_id/referred_id or leave orphaned rows (soft delete pattern TBD)

## Test Scope

- **Backend Unit**: referral creation, dedup (UNIQUE), channel attribution, invite code resolution
- **Backend Integration**: signup with ref code records referral; share acceptance records referral
- **Admin**: referral leaderboard query returns correct counts
