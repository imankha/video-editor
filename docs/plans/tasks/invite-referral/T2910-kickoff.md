# T2910 Implementation Kickoff: Referral Graph

## Task

Implement T2910: Referral Graph. Read `docs/plans/tasks/invite-referral/T2910-referral-graph.md` for the full task spec, and `docs/plans/tasks/invite-referral/EPIC.md` for epic-level context.

## Epic Context

This is task 3 of 3 in the **Invite & Referral** epic.

- **T2900** (Invite Button + Email): TESTING -- added `GET /api/me/invite-code` endpoint, invite button with mailto:, `?ref=` passthrough from landing page to app, `ref` param on auth requests. The `ref` param is already accepted in `GoogleAuthRequest.ref` and `VerifyOtpRequest.ref` and passed to `_find_or_create_user()`, but only logged -- **not yet used for attribution**. That's T2910's job.
- **T2905** (Share Annotated Playback): TESTING -- annotation playback sharing via email link with signup CTA.

## Prior Task Learnings

- **T2900**: `_find_or_create_user()` in `src/backend/app/routers/auth.py:247` already accepts a `ref` param and logs it (line 275). Both `google_auth` (line 325) and `verify_otp` (line 540) pass `body.ref` through. The invite code is `sha256(user_id)[:8]` -- deterministic, no storage in T2900.
- **T2900**: The `ref` param flows from frontend `sessionStorage` -> auth request body -> `_find_or_create_user()`. The connection to the referral table is what T2910 adds.
- **Share types in Postgres**: The `shares.share_type` CHECK constraint allows `'video'`, `'game'`, `'annotation_playback'` (migrated in v003). These map to referral channels: `video` -> `reel_share`, `game` -> `game_share`, `annotation_playback` -> `annotation_share`.

## What to Build

### 1. Postgres Migration: v004

Create `src/backend/app/migrations/postgres/v004_referral_graph.py`.

**Migration pattern** -- follow `v003_annotation_playback_share_type.py` exactly:

```python
from ..base import BaseMigration

class V004ReferralGraph(BaseMigration):
    version = 4
    description = "Add referrals table and invite_code column on users"

    def up(self, conn):
        cur = conn.cursor()
        # invite_code column on users (populated lazily by GET /api/me/invite-code)
        cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_code VARCHAR(8)")
        cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code) WHERE invite_code IS NOT NULL")

        # referrals table (adjacency list)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS referrals (
                id SERIAL PRIMARY KEY,
                referrer_id TEXT NOT NULL REFERENCES users(user_id),
                referred_id TEXT NOT NULL REFERENCES users(user_id) UNIQUE,
                channel VARCHAR(20) NOT NULL,
                source_id TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_referrals_channel ON referrals(channel)")
```

Register it in `src/backend/app/migrations/postgres/__init__.py`:

```python
from .v004_referral_graph import V004ReferralGraph

MIGRATIONS = [
    V001Baseline(),
    V002GameRefCounts(),
    V003AnnotationPlaybackShareType(),
    V004ReferralGraph(),
]
```

Also add the `referrals` table DDL and `invite_code` column to `_SCHEMA_DDL` in `src/backend/app/services/pg.py` (for fresh deployments that skip migrations).

### 2. Referral Attribution Logic

Add a `record_referral()` function. Could live in `src/backend/app/services/sharing_db.py` (since it touches the sharing/attribution domain) or a new `src/backend/app/services/referral.py`. Either works -- keep it close to where it's called.

```python
def record_referral(referrer_id: str, referred_id: str, channel: str, source_id: str | None = None) -> bool:
    """Insert a referral row. Returns True if inserted, False if already attributed (UNIQUE conflict)."""
    if referrer_id == referred_id:
        return False  # self-referral
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO referrals (referrer_id, referred_id, channel, source_id)
               VALUES (%s, %s, %s, %s)
               ON CONFLICT (referred_id) DO NOTHING""",
            (referrer_id, referred_id, channel, source_id),
        )
        return cur.rowcount > 0
```

Resolution helpers:

```python
def resolve_invite_code(invite_code: str) -> str | None:
    """Look up user_id by invite_code. Returns user_id or None."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM users WHERE invite_code = %s", (invite_code,))
        row = cur.fetchone()
        return row["user_id"] if row else None
```

Share-type-to-channel mapper:

```python
SHARE_TYPE_TO_CHANNEL = {
    "video": "reel_share",
    "game": "game_share",
    "annotation_playback": "annotation_share",
}
```

### 3. Hook into Auth Signup Flow

In `src/backend/app/routers/auth.py`, modify `_find_or_create_user()` to call referral attribution **after creating a new user** (not for existing users returning to login).

The key integration point is around line 267-278. After `create_user()` succeeds and before the function returns, call attribution logic:

```python
# After line 278 (after create_user succeeds for a NEW user):
if ref:
    # Priority 1: explicit invite code
    referrer_id = resolve_invite_code(ref)
    if referrer_id:
        record_referral(referrer_id, user_id, 'invite_link', ref)
```

**Critical**: Only run attribution for NEW users (the `create_user` path), not for existing users logging in again (the `get_user_by_email` early-return path at line 261-265).

### 4. Hook into Share Resolution

