"""
Bugs 33p / 34p / 35p — broken delete -> reregister new-user flow.

Prod (build 16a04581, drewsoccerati@gmail.com, one session):
  33p (/home):     new account (deleted + reregistered) not seeded with credits -> can't add a game.
  34p (/annotate): "Error QuestNotComplete when attempting to collect first reward."
  35p (/annotate): "Quest not complete: step 'watch_annotate_tutorial' is incomplete."

Root cause (verified against code): account deletion left the R2 copy of user.sqlite /
profile.sqlite (and the in-process init/version caches) intact, so a same-email login
RESTORED the old user.sqlite. get_selected_profile_id then returned the old profile ->
`is_new_user` stayed False -> the NEW_ACCOUNT_CREDITS seed block in session_init was
skipped (33p). The restored user-scoped quest state (completed_quests / quest_reward
transactions, re-materialised by backfill_completed_quests) then disagreed with the fresh
profile's step data, so GET /progress reported quest_1 complete while POST /claim-reward
re-derived the steps and 400'd (34p/35p).

Fix: deletion is now complete + cache-safe (auth.delete_user, privacy.delete_account share
`_purge_user_data`), so a reregister is a genuinely fresh new user; and claim-reward honors
the same user-scoped completed/claimed set that /progress uses before re-checking steps, so
the two endpoints never disagree.

Hermetic: R2 is disabled and per-user SQLite lives under a tmp dir. No real R2/Postgres writes.
"""

import asyncio
import uuid

import pytest
from fastapi import HTTPException

from app.services.storage_credits import NEW_ACCOUNT_CREDITS


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


@pytest.fixture(autouse=True)
def _fresh_event_loop():
    """asyncio.run() here (and user_session_init's internal recovery scheduler) closes the
    loop it created and leaves no current loop. Reinstall a usable loop after each test so
    other modules relying on asyncio.get_event_loop() (e.g. test_tutorial_quest_steps) still
    find an open loop when the suite runs them after this file."""
    yield
    asyncio.set_event_loop(asyncio.new_event_loop())


@pytest.fixture
def hermetic(tmp_path, monkeypatch):
    """Per-user SQLite under tmp; R2 disabled; caches redirected to fresh containers.

    Does NOT touch app.session_init._init_cache as a whole: it is a process-wide,
    session-lifetime dict that conftest's session-scoped _set_default_profile_context
    fixture seeds once (for "a"/"testdefault") for the ENTIRE test run. A blanket
    .clear() here (previously present) wiped those shared entries the first time any
    test in this file ran, silently pushing every later test file's "testdefault"/"a"
    requests onto the slow re-init path for the rest of the process -- surfacing as
    unrelated SQLite lock timeouts and 404s in far-away test files. Every test in this
    file uses uuid4-suffixed ids (_uid()), so entries from a prior test here can never
    collide with a later one; explicit per-uid cache pops (where a test needs to force
    the slow path) are enough, matching production's invalidate_user_cache(user_id).
    """
    base = tmp_path / "user_data"
    base.mkdir()
    monkeypatch.setattr("app.database.USER_DATA_BASE", base)
    monkeypatch.setattr("app.services.user_db.USER_DATA_BASE", base)
    monkeypatch.setattr("app.routers.auth.USER_DATA_BASE", base)
    monkeypatch.setattr("app.routers.privacy.USER_DATA_BASE", base)
    monkeypatch.setattr("app.database.R2_ENABLED", False)
    monkeypatch.setattr("app.storage.R2_ENABLED", False)
    monkeypatch.setattr("app.routers.auth.R2_ENABLED", False)
    monkeypatch.setattr("app.services.user_db._initialized_user_dbs", set())
    monkeypatch.setattr("app.database._initialized_users", set())
    monkeypatch.setattr("app.database._user_sqlite_versions", {})
    monkeypatch.setattr("app.database._user_db_versions", {})
    yield base


