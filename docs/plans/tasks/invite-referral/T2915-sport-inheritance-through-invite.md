# T2915: Sport Inheritance Through Invite

**Status:** DONE
**Impact:** 6
**Complexity:** 4
**Created:** 2026-06-17
**Updated:** 2026-06-20
**Requires migration:** YES (Postgres) — implement on a dedicated branch.

> **SHIPPED (diverged) — 2026-06-20.** Implemented as a **link snapshot**, NOT the live
> `users.default_sport` mirror this doc originally specced (a Postgres mirror was rejected as
> redundant state). The inviter's sport is frozen onto `referrals.inherited_sport`
> (migration `v017_referral_inherited_sport`) at invite-code fetch / sport edit, and onto
> `shares.sharer_default_sport` (`v018_share_sharer_sport`) for share channels. The invitee
> reads the snapshot via the referrals graph at first init and falls back to soccer.
> Extended to all share/invite channels in commit `c41a13a1` (also `74c7710b`, `04866524`).
> Prod Postgres migrated to v18 on 2026-06-20. The "Solution" below describes the original
> mirror design and is retained for history only.

## Problem

When user A invites user B, B starts on the generic `soccer` default. Most invites come from a parent already using the app for a specific sport (often a teammate's parent in the same sport). B's **default profile should inherit A's sport**, so B lands pre-configured for the sport they were invited into instead of having to discover the sport switcher and change it.

This was deferred off `feature/add-sports-...` because that branch carries no migration and this feature needs one. Build it on its own branch.

## Solution

Mirror each user's default-profile sport into a new Postgres column `users.default_sport`, written in the **owner's own request context** (where their per-user SQLite is local). At the invitee's first init, read the inviter's mirrored sport (via the existing `referrals` graph) and seed B's default profile with it. Fall back to `soccer` when there's no referral or no mirrored sport.

### Why a Postgres mirror (not a live cross-user SQLite read)

Sport lives **per-profile in per-user SQLite** (`user.sqlite` `profiles` table), not in Postgres. The referral is recorded in **user B's** request context, and B's default profile is created later in **B's** `_init_slow_path` — neither has reliable access to **A's** `user.sqlite`: in prod, sessions are machine-pinned (T1190), so A's SQLite may be on a different machine / only in R2. Reading it cross-user would mean an R2 download with a failure surface.

A small Postgres mirror sidesteps this: every cross-user read becomes a trivial, always-present Postgres lookup. The mirror is denormalized state, justified because you cannot join across per-user SQLite DBs. It is kept fresh by writing it only in the owner's context (see call sites).

### "A's sport" = A's **default** profile's sport

A user can have multiple profiles/sports; we inherit the **default** profile's sport (`is_default = 1`). In the common single-profile case this is simply A's only sport. (If we later want "A's currently-selected sport" instead, change `mirror_default_sport` to read the selected profile — but default is more stable.)

## Context

### Current behavior (verified during research)
- Referrals: Postgres `referrals` table `(referrer_id, referred_id, channel, source_id, created_at)`, UNIQUE on `referred_id`. Recorded at signup in `auth.py::_find_or_create_user(... ref=...)` → `record_referral(referrer_id, user_id, "invite_link", ref)`. See `app/services/sharing_db.py:433`.
- Invite code: deterministic `sha256(user_id)[:8]`, persisted via `persist_invite_code` in `app/routers/users.py::get_invite_code` (`GET /api/me/invite-code`).
- Default profile: created at **first login** (`/api/auth/init` → `session_init.py::_init_slow_path`, the `if not profile_id:` branch ~L136-141) via `create_profile(user_id, profile_id, name="", color="#6366f1", is_default=True)` — `sport` defaults to `"soccer"` in `user_db.py::create_profile`.
- Sport read: `user_db.py::get_profiles(user_id)` returns rows incl. `sport, is_default` from that user's local `user.sqlite`.
- Timing: signup (`record_referral`) happens **before** `/api/auth/init` (`_init_slow_path`), so the referral row exists when B's default profile is created. No race.

### Relevant Files (REQUIRED)
- `src/backend/app/migrations/postgres/v017_user_default_sport.py` — NEW migration (see Schema below).
- `src/backend/app/migrations/postgres/__init__.py` — register `V017UserDefaultSport` (import + add to `MIGRATIONS` list).
- `src/backend/app/services/pg.py` — add `default_sport TEXT` to the `users` table in `_SCHEMA_DDL` (fresh deploys; the migration covers existing DBs).
- `src/backend/app/services/sharing_db.py` — add the three helpers below (it already owns `record_referral` / `resolve_invite_code` and imports `get_pg`).
- `src/backend/app/session_init.py` — `_init_slow_path` new-user branch: inherit sport + mirror own sport.
- `src/backend/app/routers/users.py` — `get_invite_code`: mirror A's sport right before they share (covers existing inviters with no migration backfill).
- `src/backend/app/routers/profiles.py` — `update_profile`: mirror after a sport edit.
- Tests: extend `src/backend/tests/test_referrals.py` (uses the `pg_conn` fixture + `create_user`) or add `tests/test_sport_inheritance.py`.

### Related Tasks
- Builds on **T2910** (Referral Graph — the `referrals` table + attribution this reads from).
- Part of the **Invite & Referral** epic.

### Schema / migration (full mapping)
Postgres `users` gets one nullable column:

| Column | Type | Default | Meaning |
|--------|------|---------|---------|
| `default_sport` | `TEXT` | none (NULL) | Mirror of this user's default-profile `sport`. NULL = unknown → invitee falls back to `soccer`. |

Migration body (idempotent):
```python
class V017UserDefaultSport(BaseMigration):
    version = 17
    description = "Add users.default_sport mirror for sport inheritance through invite"
    def up(self, conn):
        conn.cursor().execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_sport TEXT")
```
Also add `default_sport TEXT` to the `users` `CREATE TABLE` in `pg.py::_SCHEMA_DDL` (add a comma after `invite_code VARCHAR(8)`). Migrations do NOT auto-run — trigger via `POST /api/admin/migrate` (or fly ssh) per env after deploy.

## Implementation

### 1. `sharing_db.py` helpers
```python
def set_user_default_sport(user_id: str, sport: str) -> None:
    """Mirror a user's default-profile sport onto their Postgres users row."""
    if not sport:
        return
    with get_pg() as conn:
        conn.cursor().execute(
            "UPDATE users SET default_sport = %s WHERE user_id = %s", (sport, user_id))

def get_inherited_sport(referred_id: str) -> str | None:
    """The inviter's mirrored default sport for a referred user, or None."""
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute(
            """SELECT u.default_sport FROM referrals r
               JOIN users u ON u.user_id = r.referrer_id
               WHERE r.referred_id = %s""", (referred_id,))
        row = cur.fetchone()
        return row["default_sport"] if row and row["default_sport"] else None

def mirror_default_sport(user_id: str) -> None:
    """Read the user's default-profile sport from their LOCAL per-user SQLite and
    mirror it to Postgres. OWNER context only (user.sqlite must be local).
    Best-effort — never raise into the caller."""
    try:
        from app.services.user_db import get_profiles
        profiles = get_profiles(user_id)
        if not profiles:
            return
        default = next((p for p in profiles if p.get("is_default")), profiles[0])
        if default.get("sport"):
            set_user_default_sport(user_id, default["sport"])
    except Exception as e:
        logger.warning(f"[referral] mirror_default_sport failed for {user_id}: {e}")
```

### 2. `session_init.py::_init_slow_path` — inherit on default-profile creation
In the `if not profile_id:` branch, replace the hardcoded-soccer `create_profile` with:
```python
inherited_sport = None
try:
    from .services.sharing_db import get_inherited_sport
    inherited_sport = get_inherited_sport(user_id)
except Exception as e:
    logger.warning(f"Sport inheritance lookup failed for {user_id}: {e}")
sport = inherited_sport or "soccer"
create_profile(user_id, profile_id, name="", color="#6366f1", is_default=True, sport=sport)
set_selected_profile_id(user_id, profile_id)
logger.info(f"Created new profile {profile_id} for user {user_id}"
            + (f" (inherited sport={sport})" if inherited_sport else ""))
try:
    from .services.sharing_db import set_user_default_sport
    set_user_default_sport(user_id, sport)   # so THIS user can pass it on as an inviter
except Exception as e:
    logger.warning(f"Failed to mirror default sport for {user_id}: {e}")
```

### 3. `routers/users.py::get_invite_code` — keep the inviter's mirror fresh
After `persist_invite_code(user_id, code)`, add `mirror_default_sport(user_id)`. This is the key step that makes **existing** inviters work without a backfill: their current default sport is mirrored the moment they open their invite link.

### 4. `routers/profiles.py::update_profile` — mirror on sport edit
After `db_update_profile(...)`, call `mirror_default_sport(user_id)` (best-effort) so a later sport change is reflected for future invitees.

### Steps
1. [ ] Branch `feature/T2915-sport-inheritance-through-invite`.
2. [ ] Write migration v017 + register it + update `_SCHEMA_DDL`.
3. [ ] Add the three `sharing_db` helpers.
4. [ ] Wire `_init_slow_path`, `get_invite_code`, `update_profile`.
5. [ ] Tests (below).
6. [ ] `from app.main import app` import check; run `tests/test_referrals.py` + new tests.
7. [ ] After deploy: run the migration per env (admin endpoint / fly ssh).

## Acceptance Criteria

- [ ] `get_inherited_sport(B)` returns A's `default_sport` when a referral A→B exists; returns None when no referral or A's `default_sport` is NULL.
- [ ] A new referred user's default profile is created with the inviter's sport; an un-referred user still gets `soccer`.
- [ ] `mirror_default_sport` updates Postgres from the owner's local SQLite; fetching the invite code refreshes it.
- [ ] Editing the default profile's sport updates `users.default_sport`.
- [ ] Migration is idempotent (`ADD COLUMN IF NOT EXISTS`) and `_SCHEMA_DDL` matches for fresh deploys.
- [ ] No cross-user SQLite reads in the invitee's path (all cross-user reads are Postgres).
- [ ] `tests/test_referrals.py` still passes; new inheritance tests pass.

## Edge Cases / Notes
- **Existing inviters (pre-deploy):** `default_sport` is NULL until they next fetch their invite code or edit their sport → invitee falls back to `soccer`. Acceptable (new-signups-forward, like Storage Credits). No backfill required.
- **Multi-profile inviter:** inherits the **default** profile's sport only.
- **Custom ("Other") sports:** stored as the free-text value; mirrored and inherited verbatim (the invitee's tag UI handles unknown sports with the fallback glyph and no tag set).
- **Self-referral / no ref:** `get_inherited_sport` returns None → `soccer`.
- Tests TRUNCATE the dev Postgres (guard blocks staging/prod) — warn before running locally.
