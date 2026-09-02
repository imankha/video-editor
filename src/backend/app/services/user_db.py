"""
Per-user database — user.sqlite for credits, billing, and recovery data.

Unlike auth.sqlite (shared by all users) or profile databases (per-profile),
this is a per-user database stored at user_data/<user_id>/user.sqlite.
It stores:
  - credits: current credit balance
  - credit_transactions: full ledger of credit changes
  - credit_reservations: held credits for in-progress exports (T890)
  - stripe_customers: Stripe billing customer IDs

Sync strategy:
  - R2 sync via TrackedConnection write tracking (same as profile DB)
  - Version-based optimistic locking
  - Middleware syncs after request if user DB had writes
"""

import logging
import sqlite3
import threading
import time
from contextlib import contextmanager
from pathlib import Path

logger = logging.getLogger(__name__)

# R2 restore cooldown — avoids hammering R2 on transient failures
_r2_user_restore_cooldowns: dict[str, float] = {}  # user_id -> last failure timestamp
USER_RESTORE_COOLDOWN_SECONDS = 30

USER_DATA_BASE = Path(__file__).parent.parent.parent.parent.parent / "user_data"

# Track initialized user DBs
_initialized_user_dbs: set = set()
_init_lock = threading.Lock()

_USER_DB_SCHEMA = """
    CREATE TABLE IF NOT EXISTS credits (
        user_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS credit_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        source TEXT NOT NULL,
        reference_id TEXT,
        video_seconds REAL,
        created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_tx_idempotent
    ON credit_transactions(user_id, source, reference_id)
    WHERE reference_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_credit_tx_user
    ON credit_transactions(user_id);

    CREATE TABLE IF NOT EXISTS credit_reservations (
        job_id TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        video_seconds REAL,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stripe_customers (
        user_id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS completed_quests (
        quest_id TEXT PRIMARY KEY,
        completed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        sport TEXT NOT NULL DEFAULT 'no_sport',
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_activity (
        user_id TEXT PRIMARY KEY,
        session_count INTEGER NOT NULL DEFAULT 0,
        pwa_session_count INTEGER NOT NULL DEFAULT 0,
        last_active_at TEXT,
        last_export_at TEXT,
        total_usage_seconds INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_activity_events (
        event TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        first_at TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS user_action_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        context TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_action_log_action ON user_action_log(action);
    CREATE INDEX IF NOT EXISTS idx_action_log_created ON user_action_log(created_at);
"""


def _get_user_db_path(user_id: str) -> Path:
    return USER_DATA_BASE / user_id / "user.sqlite"