def _make_account(uid: str, pid: str):
    """Create an existing account: user.sqlite with a selected profile + a fresh profile.sqlite."""
    from app.user_context import set_current_user_id
    from app.profile_context import set_current_profile_id
    from app.services.user_db import (
        ensure_user_database,
        create_profile,
        set_selected_profile_id,
    )
    from app.database import ensure_database

    set_current_user_id(uid)
    set_current_profile_id(pid)
    ensure_user_database(uid)
    create_profile(uid, pid, "", "#6366f1", is_default=True)
    set_selected_profile_id(uid, pid)
    ensure_database()  # fresh profile.sqlite: NO achievements rows


# ---------------------------------------------------------------------------
# Bugs 34p / 35p — GET /progress and POST /claim-reward must agree
# ---------------------------------------------------------------------------

def test_progress_and_claim_agree_for_user_scoped_completed_quest(hermetic):
    """quest_1 is 'done' in the user-scoped record (completed_quests + quest_reward tx) but the
    active profile has no achievements. /progress reports it complete; /claim-reward must not 400.

    Pre-fix RED: claim-reward re-derives steps and raises 400
    'Quest not complete: step 'watch_annotate_tutorial' is incomplete'.
    """
    from app.services.user_db import grant_credits, mark_quest_completed
    from app.routers.quests import get_progress, claim_reward

    uid = _uid("zombie")
    pid = "aaaa1111"
    _make_account(uid, pid)

    # Model the restored/backfilled user-scoped state: a real prior quest_reward grant.
    grant_credits(uid, 15, "quest_reward", "quest_1")  # -> claimed set has quest_1
    mark_quest_completed(uid, "quest_1")               # -> completed set has quest_1

    prog = asyncio.run(get_progress())
    q1 = next(q for q in prog["quests"] if q["id"] == "quest_1")
    assert q1["completed"] is True, "/progress should report quest_1 complete (user-scoped record)"
    assert q1["reward_claimed"] is True

    # Must NOT raise — the two endpoints agree.
    res = asyncio.run(claim_reward("quest_1"))
    assert res["already_claimed"] is True
    assert res["credits_granted"] == 0


def test_claim_still_blocked_for_unearned_quest(hermetic):
    """Guard against loosening: a quest that is neither claimed nor step-complete still 400s."""
    from app.routers.quests import claim_reward

    uid = _uid("fresh")
    pid = "bbbb2222"
    _make_account(uid, pid)  # no achievements, no completed_quests, no quest_reward tx

    with pytest.raises(HTTPException) as ei:
        asyncio.run(claim_reward("quest_1"))
    assert ei.value.status_code == 400
    assert "watch_annotate_tutorial" in ei.value.detail


# ---------------------------------------------------------------------------
# Bug 33p — delete + reregister must yield a fresh, seeded new user
# ---------------------------------------------------------------------------

def test_reregister_after_purge_is_new_user_and_seeded(hermetic):
    """A returning account is not seeded; after a complete purge, reregister is is_new_user
    with NEW_ACCOUNT_CREDITS and a clean quest slate."""
    from app.session_init import user_session_init, _init_cache
    from app.services.user_db import (
        get_credit_balance,
        set_credits,
        get_completed_quest_ids,
    )
    from app.routers.auth import _purge_user_data

    uid = _uid("delreg")
    old_pid = "cccc3333"
    _make_account(uid, old_pid)
    set_credits(uid, 0)  # spent-down account: 0 credits

    # Pre-purge: session init sees a RETURNING user -> not new -> not seeded (bug-33 precondition).
    _init_cache.pop(uid, None)
    before = user_session_init(uid)
    assert before["is_new_user"] is False
    assert get_credit_balance(uid)["balance"] == 0

    # Complete deletion.
    _purge_user_data(uid)

    # Reregister: genuinely fresh new user, seeded, clean quest slate.
    after = user_session_init(uid)
    assert after["is_new_user"] is True
    assert get_credit_balance(uid)["balance"] == NEW_ACCOUNT_CREDITS
    assert get_completed_quest_ids(uid) == set()