In `src/backend/app/routers/clips.py`, inside `resolve_pending_shares()` (line 2336), after each successful `materialize_game_share()` + `resolve_pending_share()` (around line 2385-2391), attempt share-based attribution:

```python
# After resolve_pending_share(pending_id, request.profile_id) at line 2385:
# Attempt share-based referral attribution
try:
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT share_type FROM shares WHERE id = %s", (pending["share_id"],))
        share_row = cur.fetchone()
    if share_row:
        channel = SHARE_TYPE_TO_CHANNEL.get(share_row["share_type"])
        if channel:
            record_referral(pending["sharer_user_id"], user_id, channel, str(pending["share_id"]))
except Exception:
    logger.warning(f"[resolve-pending-shares] Referral attribution failed for pending_id={pending_id}", exc_info=True)
```

The UNIQUE constraint on `referred_id` ensures that if the user was already attributed via invite code (from signup), the share-based attribution is a no-op.

### 5. Invite Code Storage (Lazy Population)

T2900 generates invite codes as `sha256(user_id)[:8]` on the fly. T2910 needs to **also store** the code in the `invite_code` column so `resolve_invite_code()` can look it up.

Find the existing `GET /api/me/invite-code` endpoint (added in T2900) and add a write to persist the code:

```python
# In the invite-code endpoint handler:
invite_code = hashlib.sha256(user_id.encode()).hexdigest()[:8]
# Persist to users table for reverse lookup (T2910)
with get_pg() as conn:
    cur = conn.cursor()
    cur.execute(
        "UPDATE users SET invite_code = %s WHERE user_id = %s AND invite_code IS NULL",
        (invite_code, user_id),
    )
```

### 6. Admin Referral Endpoints

Add to `src/backend/app/routers/admin.py`, following the existing pattern (use `_require_admin()`, `get_pg()`, return dicts):

```
GET  /admin/referrals/leaderboard     -- referral counts by user, ordered desc
GET  /admin/referrals/by-channel      -- count per channel
GET  /admin/referrals/user/{user_id}  -- direct referrals for one user
GET  /admin/referrals/tree/{user_id}  -- recursive tree size (depth <= 5)
```

## Files to Modify

| File | Change |
|------|--------|
| `src/backend/app/migrations/postgres/v004_referral_graph.py` | **NEW** -- migration for referrals table + invite_code column |
| `src/backend/app/migrations/postgres/__init__.py` | Register v004 |
| `src/backend/app/services/pg.py` | Add referrals table + invite_code to `_SCHEMA_DDL` |
| `src/backend/app/routers/auth.py` | Call `record_referral()` in `_find_or_create_user()` for new users |
| `src/backend/app/routers/clips.py` | Hook referral attribution into `resolve_pending_shares()` |
| `src/backend/app/routers/admin.py` | 4 referral stats endpoints |
| Invite-code endpoint (find in T2900 changes) | Persist invite_code to users table on first call |
| `src/backend/app/services/sharing_db.py` or new `referral.py` | `record_referral()`, `resolve_invite_code()`, channel mapping |

## Edge Cases

- **Self-referral**: `referrer_id == referred_id` -- skip silently
- **Duplicate attribution**: UNIQUE on `referred_id` + `ON CONFLICT DO NOTHING` -- first attribution wins
- **Existing user logs in with ref**: No attribution (user already exists, no `create_user` path)
- **Multiple shares then signup**: Share attribution fires on each `resolve_pending_shares` call, but UNIQUE constraint means only the first one records
- **Invite code collision**: sha256[:8] has ~4B values, at <10K users collision probability is ~0.001%. UNIQUE index on invite_code catches it. If it happens, log a warning.

## Test Scope

**Backend unit tests:**
- `record_referral()` -- creates row, returns True
- `record_referral()` -- self-referral returns False
- `record_referral()` -- duplicate referred_id returns False (UNIQUE)
- `resolve_invite_code()` -- returns user_id for known code, None for unknown
- Channel mapping: all 3 share types map correctly

**Backend integration tests:**
- Signup with `ref` param -> referral row created with `channel='invite_link'`
- Signup without ref, then resolve pending share -> referral row created with share channel
- Signup with ref AND pending share -> only invite_link recorded (first wins)
- Admin leaderboard returns correct counts
- Admin by-channel returns correct breakdown

**Run tests:**
```bash
cd src/backend && .venv/Scripts/python.exe run_tests.py 2>&1 > /tmp/test-output.log; echo "exit: $?"
```

## Workflow Reminders

1. **Branch**: `git checkout -b feature/T2910-referral-graph`
2. **Classification first** (see CLAUDE.md Task Rules)
3. **Import check after every Python edit**: `cd src/backend && .venv/Scripts/python.exe -c "from app.main import app"`
4. **Postgres pattern**: Use `get_pg()` context manager, `%s` params, `RealDictCursor` (returns dicts)
5. **Migration pattern**: Subclass `BaseMigration`, implement `up(self, conn)`, register in `__init__.py`
6. **Commit with co-author**: end message with `Co-Authored-By: Claude <noreply@anthropic.com>`
7. **Set status to TESTING** in PLAN.md after implementation + tests pass -- never DONE
8. **Stage 6**: Generate a testing handoff file at `docs/plans/tasks/invite-referral/T2910-testing-kickoff.md` using the template in `.claude/workflows/6-manual-testing.md`