def ensure_user_database(user_id: str) -> None:
    """Create user.sqlite with schema if it doesn't exist.

    On first access, attempts R2 restore with NOT_FOUND vs ERROR distinction:
    - NOT_FOUND: genuinely new user, lock version to 0
    - ERROR: transient failure, retry after cooldown
    """
    with _init_lock:
        if user_id in _initialized_user_dbs:
            # Verify the DB file still exists (may have been deleted by reset script)
            db_path = _get_user_db_path(user_id)
            if db_path.exists():
                return
            # File gone — remove from cache and re-initialize
            _initialized_user_dbs.discard(user_id)

    db_path = _get_user_db_path(user_id)
    db_path.parent.mkdir(parents=True, exist_ok=True)

    # R2 restore on first access (before schema creation so restored DB is used)
    from .. import migrations
    from ..database import (
        USER_DB_SCOPE,
        clear_sync_pending,
        get_local_user_db_version,
        read_pending_token,
        set_local_user_db_version,
    )
    from ..storage import R2_ENABLED, sync_user_db_from_r2_if_newer

    if R2_ENABLED:
        local_version = get_local_user_db_version(user_id)
        # T6910: local_version is an in-process cache with no tie to the file on
        # disk -- if the file was deleted out-of-band (not via forget_user_db),
        # a stale non-None version here would skip the restore below and let a
        # brand-new BLANK db silently replace the real one.
        if local_version is None or not db_path.exists():
            # Check cooldown
            last_fail = _r2_user_restore_cooldowns.get(user_id)
            if last_fail and (time.time() - last_fail) < USER_RESTORE_COOLDOWN_SECONDS:
                logger.debug(f"[Restore] Skipping user.sqlite R2 check for {user_id} — cooldown active")
            else:
                from ..user_context import get_current_req_id
                req_id = get_current_req_id()
                req_suffix = f" req_id={req_id}" if req_id else ""
                logger.info(f"[Restore] First access for user.sqlite user={user_id}, checking R2...{req_suffix}")
                # T6160: WAL safety — a conflict can re-trigger this first-access
                # restore on a RUNNING machine (schedule_user_db_reheal), where a
                # live connection may hold user.sqlite open. Gate the DOWNLOAD (not
                # the version check) so a live connection blocks only the swap, as
                # ensure_user_database_fresh already does.
                from .db_refresh import clear_stale_wal_sidecars, wal_sidecars_present
                restore_start = time.perf_counter()
                # T6910: a stale cached version number describes a file that's no
                # longer there -- treat it as unknown (None) so the R2 version
                # compare below can't wrongly skip the download on a "local >= r2"
                # read of a version that has no corresponding local file.
                version_for_compare = local_version if db_path.exists() else None
                # T5081 (INV-P reason b, site 2): capture BEFORE the download --
                # this is precisely the path a CAS conflict re-triggers on an
                # ORDINARY request (schedule_user_db_reheal nulled the cached
                # version), so this is very often the actual restore that
                # discharges a .sync_pending record a conflict-retry endpoint
                # will look at later and find already resolved. See the INV-P
                # comment in database.py.
                pending_token = read_pending_token(user_id, USER_DB_SCOPE)
                was_synced, new_version, was_error = sync_user_db_from_r2_if_newer(
                    user_id, db_path, version_for_compare,
                    before_download=lambda: not wal_sidecars_present(db_path),
                )
                restore_elapsed = time.perf_counter() - restore_start
                if was_synced:
                    clear_stale_wal_sidecars(db_path)
                    logger.info(
                        f"[Restore] Downloaded user.sqlite from R2 for user={user_id}: "
                        f"version={new_version}, took {restore_elapsed:.2f}s{req_suffix}"
                    )
                    set_local_user_db_version(user_id, new_version)
                    clear_sync_pending(user_id, USER_DB_SCOPE, if_token=pending_token)
                elif was_error:
                    _r2_user_restore_cooldowns[user_id] = time.time()
                    logger.warning(
                        f"[Restore] R2 unreachable for user.sqlite user={user_id}, "
                        f"will retry after {USER_RESTORE_COOLDOWN_SECONDS}s (took {restore_elapsed:.2f}s){req_suffix}"
                    )
                elif new_version is not None:
                    logger.info(
                        f"[Restore] user.sqlite up-to-date for user={user_id}: "
                        f"version={new_version}, took {restore_elapsed:.2f}s{req_suffix}"
                    )
                    set_local_user_db_version(user_id, new_version)
                else:
                    # NOT_FOUND — genuinely new user
                    logger.info(
                        f"[Restore] No user.sqlite in R2 for user={user_id}, "
                        f"starting fresh (took {restore_elapsed:.2f}s){req_suffix}"
                    )
                    set_local_user_db_version(user_id, 0)

        # T5083 fix (2026-08-31 CI escalation, FIX 1): the seam runs BEFORE
        # schema creation, not after, and stays INSIDE `if R2_ENABLED:` as a
        # sibling of the restore branch above (mirrors database.py's profile
        # seam exactly). `executescript(_USER_DB_SCHEMA)` below is the
        # CURRENT (head) schema — for a table that's fully ABSENT in an old
        # restored user.sqlite, CREATE TABLE IF NOT EXISTS would create it in
        # its FULL CURRENT shape, so a migration running AFTER that step
        # finds the column ALREADY present and a bare `ALTER TABLE ADD
        # COLUMN` blows up with "duplicate column name" (mirrors
        # test_r2_restore_retry.py's repro: a restored user.sqlite below v004
        # was bricked on every future request). Moving the seam here means it
        # always sees the genuinely-restored below-head bytes, before schema
        # creation can paper over missing tables/columns.
        #
        # T5085 extracted the body into migrations.run_user_seam() so every
        # non-login opener of user.sqlite (admin cross-user reads, webhook
        # fulfilment, ensure_user_database_fresh's own post-swap re-check)
        # shares this exact logic instead of a second copy.
        migrations.run_user_seam(user_id)

    is_fresh_db = not db_path.exists()

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")
    conn.execute("PRAGMA foreign_keys=ON")

    conn.executescript(_USER_DB_SCHEMA)

    if is_fresh_db:
        from ..migrations.user_db import RUNNER as USER_DB_RUNNER
        conn.execute(f"PRAGMA user_version = {USER_DB_RUNNER.latest_version}")

    conn.close()

    # T5840: credits moved to Postgres (credit_ledger.py) -- the legacy `credits`
    # table stays in _USER_DB_SCHEMA unread AND unwritten (pre-migration record /
    # rollback substrate only; dropped in a later user_db migration).

    with _init_lock:
        _initialized_user_dbs.add(user_id)


def schedule_user_db_reheal(user_id: str) -> None:
    """T6160 (decision 4): after a user.sqlite CAS conflict, make the next
    ensure_user_database re-pull R2's newer copy.

    Sibling of database.schedule_profile_db_reheal, but user.sqlite is stickier:
    ensure_user_database early-returns on _initialized_user_dbs membership BEFORE
    it ever checks the version, so clearing the version alone does nothing — the
    init flag must be dropped too. The version cache is memory-only (no persisted
    file row), so there is nothing on disk to clear. The restore cooldown is
    cleared because a conflict means R2 was just reachable. The baseline is NOT
    advanced (that would disarm CAS); the refused edit is discarded on re-pull.
    """
    from ..database import set_local_user_db_version
    set_local_user_db_version(user_id, None)
    with _init_lock:
        _initialized_user_dbs.discard(user_id)
    _r2_user_restore_cooldowns.pop(user_id, None)


