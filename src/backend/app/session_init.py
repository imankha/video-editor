"""
User session initialization — single entry point for all per-user setup.

When real auth is added, call user_session_init() from the login handler.
All per-user "run once" tasks belong here.

Called by:
  - /api/auth/init endpoint (explicit frontend call)
  - UserContextMiddleware (auto-resolve when X-Profile-ID header is missing)
  - startup_event (initialize default user)

Idempotent per user — user.sqlite is source of truth. Results are cached
in _init_cache. Subsequent calls just set the profile context and return.
"""

import asyncio
import contextvars
import logging
import threading
from uuid import uuid4

from .profile_context import set_current_profile_id

logger = logging.getLogger(__name__)

# T6240: the app's main event loop, captured at startup (main.py lifespan).
# user_session_init is now offloaded to a worker thread by the request middleware
# (run_in_context) so it no longer blocks the loop. But a worker thread has no
# running loop of its own, so _schedule_startup_recovery cannot detect the loop
# with get_running_loop() there — without this reference it would fall back to
# asyncio.run() and BLOCK the worker thread draining the modal queue (and cancel
# recovery sub-tasks when the ephemeral loop closes). With it, the worker-thread
# path fires the recovery coroutine onto the real main loop, fire-and-forget.
_main_loop: asyncio.AbstractEventLoop | None = None