def test_returning_user_not_reseeded(hermetic):
    """Regression: a normal returning user (no delete) keeps their balance — never re-seeded."""
    from app.session_init import user_session_init, _init_cache
    from app.services.user_db import get_credit_balance, set_credits

    uid = _uid("returning")
    pid = "dddd4444"
    _make_account(uid, pid)
    set_credits(uid, NEW_ACCOUNT_CREDITS)  # already seeded once

    _init_cache.pop(uid, None)
    result = user_session_init(uid)
    assert result["is_new_user"] is False
    assert get_credit_balance(uid)["balance"] == NEW_ACCOUNT_CREDITS  # unchanged (not doubled)


def test_returning_user_keeps_quest_progress(hermetic):
    """Regression: a normal returning user (no delete) keeps their completed/claimed quest
    state across a session re-init — the fix must not reset anyone's progress."""
    from app.session_init import user_session_init, _init_cache
    from app.services.user_db import (
        grant_credits,
        mark_quest_completed,
        get_completed_and_claimed_quest_ids,
    )
    from app.routers.quests import get_progress

    uid = _uid("progressed")
    pid = "cdef1234"
    _make_account(uid, pid)
    grant_credits(uid, 15, "quest_reward", "quest_1")
    mark_quest_completed(uid, "quest_1")

    _init_cache.pop(uid, None)
    result = user_session_init(uid)
    assert result["is_new_user"] is False

    completed, claimed = get_completed_and_claimed_quest_ids(uid)
    assert completed == {"quest_1"}
    assert claimed == {"quest_1"}

    prog = asyncio.run(get_progress())
    q1 = next(q for q in prog["quests"] if q["id"] == "quest_1")
    assert q1["completed"] is True
    assert q1["reward_claimed"] is True


def test_reregister_with_different_email_is_an_independent_fresh_account(hermetic):
    """Edge case: reregistering with a DIFFERENT email after a delete is unaffected by the
    deleted account's state — _find_or_create_user mints a brand-new user_id for a new
    email, so it never touches the deleted user's (purged) caches/storage at all."""
    from app.session_init import user_session_init, _init_cache
    from app.services.user_db import get_credit_balance

    old_uid = _uid("olddeleted")
    old_pid = "11112222"
    _make_account(old_uid, old_pid)

    from app.routers.auth import _purge_user_data
    _purge_user_data(old_uid)

    # A different email means a DIFFERENT user_id (generate_user_id(), never reused).
    new_uid = _uid("newemail")
    _init_cache.pop(new_uid, None)
    result = user_session_init(new_uid)

    assert result["is_new_user"] is True
    assert get_credit_balance(new_uid)["balance"] == NEW_ACCOUNT_CREDITS
    # The old identity's purge left no trace that could leak into the new one.
    assert new_uid != old_uid
    assert old_uid not in _init_cache


# ---------------------------------------------------------------------------
# Deletion completeness — both endpoints purge R2 + local + in-process caches
# ---------------------------------------------------------------------------

def _seed_caches(uid: str, pid: str, base):
    """Create a local user folder and populate every in-process cache for the user."""
    from app.session_init import _init_cache
    from app.services import user_db as user_db_mod
    from app import database as db_mod

    (base / uid).mkdir(parents=True, exist_ok=True)
    (base / uid / "user.sqlite").write_bytes(b"stub")
    _init_cache[uid] = {"profile_id": pid, "is_new_user": False}
    user_db_mod._initialized_user_dbs.add(uid)
    db_mod._initialized_users.add(uid)
    db_mod._user_sqlite_versions[uid] = 3
    db_mod._user_db_versions[(uid, pid)] = 3


def _assert_caches_cleared(uid: str, pid: str, base):
    from app.session_init import _init_cache
    from app.services import user_db as user_db_mod
    from app import database as db_mod

    assert not (base / uid).exists(), "local user folder should be deleted"
    assert uid not in _init_cache
    assert uid not in user_db_mod._initialized_user_dbs
    assert uid not in db_mod._initialized_users
    assert db_mod._user_sqlite_versions.get(uid) is None
    assert (uid, pid) not in db_mod._user_db_versions