def ensure_user_database_fresh(user_id: str) -> None:
    """Write-path sibling of ensure_user_database: restore-if-newer, not just
    restore-if-absent (T4315).

    ensure_user_database only re-checks R2 when `local_version is None`
    (first access) -- once a machine has materialized this user's file it
    serves that snapshot for the rest of the process lifetime and never
    looks at R2 again. That is fine for reads, but a WRITER must not force-
    push (skip_version_check=True on upload) on top of an R2 copy it never
    confirmed is still the one it loaded from: an out-of-band R2 edit, or a
    write that landed elsewhere while this machine was pinned away and back,
    would otherwise be silently reverted on this machine's next write (the
    "editing R2 out-of-band is futile" failure mode from the 2026-07-24
    incident). Raises RefreshFailed instead of proceeding when R2 can't be
    reached -- never build on an unconfirmed copy.

    Callers resolving a user.sqlite they are about to WRITE (not their own
    ambient session's lenient read) should call this via
    services.db_refresh.confirm_current_before_write(user_id) rather than
    ensure_user_database directly.

    WAL safety (T4315 round 3 correction): a `-wal`/`-shm` sidecar present
    for this user.sqlite is a strong signal that ANOTHER connection has this
    exact file open RIGHT NOW (SQLite deletes both when the last connection
    closes cleanly) -- e.g. the same user actively writing on this machine
    while a foreign caller (admin grant, teammate-share materialization)
    concurrently confirms freshness. That connection's committed-but-not-
    yet-checkpointed frames could hold data never uploaded to R2; "R2 is
    newer" says nothing about whether those frames matter, so refusing the
    SWAP is the safe move. round 2 checked this BEFORE the R2 version
    comparison, which refused even the overwhelmingly common "local already
    current, nothing to download" case (BLOCKING NEW-B) -- sidecars merely
    mean some unrelated connection has the file open, not that a download is
    imminent. Fixed: the check is now `before_download`, consulted by
    sync_user_db_from_r2_if_newer ONLY once it has already decided R2 is
    newer and a download is about to happen.
    """
    ensure_user_database(user_id)

    from ..database import get_local_user_db_version, set_local_user_db_version
    from ..storage import R2_ENABLED, sync_user_db_from_r2_if_newer
    from .db_refresh import RefreshFailed, clear_stale_wal_sidecars, wal_sidecars_present

    if not R2_ENABLED:
        return

    db_path = _get_user_db_path(user_id)

    # T5081 (INV-P reason b, site 3): capture the pending token before the
    # restore attempt, same as the upload path's reason (a) -- see the INV-P
    # comment in database.py. A restore-if-newer that actually replaces local
    # content discharges whatever committed-but-unconfirmed write earned this
    # scope its marker.
    from ..database import USER_DB_SCOPE, clear_sync_pending, read_pending_token
    pending_token = read_pending_token(user_id, USER_DB_SCOPE)

    local_version = get_local_user_db_version(user_id)
    downloaded, new_version, was_error = sync_user_db_from_r2_if_newer(
        user_id, db_path, local_version,
        before_download=lambda: not wal_sidecars_present(db_path),
    )
    if was_error:
        raise RefreshFailed(
            f"could not confirm user.sqlite for {user_id} is current (R2 error)"
        )
    if downloaded:
        # Defense-in-depth for the narrow window between before_download's
        # check and this download completing -- see clear_stale_wal_sidecars.
        clear_stale_wal_sidecars(db_path)
    if downloaded and new_version is not None:
        # Gated the same way as sites 1/2/4 (baseline recorded AND cleared
        # together) rather than on `downloaded` alone: this pairing is what
        # makes INV-P reason (b) true as stated -- clearing without a
        # confirmed baseline would discharge the durability record while
        # leaving CAS unable to ever upload from this scope again.
        set_local_user_db_version(user_id, new_version)
        clear_sync_pending(user_id, USER_DB_SCOPE, if_token=pending_token)

    if downloaded:
        # T5085: ensure_user_database() above already ran the seam and marked
        # this (user, USER_DB_SCOPE) pair verified-at-head -- but the swap
        # just replaced the FILE on disk. The new bytes can be sync-NEWER
        # (that's why sync_user_db_from_r2_if_newer downloaded them) while
        # schema-BELOW-head: a rolling-deploy peer machine still on old code
        # can write sync-newer, schema-older content (EPIC decision 8).
        # `sync_user_db_from_r2_if_newer` (storage.py) already cleared
        # `_seam_verified` for this scope as part of the download itself --
        # the load-bearing part here is RE-RUNNING the seam, restore-then-
        # migrate, same ordering every other seam call site uses. Gated on
        # `downloaded` alone (not `new_version is not None`) because the
        # bytes changed regardless; this is what protects the caller about
        # to open and write this exact file.
        from .. import migrations
        migrations.run_user_seam(user_id)