def set_main_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Record (or clear, on shutdown) the app's main event loop. Called from
    main.py lifespan(). See _schedule_startup_recovery."""
    global _main_loop
    _main_loop = loop

# Per-user init cache: user_id -> {"profile_id": str, "is_new_user": bool}
# Populated on first call, returned on subsequent calls.
# This makes user_session_init() cheap to call from middleware on every request.
_init_cache: dict[str, dict] = {}

# T7520: per-process cache of a user's REGISTERED profile ids (the `profiles`
# table in user.sqlite), so the middleware's per-request X-Profile-ID ownership
# guard is a dict lookup on the hot path instead of a sqlite read on the event
# loop. Populated lazily by load_registered_profile_ids; invalidated alongside
# _init_cache on every profile create/switch/delete via invalidate_user_cache.
# Staleness characteristics mirror _init_cache: a machine serves its cached copy
# for the process lifetime, so a profile created on ANOTHER machine is not seen
# until this entry is invalidated — acceptable because a session is machine-
# pinned (fly_machine_id cookie) and profile-mutating gestures for that session
# run on this machine and invalidate here.
_profile_registry_cache: dict[str, frozenset[str]] = {}

_init_locks: dict[str, threading.Lock] = {}
_init_locks_guard = threading.Lock()


def _get_init_lock(user_id: str) -> threading.Lock:
    with _init_locks_guard:
        if user_id not in _init_locks:
            _init_locks[user_id] = threading.Lock()
        return _init_locks[user_id]


def invalidate_user_cache(user_id: str) -> None:
    """Remove user from _init_cache so next request re-reads user.sqlite.

    Called after profile switch or delete to ensure the middleware
    picks up the new selected profile on the next request. T7520: also drops
    the registered-profile-ids cache so a just-created/deleted profile is
    reflected by the ownership guard on the next request. T5083 fix: also
    drops the JIT seam's verified-at-head flags for this user so an account
    purge-then-reregister (or a delete leaving stale in-process state) can't
    let the new registration silently skip the seam.
    """
    _init_cache.pop(user_id, None)
    _profile_registry_cache.pop(user_id, None)
    from .migrations import _clear_seam_verified
    _clear_seam_verified(user_id)


def peek_registered_profile_ids(user_id: str) -> frozenset[str] | None:
    """The user's registered profile ids if already cached this process, else
    None. Pure dict lookup — safe to call directly on the event loop (no I/O).
    A None return means the caller must load_registered_profile_ids() off-loop."""
    return _profile_registry_cache.get(user_id)


def load_registered_profile_ids(user_id: str) -> frozenset[str]:
    """Load and cache the user's registered profile ids from user.sqlite.

    BLOCKING (opens user.sqlite; a cold first access downloads it from R2), so
    call it via run_in_context off the event loop, never inline in the async
    request path. The guard treats membership here as "the session user owns
    this profile"; see db_sync.py's X-Profile-ID ownership check (T7520).
    """
    from .services.user_db import get_profiles
    ids = frozenset(p["id"] for p in get_profiles(user_id))
    _profile_registry_cache[user_id] = ids
    return ids


def _materialize_pending_shares_for_user(user_id: str, profile_id: str) -> None:
    """T3230 background body: auto-materialize pending teammate shares for
    single-profile users. Extracted so user_session_init can run it off its
    own (often event-loop) calling thread -- see the call site's T4315
    round-2 (MAJOR-2) comment. Best-effort: every failure is logged, never
    raised, matching the original inline block's behavior.
    """
    try:
        from .services.auth_db import get_user_by_id
        from .services.materialization import materialize_game_share
        from .services.sharing_db import (
            get_pending_shares_for_email,
            mark_game_share_materialized,
            resolve_pending_share,
        )
        from .services.user_db import get_profiles
        from .utils.encoding import decode_data

        user = get_user_by_id(user_id)
        if user and user["email"]:
            pending = get_pending_shares_for_email(user["email"])
            if pending:
                profiles = get_profiles(user_id)
                if len(profiles) == 1:
                    for p in pending:
                        try:
                            clip_data = decode_data(p["clip_data"])
                            sharer = get_user_by_id(p["sharer_user_id"])
                            sharer_email = sharer["email"] if sharer else None
                            materialize_game_share(
                                sharer_user_id=p["sharer_user_id"],
                                sharer_profile_id=p["sharer_profile_id"],
                                recipient_user_id=user_id,
                                recipient_profile_id=profile_id,
                                game_id=p["game_id"],
                                tag_name=p["tag_name"],
                                share_id=p["share_id"],
                                clip_data=clip_data,
                                sharer_email=sharer_email,
                            )
                            resolve_pending_share(p["id"], profile_id)
                            mark_game_share_materialized(p["share_id"], profile_id)
                            logger.info(f"T3230: Auto-materialized pending share {p['id']} for user {user_id}")
                        except Exception as e:
                            logger.error(f"T3230: Failed to auto-materialize pending share {p['id']}: {e}")
    except Exception as e:
        logger.error(f"T3230: Failed to check pending shares: {e}")


def user_session_init(user_id: str, hint_profile_id: str | None = None) -> dict:
    """
    Initialize a user session. Idempotent — safe to call on every request.

    First call per user:
    1. Load or create profile from user.sqlite
    2. Ensure database exists (dirs, tables, R2 download)
    3. Run cleanup tasks (stale projects, DB bloat)
    4. Cache the result

    Subsequent calls: set profile context from cache and return immediately.

    Returns:
        {
            "profile_id": str,   # The active profile GUID
            "is_new_user": bool, # True if profile was just created
        }
    """
    # Fast path: already initialized for this user
    cached = _init_cache.get(user_id)
    if cached:
        set_current_profile_id(cached["profile_id"])
        return cached

    # --- Slow path: first init for this user ---
    # Per-user lock prevents redundant R2 downloads when multiple
    # concurrent requests arrive for the same user.
    with _get_init_lock(user_id):
        # Double-check after acquiring lock
        cached = _init_cache.get(user_id)
        if cached:
            set_current_profile_id(cached["profile_id"])
            return cached

        return _init_slow_path(user_id, hint_profile_id)


def _ensure_database_with_context(user_id: str, profile_id: str) -> None:
    """Run ensure_database in a thread with the correct context vars set."""
    from .user_context import set_current_user_id
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)
    from .database import ensure_database
    ensure_database()


def _init_slow_path(user_id: str, hint_profile_id: str | None = None) -> dict:
    from .database import ensure_database
    from .services.user_db import (
        create_profile,
        ensure_user_database,
        get_selected_profile_id,
        set_selected_profile_id,
    )

    profile_id = None
    is_new_user = False

    if hint_profile_id:
        # T7520: hint_profile_id is CLIENT-supplied (dev-login profile_id, or an
        # X-Profile-ID that fell through to init on a cold cache). It must be
        # validated against this user's registry BEFORE we create/download its
        # profile.sqlite — otherwise an unregistered (foreign) hint materializes
        # a cross-tenant profile DB under this user's directory (the same
        # impersonation-window artifact the middleware header guard closes).
        # This means user.sqlite has to be resolved FIRST, so the T3350 parallel
        # profile download is now gated on the hint surviving the registry
        # check. Correctness over the parallelization here: this cold-cache init
        # path is rare (the common request carries a valid X-Profile-ID and
        # skips session_init entirely).
        set_current_profile_id(hint_profile_id)
        ensure_user_database(user_id)
        hint_is_registered = hint_profile_id in load_registered_profile_ids(user_id)
        if hint_is_registered:
            _ensure_database_with_context(user_id, hint_profile_id)
        else:
            logger.warning(
                f"T7520: ignoring unregistered hint_profile_id={hint_profile_id} "
                f"for user={user_id}; not creating its profile DB"
            )

        # Prefer the hint only when it is BOTH registered AND the selected
        # profile (preserves the pre-T7520 outcome); otherwise fall back to the
        # real selected profile. An unregistered hint never selects.
        actual_profile_id = get_selected_profile_id(user_id)
        if hint_is_registered and actual_profile_id == hint_profile_id:
            profile_id = hint_profile_id
            logger.info(f"Init OK, profile {profile_id} for user {user_id}")
        else:
            # Hint was stale/unregistered -- fall back to the real selected profile
            profile_id = actual_profile_id
            if profile_id:
                logger.info(f"Hint not selected, using actual profile {profile_id} for user {user_id}")
                set_current_profile_id(profile_id)
                ensure_database()
    else:
        # Sequential path: no hint available
        ensure_user_database(user_id)
        profile_id = get_selected_profile_id(user_id)
        if profile_id:
            logger.info(f"Loaded profile {profile_id} for user {user_id} from user.sqlite")

    if not profile_id:
        profile_id = uuid4().hex[:8]
        is_new_user = True
        inherited_sport = None
        try:
            from .services.sharing_db import get_inherited_sport
            inherited_sport = get_inherited_sport(user_id)
        except Exception as e:
            logger.warning(f"Sport inheritance lookup failed for {user_id}: {e}")
        # T7850: new users default to "no_sport" (never chosen) rather than
        # silently classifying them as soccer. An inherited sport (referral/share)
        # still wins when present.
        sport = inherited_sport or "no_sport"
        create_profile(user_id, profile_id, name="", color="#6366f1", is_default=True, sport=sport)
        set_selected_profile_id(user_id, profile_id)
        # T7520: this create mutates the profiles registry. If the hint branch
        # above already cached load_registered_profile_ids (a snapshot taken
        # BEFORE this row existed), the middleware ownership guard would 404 the
        # user's own just-created profile on the next request until an unrelated
        # invalidate. Drop the stale registry-cache entry so the next guard load
        # re-reads user.sqlite and sees this profile.
        _profile_registry_cache.pop(user_id, None)
        logger.info(f"Created new profile {profile_id} for user {user_id}"
                    + (f" (inherited sport={sport})" if inherited_sport else ""))

        from .services.credit_ledger import CreditsUnavailable, grant_credits
        from .services.storage_credits import NEW_ACCOUNT_CREDITS
        # is_new_user is derived from "no profile yet" (above) and set_selected_profile_id
        # already committed by this point, so a retry after a failure here would NOT
        # re-enter this block -- the signup bonus would be silently orphaned forever.
        # Catch (rather than let the gate's 503 propagate) so a brand-new user's whole
        # login doesn't hard-fail during the short cutover window; log loudly so the
        # gap is operator-visible instead of silent (CLAUDE.md: fail visibly, not silently).
        try:
            grant_credits(user_id, NEW_ACCOUNT_CREDITS, source="new_account_bonus")
            logger.info(f"Seeded {NEW_ACCOUNT_CREDITS} credits for new user {user_id}")
        except CreditsUnavailable:
            logger.error(
                f"[SessionInit] Signup bonus NOT granted for new user {user_id} -- "
                f"credits_ready gate is closed. This user needs a manual admin grant "
                f"once the gate opens (idempotency key signup:{user_id} is safe to retry)."
            )

    set_current_profile_id(profile_id)

    # T8120: grant the quest-chain credit total upfront, retiring the per-quest
    # drip. This runs for EVERY user on the first init of a process/session (the
    # slow path is cached per user), not just new signups — an existing mid-quest
    # account gets its ungranted remainder here on next login (same JIT-on-next-
    # touch shape as migrations; no bulk sweep). Idempotent (fixed key + remainder
    # computed from prior grants), so repeat inits are a cheap no-op. Same
    # gate-tolerant handling as the new-account bonus above: a closed credits_ready
    # gate must not hard-fail login; log loudly (idempotency key questbank:{user_id}
    # is safe to retry once the gate opens).
    try:
        from .services.credit_ledger import (
            CreditsUnavailable as _CU,
        )
        from .services.credit_ledger import (
            grant_quest_chain_credits,
        )
        r = grant_quest_chain_credits(user_id)
        if r["granted"]:
            logger.info(f"Granted {r['granted']} upfront quest-chain credits to {user_id}")
    except _CU:
        logger.error(
            f"[SessionInit] Upfront quest-chain credits NOT granted for {user_id} -- "
            f"credits_ready gate is closed. Safe to retry (key questbank:{user_id}) "
            f"once the gate opens."
        )

    if not hint_profile_id or is_new_user:
        ensure_database()

    # T3230: Auto-materialize pending teammate shares for single-profile users.
    # T4315 round 2 (MAJOR-2): materialize_game_share can do a real R2 HEAD +
    # a full profile.sqlite download (require_fresh). user_session_init is
    # called SYNCHRONOUSLY, directly on the event-loop thread, from the
    # request middleware whenever a request arrives without an X-Profile-ID
    # header (db_sync.py) -- the exact T1020/T2720-sensitive path. Run this
    # block in a background daemon thread so it can never block that caller;
    # it is already best-effort (per-item try/except, logged not raised).
    # Tests that need determinism can `.join()` the returned thread handle.
    pending_share_thread = threading.Thread(
        target=_materialize_pending_shares_for_user,
        args=(user_id, profile_id),
        daemon=True,
    )
    pending_share_thread.start()

    # 5. T890: Recover orphaned credit reservations
    try:
        from .services.credit_ledger import recover_orphaned_reservations
        recovered = recover_orphaned_reservations(user_id)
        if recovered > 0:
            logger.info(f"Recovered {recovered} orphaned credit reservations for user {user_id}")
    except Exception as e:
        logger.error(f"Failed to recover orphaned reservations: {e}")

    # 6. T970: Backfill completed_quests from credit_transactions
    try:
        from .services.user_db import backfill_completed_quests
        backfill_completed_quests(user_id)
    except Exception as e:
        logger.error(f"T970: Failed to backfill completed quests: {e}")

    # 7. T985: Backfill preferences from profile DB to user.sqlite
    try:
        from .services.user_db import backfill_preferences_from_profile
        backfill_preferences_from_profile(user_id)
    except Exception as e:
        logger.error(f"T985: Failed to backfill preferences: {e}")

    # 8. T3080: Backfill user activity from Postgres to user.sqlite
    try:
        from .services.user_db import backfill_user_activity
        backfill_user_activity(user_id)
    except Exception as e:
        logger.error(f"T3080: Failed to backfill user activity: {e}")

    # 9. Cleanup tasks (moved from ensure_database lines 922-938)
    try:
        from .services.project_archive import archive_completed_projects
        archived_count = archive_completed_projects(user_id)
        if archived_count > 0:
            logger.info(f"T1640: Archived {archived_count} completed projects for user {user_id}")
    except Exception as e:
        logger.error(f"T1640: Failed to archive completed projects: {e}")

    try:
        from .services.project_archive import cleanup_database_bloat
        cleanup_database_bloat()
    except Exception as e:
        logger.error(f"T243: Failed to cleanup database bloat: {e}")

    # 10. Cache the result BEFORE scheduling recovery so concurrent first
    # requests (e.g. two tabs) don't both schedule the same work.
    result = {
        "profile_id": profile_id,
        "is_new_user": is_new_user,
    }
    _init_cache[user_id] = result

    # 11. T1380 + T1390: per-user orphaned-job recovery and modal queue drain.
    # Runs once per user per server process (gated by _init_cache above).
    # Both routines need user+profile context, which is set above. When an
    # event loop is running we schedule as a background task so the user's
    # first request isn't blocked; in sync test contexts we run inline.
    _schedule_startup_recovery(user_id)

    return result


async def _run_startup_recovery(user_id: str) -> None:
    """Run orphaned-job recovery and modal queue drain for the current user.

    Expects user_id + profile_id ContextVars to already be set by the caller
    (asyncio.create_task copies the current context, so this is automatic
    when scheduled from user_session_init).
    """
    from .services.export_worker import recover_orphaned_jobs
    from .services.modal_queue import process_modal_queue

    try:
        await recover_orphaned_jobs()
    except Exception as e:
        logger.warning(
            f"[SessionInit] recover_orphaned_jobs failed for {user_id}: {e}"
        )

    try:
        result = await process_modal_queue()
        if result.get("processed", 0) > 0:
            logger.info(
                f"[SessionInit] modal queue for {user_id}: "
                f"{result['succeeded']} ok, {result['failed']} failed"
            )
    except Exception as e:
        logger.warning(
            f"[SessionInit] process_modal_queue failed for {user_id}: {e}"
        )


def _schedule_startup_recovery(user_id: str) -> None:
    """Fire orphaned-job recovery + modal-queue drain WITHOUT blocking the caller.

    Three contexts reach this:
    - On the event loop directly (dev-login / auth-init handlers): schedule a
      background task on the running loop.
    - On a worker thread (T6240: user_session_init offloaded via run_in_context):
      there is no running loop here, so schedule onto the captured main loop
      (_main_loop) with call_soon_threadsafe. copy_context() carries THIS thread's
      user/profile ContextVars into the task (call_soon_threadsafe's callback runs
      on the main-loop thread, whose ContextVars are not ours), which
      _run_startup_recovery requires. Fire-and-forget: we do not wait on it.
    - No loop anywhere (pure synchronous test context): run inline via asyncio.run.
    """
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop is not None:
        loop.create_task(_run_startup_recovery(user_id))
        return

    main_loop = _main_loop
    if main_loop is not None and main_loop.is_running():
        ctx = contextvars.copy_context()
        main_loop.call_soon_threadsafe(
            lambda: main_loop.create_task(_run_startup_recovery(user_id), context=ctx)
        )
        return

    asyncio.run(_run_startup_recovery(user_id))