def test_delete_user_endpoint_purges_caches_and_r2(hermetic, monkeypatch):
    """DELETE /api/auth/user purges R2 + local + caches (pre-fix: only rmtree'd local)."""
    from app.routers import auth
    from app.user_context import set_current_user_id

    uid = _uid("epauth")
    pid = "eeee5555"
    _seed_caches(uid, pid, hermetic)

    r2_calls = {"n": 0}
    monkeypatch.setattr("app.storage.R2_ENABLED", True, raising=False)
    monkeypatch.setattr("app.routers.auth.R2_ENABLED", True, raising=False)
    monkeypatch.setattr(
        "app.storage.delete_user_r2_data",
        lambda u: r2_calls.__setitem__("n", r2_calls["n"] + 1) or 0,
        raising=False,
    )

    set_current_user_id(uid)
    asyncio.run(auth.delete_user())

    assert r2_calls["n"] == 1, "delete_user must purge R2 objects"
    _assert_caches_cleared(uid, pid, hermetic)


def test_privacy_delete_account_purges_caches_and_r2(hermetic, monkeypatch):
    """DELETE /api/privacy/delete-account (the real UI path) purges R2 + local + caches."""
    from unittest.mock import MagicMock

    from app.routers import privacy
    from app.user_context import set_current_user_id

    uid = _uid("epprivacy")
    pid = "ffff6666"
    _seed_caches(uid, pid, hermetic)

    r2_calls = {"n": 0}
    # privacy.delete_account delegates to auth._purge_user_data, which reads R2_ENABLED
    # from the auth namespace.
    monkeypatch.setattr("app.storage.R2_ENABLED", True, raising=False)
    monkeypatch.setattr("app.routers.auth.R2_ENABLED", True, raising=False)
    monkeypatch.setattr(
        "app.storage.delete_user_r2_data",
        lambda u: r2_calls.__setitem__("n", r2_calls["n"] + 1) or 0,
        raising=False,
    )

    set_current_user_id(uid)
    asyncio.run(privacy.delete_account(MagicMock()))

    assert r2_calls["n"] == 1, "delete_account must purge R2 objects"
    _assert_caches_cleared(uid, pid, hermetic)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_delete_user_idempotent_when_nothing_exists(hermetic):
    """Deleting a user with no local folder (and R2 disabled) still runs the full purge
    without crashing (pre-fix it early-returned deleted=False and skipped R2/caches)."""
    from app.routers import auth
    from app.user_context import set_current_user_id

    uid = _uid("empty")
    set_current_user_id(uid)
    result = asyncio.run(auth.delete_user())
    assert result["deleted"] is True
    assert result["local_deleted"] is False


def test_delete_with_no_r2_copy_reports_zero_and_does_not_error(hermetic, monkeypatch):
    """Edge case: R2 IS enabled but the user never had anything uploaded there (e.g. they
    deleted before any sync happened). delete_user_r2_data must walk an empty prefix
    cleanly and report 0 deleted, not raise or hang."""
    from app.storage import delete_user_r2_data

    class _EmptyPaginator:
        def paginate(self, **kwargs):
            return iter([{"Contents": []}])  # one page, no objects — "no R2 copy"

    class _FakeClient:
        def get_paginator(self, name):
            assert name == "list_objects_v2"
            return _EmptyPaginator()

        def delete_objects(self, **kwargs):
            raise AssertionError("delete_objects must not be called when nothing exists")

    monkeypatch.setattr("app.storage.R2_ENABLED", True, raising=False)
    monkeypatch.setattr("app.storage.get_r2_client", lambda: _FakeClient())

    uid = _uid("nor2")
    deleted = delete_user_r2_data(uid)
    assert deleted == 0


def test_nuf_reset_still_purges_storage_and_caches(hermetic, monkeypatch):
    """The NUF auto-reset path (_reset_test_account) still wipes local + caches (now via the
    shared purge) so a reset test account logs in fresh."""
    from unittest.mock import MagicMock

    from app.routers import auth

    uid = _uid("nuf")
    pid = "99990000"
    _seed_caches(uid, pid, hermetic)

    # Stub Postgres so the share/identity cleanup is a harmless no-op.
    import contextlib

    @contextlib.contextmanager
    def _stub_pg():
        yield MagicMock()

    monkeypatch.setattr("app.services.pg.get_pg", _stub_pg)
    auth._reset_test_account(uid, "nuf@test.local")

    _assert_caches_cleared(uid, pid, hermetic)