def forget_user_db(user_id: str) -> None:
    """Drop every in-process cache entry for a user's user.sqlite + profile DBs.

    Called on account deletion so a same-process relogin re-initialises from scratch
    (or from R2) instead of trusting a stale in-memory flag/version. Pairs with the
    local-folder + R2 purge in the delete handlers.
    """
    with _init_lock:
        _initialized_user_dbs.discard(user_id)
    _r2_user_restore_cooldowns.pop(user_id, None)
    from ..database import forget_local_db_state
    forget_local_db_state(user_id)


@contextmanager
def get_user_db_connection(user_id: str | None = None):
    """Get connection to user-level database.

    T4315 round 2 (MAJOR-4): "refresh-or-fail" is meant to be the RULE for
    any writer resolving a foreign (non-ambient-session) user.sqlite, not a
    guard each caller has to remember to bolt on -- this is the structural
    enforcement point. When an explicit user_id differs from the request's
    own session user, this confirms freshness (raising RefreshFailed on an
    R2 error) even if the caller forgot to call confirm_current_before_write
    itself. Skips the HEAD when this user was already confirmed moments ago
    on the SAME call chain (db_refresh.user_db_was_recently_confirmed) so a
    caller that DID the right thing explicitly (admin.py, payments.py) never
    pays it twice, and never gets a second blocking HEAD reintroduced onto
    whatever thread it's running on. Outside a request context (no session
    to compare against -- background workers) this falls back to the
    existing lenient ensure_user_database, unchanged.
    """
    if user_id is None:
        from ..user_context import get_current_user_id
        user_id = get_current_user_id()
        ensure_user_database(user_id)
    else:
        session_user_id = None
        try:
            from ..user_context import get_current_user_id
            session_user_id = get_current_user_id()
        except RuntimeError:
            session_user_id = None

        if session_user_id and user_id != session_user_id:
            from .db_refresh import confirm_current_before_write, user_db_was_recently_confirmed
            if user_db_was_recently_confirmed(user_id):
                ensure_user_database(user_id)
            else:
                confirm_current_before_write(user_id)
        else:
            ensure_user_database(user_id)

    db_path = _get_user_db_path(user_id)

    from ..database import TrackedConnection

    raw_conn = sqlite3.connect(str(db_path), timeout=30)
    raw_conn.row_factory = sqlite3.Row
    raw_conn.execute("PRAGMA journal_mode=WAL")
    raw_conn.execute("PRAGMA busy_timeout=30000")
    raw_conn.execute("PRAGMA foreign_keys=ON")

    # owner_user_id is the ARG, not the session user: that is the whole point --
    # a handler writing another user's DB must be syncable by the middleware.
    conn = TrackedConnection(raw_conn, db_type='user', owner_user_id=user_id)
    try:
        yield conn
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Credit operations -- MOVED to app/services/credit_ledger.py (T5840, Postgres).
# The legacy `credits`/`credit_transactions` tables stay in _USER_DB_SCHEMA
# above, unread and unwritten (pre-migration record / rollback substrate; a
# later user_db migration drops them ~30 days after prod verification).
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Stripe customer management
# ---------------------------------------------------------------------------

def get_stripe_customer_id(user_id: str) -> str | None:
    """Get Stripe customer ID for a user."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT customer_id FROM stripe_customers WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return row["customer_id"] if row else None


def set_stripe_customer_id(user_id: str, stripe_customer_id: str):
    """Save Stripe customer ID for a user."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO stripe_customers (user_id, customer_id) VALUES (?, ?)",
            (user_id, stripe_customer_id),
        )
        conn.commit()
    logger.info(f"[UserDB] Set stripe_customer_id for {user_id}")


# ---------------------------------------------------------------------------
# Credit reservations + admin credit stats -- MOVED to credit_ledger.py (T5840).
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Completed quests (T970: user-scoped quest achievements)
# ---------------------------------------------------------------------------

def mark_quest_completed(user_id: str, quest_id: str) -> None:
    """Record a quest as completed in user.sqlite. Idempotent (INSERT OR IGNORE)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR IGNORE INTO completed_quests (quest_id) VALUES (?)",
            (quest_id,),
        )
        conn.commit()
    logger.info(f"[UserDB] Quest {quest_id} marked completed for user {user_id}")


def get_completed_quest_ids(user_id: str) -> set[str]:
    """Return set of quest_ids the user has completed."""
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute("SELECT quest_id FROM completed_quests").fetchall()
        return {row["quest_id"] for row in rows}


def get_completed_and_claimed_quest_ids(user_id: str) -> tuple[set[str], set[str]]:
    """Return (completed_quest_ids, claimed_quest_ids).

    T5840: credits (and their credit_transactions ledger) moved to Postgres, so
    the claimed set is now a separate PG query -- completed_quests itself stays
    in user.sqlite (T1536's single-open optimisation applied to a cold R2
    restore that no longer exists for the ledger; both stores are fast).

    - completed: SELECT quest_id FROM completed_quests (was get_completed_quest_ids)
    - claimed:   credit_transactions WHERE source = 'quest_reward' (Postgres)
    """
    with get_user_db_connection(user_id) as conn:
        completed = {
            row["quest_id"]
            for row in conn.execute("SELECT quest_id FROM completed_quests").fetchall()
        }
    from .pg import get_pg
    with get_pg() as pg_conn:
        cur = pg_conn.cursor()
        cur.execute(
            "SELECT reference_id FROM credit_transactions WHERE user_id = %s AND source = 'quest_reward'",
            (user_id,),
        )
        claimed = {row["reference_id"] for row in cur.fetchall()}
    return completed, claimed


def backfill_completed_quests(user_id: str) -> int:
    """Backfill completed_quests from the Postgres quest_reward ledger.

    Idempotent — INSERT OR IGNORE. Called once during session init.
    Returns count of newly backfilled quests.
    """
    from .pg import get_pg
    with get_pg() as pg_conn:
        cur = pg_conn.cursor()
        cur.execute(
            "SELECT reference_id FROM credit_transactions "
            "WHERE user_id = %s AND source = 'quest_reward' AND reference_id IS NOT NULL",
            (user_id,),
        )
        quest_ids = [row["reference_id"] for row in cur.fetchall()]

    if not quest_ids:
        return 0

    count = 0
    with get_user_db_connection(user_id) as conn:
        for quest_id in quest_ids:
            result = conn.execute(
                "INSERT OR IGNORE INTO completed_quests (quest_id) VALUES (?)",
                (quest_id,),
            )
            if result.rowcount > 0:
                count += 1
        if count > 0:
            conn.commit()
            logger.info(f"[UserDB] Backfilled {count} completed quests for user {user_id}")
    return count


# ---------------------------------------------------------------------------
# Profile management (T960: profiles in user.sqlite)
# ---------------------------------------------------------------------------

def get_profiles(user_id: str) -> list[dict]:
    """Return all profiles for a user, ordered by creation time."""
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT id, name, color, sport, is_default, created_at FROM profiles ORDER BY created_at"
        ).fetchall()
        return [dict(r) for r in rows]


def get_default_profile_sport(user_id: str) -> str | None:
    """The user's default-profile sport, or None if unknown.

    Best-effort: meant to be called in the user's OWN request, where their
    user.sqlite is local (no R2 download). A missing/unreadable profile just
    yields None -> the invitee falls back to the generic default. Used to snapshot
    the inviter's sport onto invite links / share rows for inheritance (T2915)."""
    try:
        profiles = get_profiles(user_id)
        if not profiles:
            return None
        default = next((p for p in profiles if p.get("is_default")), profiles[0])
        return default.get("sport")
    except Exception as e:
        logger.warning(f"[UserDB] could not read default sport for {user_id}: {e}")
        return None


def get_selected_profile_id(user_id: str) -> str | None:
    """Return the selected profile ID from user_settings, or None."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = 'selected_profile'"
        ).fetchone()
        return row["value"] if row else None


def set_selected_profile_id(user_id: str, profile_id: str) -> None:
    """Set the selected profile in user_settings."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES ('selected_profile', ?)",
            (profile_id,),
        )
        conn.commit()


# Opt-out flag for notification emails (T7670). This is the FIRST notification-
# email preference surface, so it is intentionally a single user-level boolean
# in the existing user_settings KV (no schema/migration, no preferences UI).
# Absent key = opted IN (the default): a user only skips the game-ready email
# after an explicit opt-out. Add finer-grained keys here if more notification
# emails are introduced later.
_NOTIFICATION_EMAIL_OPTOUT_KEY = "notification_email_optout"


def get_notification_email_optout(user_id: str) -> bool:
    """True if the user has opted out of notification emails (default False)."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            (_NOTIFICATION_EMAIL_OPTOUT_KEY,),
        ).fetchone()
        return bool(row) and row["value"] == "1"


def set_notification_email_optout(user_id: str, opted_out: bool) -> None:
    """Set (or clear) the notification-email opt-out flag for a user."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (_NOTIFICATION_EMAIL_OPTOUT_KEY, "1" if opted_out else "0"),
        )
        conn.commit()


# T8120: collapsed/expanded state of the onboarding quest (Help) panel. A
# user-level UI preference persisted in the existing user_settings KV (no
# schema/migration) so a collapse survives navigation AND reload — the collapse
# click is the gesture. Absent key = expanded (the default first-run
# presentation); the panel never auto-re-expands once this is "1".
_QUEST_PANEL_COLLAPSED_KEY = "quest_panel_collapsed"


def get_quest_panel_collapsed(user_id: str) -> bool:
    """True if the user has collapsed the quest/help panel (default False)."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            (_QUEST_PANEL_COLLAPSED_KEY,),
        ).fetchone()
        return bool(row) and row["value"] == "1"


def set_quest_panel_collapsed(user_id: str, collapsed: bool) -> None:
    """Persist the collapsed state of the quest/help panel (gesture-driven)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (_QUEST_PANEL_COLLAPSED_KEY, "1" if collapsed else "0"),
        )
        conn.commit()


# Parental-consent attestation for player-intro cards (T5190). Stored per
# profile in the user.sqlite settings KV (keyed by profile id) rather than a
# profiles column: consent must appear on the GET /api/profiles payload, which
# is built entirely from user.sqlite, so keeping it here reads every profile's
# consent in the same DB instead of opening each profile.sqlite. No migration.
INTRO_CONSENT_PREFIX = "intro_consent_at."


def _intro_consent_key(profile_id: str) -> str:
    return f"{INTRO_CONSENT_PREFIX}{profile_id}"


def get_intro_consent(user_id: str | None, profile_id: str) -> str | None:
    """Return the ISO timestamp the parent/guardian consented for this profile,
    or None if consent has never been recorded (or was revoked)."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            (_intro_consent_key(profile_id),),
        ).fetchone()
        return row["value"] if row else None


def set_intro_consent(user_id: str | None, profile_id: str, timestamp: str) -> None:
    """Record parental-consent attestation for a profile (gesture-driven).

    Recorded once per profile; a second tick simply refreshes the timestamp.
    """
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (_intro_consent_key(profile_id), timestamp),
        )
        conn.commit()


def clear_intro_consent(user_id: str | None, profile_id: str) -> None:
    """Revoke parental consent for a profile (T5230 purge / explicit revoke).

    With the row gone, get_intro_consent returns None so the checkbox re-shows.
    """
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "DELETE FROM user_settings WHERE key = ?",
            (_intro_consent_key(profile_id),),
        )
        conn.commit()


def get_all_intro_consents(user_id: str | None = None) -> dict[str, str]:
    """Map of profile_id -> consent ISO timestamp for every consented profile.

    Read alongside the profiles list so GET /api/profiles can expose consent
    without opening any profile.sqlite.
    """
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_settings WHERE key LIKE ?",
            (f"{INTRO_CONSENT_PREFIX}%",),
        ).fetchall()
        return {row["key"][len(INTRO_CONSENT_PREFIX):]: row["value"] for row in rows}


# Per-profile intro photo key, stored the same way as intro consent and for the
# same reason (T5190 follow-up): the image upload endpoint returned a key that
# nothing persisted, so a refresh lost the photo. T5195's intro_cards row was
# never the right home for the PROFILE-level photo (a profile has no card row
# until one is created) — this KV entry is the source of truth; a future card
# may default its own image from it. No migration.
INTRO_PHOTO_KEY_PREFIX = "intro_photo_key."


def _intro_photo_key_setting(profile_id: str) -> str:
    return f"{INTRO_PHOTO_KEY_PREFIX}{profile_id}"


def get_intro_photo_key(user_id: str | None, profile_id: str) -> str | None:
    """Return the stored R2 key for a profile's intro photo, or None."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            (_intro_photo_key_setting(profile_id),),
        ).fetchone()
        return row["value"] if row else None


def set_intro_photo_key(user_id: str | None, profile_id: str, key: str) -> None:
    """Persist the R2 key for a profile's intro photo (gesture-driven: upload)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (_intro_photo_key_setting(profile_id), key),
        )
        conn.commit()


def clear_intro_photo_key(user_id: str | None, profile_id: str) -> None:
    """Clear the stored intro photo key (gesture-driven: remove / purge)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "DELETE FROM user_settings WHERE key = ?",
            (_intro_photo_key_setting(profile_id),),
        )
        conn.commit()


def get_all_intro_photo_keys(user_id: str | None = None) -> dict[str, str]:
    """Map of profile_id -> R2 key for every profile with a stored intro photo.

    Read alongside the profiles list so GET /api/profiles and /api/bootstrap can
    expose introPhotoKey/introPhotoUrl without opening any profile.sqlite.
    """
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_settings WHERE key LIKE ?",
            (f"{INTRO_PHOTO_KEY_PREFIX}%",),
        ).fetchall()
        return {row["key"][len(INTRO_PHOTO_KEY_PREFIX):]: row["value"] for row in rows}


# Structured player-intro facts (T5190 follow-up, epic decision 3 REVERSED
# 2026-08-04): position, class (grad year) and team are named profile fields so
# the card layout (epic decision 2) can be DERIVED from how many are set --
# free text has no field count to derive from. Same per-profile user_settings
# KV mechanism as consent/photo, keyed by field so each is independently
# readable/writable/clearable. No migration. All three optional: an absent
# value is a real state (fewer facts -> a plainer composition), never a
# substituted placeholder -- that judgment belongs to the card editor (T5205).
INTRO_FACT_FIELDS = ("position", "class", "team")
# The card TITLE source (T6570): the athlete's full name, a property of the
# player, not of a card. Stored with the SAME per-profile user_settings KV
# mechanism as the facts, but it is NOT a fact -- it never counts toward the
# composition fact-count (the title is always present, like the treatment axis).
# Kept separate from INTRO_FACT_FIELDS for exactly that reason; do not fold it in.
INTRO_FULL_NAME_FIELD = "full_name"
# All per-profile intro TEXT fields share the intro_{field}.{profile_id} key.
_INTRO_TEXT_FIELDS = (*INTRO_FACT_FIELDS, INTRO_FULL_NAME_FIELD)
_INTRO_FIELD_PREFIXES = {field: f"intro_{field}." for field in _INTRO_TEXT_FIELDS}


def _intro_fact_setting(field: str, profile_id: str) -> str:
    return f"{_INTRO_FIELD_PREFIXES[field]}{profile_id}"


def get_intro_fact(user_id: str | None, profile_id: str, field: str) -> str | None:
    """Return the stored value for one intro fact field, or None if unset."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            "SELECT value FROM user_settings WHERE key = ?",
            (_intro_fact_setting(field, profile_id),),
        ).fetchone()
        return row["value"] if row else None


def set_intro_fact(user_id: str | None, profile_id: str, field: str, value: str) -> None:
    """Persist one intro fact field for a profile (gesture-driven: blur/save)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (_intro_fact_setting(field, profile_id), value),
        )
        conn.commit()


def clear_intro_fact(user_id: str | None, profile_id: str, field: str) -> None:
    """Clear one intro fact field (gesture-driven: emptied on blur, or T5230 purge)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "DELETE FROM user_settings WHERE key = ?",
            (_intro_fact_setting(field, profile_id),),
        )
        conn.commit()


def get_all_intro_facts(user_id: str | None = None) -> dict[str, dict[str, str]]:
    """Map of profile_id -> {field: value} for every stored intro fact.

    Read alongside the profiles list so GET /api/profiles and /api/bootstrap can
    expose position/class/team without opening any profile.sqlite.
    """
    result: dict[str, dict[str, str]] = {}
    with get_user_db_connection(user_id) as conn:
        for field in INTRO_FACT_FIELDS:
            prefix = _INTRO_FIELD_PREFIXES[field]
            rows = conn.execute(
                "SELECT key, value FROM user_settings WHERE key LIKE ?",
                (f"{prefix}%",),
            ).fetchall()
            for row in rows:
                profile_id = row["key"][len(prefix):]
                result.setdefault(profile_id, {})[field] = row["value"]
    return result


def get_all_intro_full_names(user_id: str | None = None) -> dict[str, str]:
    """Map of profile_id -> full name for every profile that has set one.

    The card TITLE source (T6570). Read alongside the profiles list / bootstrap
    so GET /api/profiles exposes it without a second fetch, exactly like the
    intro facts above.
    """
    prefix = _INTRO_FIELD_PREFIXES[INTRO_FULL_NAME_FIELD]
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_settings WHERE key LIKE ?",
            (f"{prefix}%",),
        ).fetchall()
    return {row["key"][len(prefix):]: row["value"] for row in rows}


PREF_PREFIX = "pref."


def get_all_preferences(user_id: str | None = None) -> dict[str, str]:
    """Return all preference key-value pairs from user_settings.

    Keys are stored as 'pref.statusFilter' etc; returned without the prefix.
    """
    with get_user_db_connection(user_id) as conn:
        rows = conn.execute(
            "SELECT key, value FROM user_settings WHERE key LIKE 'pref.%'"
        ).fetchall()
        return {row["key"][len(PREF_PREFIX):]: row["value"] for row in rows}


def set_preference(user_id: str | None = None, key: str = "", value: str = "") -> None:
    """Set a single preference in user_settings."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
            (f"{PREF_PREFIX}{key}", value),
        )
        conn.commit()


def set_preferences_bulk(user_id: str | None = None, prefs: dict[str, str] | None = None) -> None:
    """Set multiple preferences in a single transaction."""
    if not prefs:
        return
    with get_user_db_connection(user_id) as conn:
        for key, value in prefs.items():
            conn.execute(
                "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)",
                (f"{PREF_PREFIX}{key}", value),
            )
        conn.commit()


def clear_all_preferences(user_id: str | None = None) -> None:
    """Delete all preference rows from user_settings."""
    with get_user_db_connection(user_id) as conn:
        conn.execute("DELETE FROM user_settings WHERE key LIKE 'pref.%'")
        conn.commit()


def backfill_preferences_from_profile(user_id: str) -> bool:
    """One-time migration: copy settings from active profile DB to user.sqlite.

    Idempotent — skips if user.sqlite already has any pref.* keys.
    Returns True if backfill occurred, False if skipped.
    """
    existing = get_all_preferences(user_id)
    if existing:
        return False

    # Try to read from the active profile's profile.sqlite
    import json

    from ..database import get_db_connection
    try:
        with get_db_connection() as conn:
            row = conn.execute(
                "SELECT settings_json FROM user_settings WHERE id = 1"
            ).fetchone()
            if row and row["settings_json"]:
                blob = json.loads(row["settings_json"])
                # Flatten nested JSON: {projectFilters: {statusFilter: "x"}} -> {statusFilter: "x"}
                flat = {}
                for section_value in blob.values():
                    if isinstance(section_value, dict):
                        flat.update({k: str(v) for k, v in section_value.items()})
                if flat:
                    set_preferences_bulk(user_id, flat)
                    logger.info(f"[UserDB] Backfilled {len(flat)} preferences for user {user_id} from profile DB")
                    return True
    except Exception as e:
        logger.warning(f"[UserDB] Could not backfill preferences for user {user_id}: {e}")

    return False


def create_profile(user_id: str, profile_id: str, name: str, color: str, is_default: bool = False, sport: str = "no_sport") -> None:
    """Insert a new profile row."""
    with get_user_db_connection(user_id) as conn:
        conn.execute(
            "INSERT INTO profiles (id, name, color, is_default, sport) VALUES (?, ?, ?, ?, ?)",
            (profile_id, name, color, 1 if is_default else 0, sport),
        )
        conn.commit()
    logger.info(f"[UserDB] Created profile {profile_id} ({name}) for user {user_id}")


def update_profile(user_id: str, profile_id: str, name: str | None = None, color: str | None = None, sport: str | None = None) -> None:
    """Update profile fields."""
    with get_user_db_connection(user_id) as conn:
        if name is not None:
            conn.execute("UPDATE profiles SET name = ? WHERE id = ?", (name, profile_id))
        if color is not None:
            conn.execute("UPDATE profiles SET color = ? WHERE id = ?", (color, profile_id))
        if sport is not None:
            conn.execute("UPDATE profiles SET sport = ? WHERE id = ?", (sport, profile_id))
        conn.commit()


def delete_profile(user_id: str, profile_id: str) -> None:
    """Delete a profile row. Also clears is_default if it was the default."""
    with get_user_db_connection(user_id) as conn:
        conn.execute("DELETE FROM profiles WHERE id = ?", (profile_id,))
        conn.commit()
    logger.info(f"[UserDB] Deleted profile {profile_id} for user {user_id}")


def set_default_profile(user_id: str, profile_id: str) -> None:
    """Set a profile as the default (clears is_default on all others)."""
    with get_user_db_connection(user_id) as conn:
        conn.execute("UPDATE profiles SET is_default = 0")
        conn.execute("UPDATE profiles SET is_default = 1 WHERE id = ?", (profile_id,))
        conn.commit()


# ---------------------------------------------------------------------------
# User activity (T3080: dual-write from Postgres to user.sqlite)
# ---------------------------------------------------------------------------

def backfill_user_activity(user_id: str) -> bool:
    """Backfill user_activity + user_activity_events from Postgres.

    Idempotent — skips if user_activity row already exists.
    Returns True if backfill occurred, False if skipped.
    """
    with get_user_db_connection(user_id) as conn:
        existing = conn.execute(
            "SELECT 1 FROM user_activity WHERE user_id = ?", (user_id,)
        ).fetchone()
        if existing:
            return False

        try:
            from app.services.pg import get_pg
            with get_pg() as pg:
                cur = pg.cursor()
                cur.execute(
                    "SELECT last_active_at FROM user_segments WHERE user_id = %s",
                    (user_id,),
                )
                segment_row = cur.fetchone()

                cur.execute(
                    "SELECT action, SUM(count) AS count, MIN(first_at) AS first_at FROM user_actions WHERE user_id = %s GROUP BY action",
                    (user_id,),
                )
                action_rows = cur.fetchall()
        except Exception:
            logger.warning("[UserDB] Postgres unavailable for activity backfill user=%s", user_id)
            return False

        if not segment_row and not action_rows:
            return False

        action_map = {r["action"]: r for r in action_rows}
        session_count = action_map.get("session_started", {}).get("count", 0)
        pwa_session_count = action_map.get("pwa_session_started", {}).get("count", 0)
        last_active = str(segment_row["last_active_at"]) if segment_row and segment_row["last_active_at"] else None

        export_actions = {"export_completed", "framing_exported", "overlay_exported"}
        last_export = None
        for ea in export_actions:
            if ea in action_map and action_map[ea].get("first_at"):
                last_export = str(action_map[ea]["first_at"])
                break

        conn.execute(
            """INSERT INTO user_activity (user_id, session_count, pwa_session_count, last_active_at, last_export_at)
               VALUES (?, ?, ?, ?, ?)""",
            (user_id, session_count, pwa_session_count, last_active, last_export),
        )

        for row in action_rows:
            conn.execute(
                """INSERT OR IGNORE INTO user_activity_events (event, count, first_at)
                   VALUES (?, ?, ?)""",
                (row["action"], row["count"], str(row["first_at"]) if row["first_at"] else None),
            )

        conn.commit()
        logger.info("[UserDB] Backfilled user activity for user=%s (%d actions)", user_id, len(action_rows))
        return True


def get_user_activity(user_id: str) -> dict:
    """Read user activity summary from user.sqlite."""
    with get_user_db_connection(user_id) as conn:
        row = conn.execute(
            """SELECT session_count, pwa_session_count, last_active_at, last_export_at
               FROM user_activity WHERE user_id = ?""",
            (user_id,),
        ).fetchone()
        if not row:
            return {}
        return dict(row)


