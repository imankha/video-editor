"""T4946 -- Access control for collection download.

Locks in the ACCESS MODEL of `GET /api/collections/download` (the stitch
mechanics themselves are covered by test_t4945_collection_download.py). The
investigation for this task established that "permission to the clip" for a
collection download collapses entirely to OWNERSHIP, enforced structurally:

  - Sign-in: `/api/collections/download` is NOT in the middleware
    AUTH_ALLOWLIST_PREFIXES, so a request with no session cookie / X-User-ID is
    401'd by RequestContextMiddleware BEFORE the handler runs.
  - Ownership: `evaluate_collection_members` / `get_db_connection()` read ONLY
    the caller's own profile DB (resolved purely from the request's
    user/profile ContextVars -- there is no user argument to pass), and
    `final_videos` never holds a foreign-owned reel. A signed-in user can only
    ever stitch their own published reels; another user's collection is
    structurally invisible (404 "no members"), never reachable.
  - Free (Decision 4): NO credit reservation / debit -- downloads are free.

These are the same structural guarantees the sibling single-reel download
(`downloads.py::download_file`) relies on. This file exists so a future change
that would break any of them -- adding a cross-user selector param, moving the
route onto the allowlist, or wiring a credit charge -- turns a test RED instead
of silently widening access.

Mirrors the TestClient + tmp_path SQLite harness of test_t4945 (no Postgres;
owner same-account reads only). The X-User-ID header is honored by the auth
middleware only when APP_ENV != production, which is the test default.
"""

import sqlite3
from contextlib import ExitStack
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

USER_ID = "t4946-owner"
PROFILE_ID = "t4946prof"

# A second, unrelated account used to prove cross-user isolation. Its profile DB
# is empty -- it owns none of USER_ID's reels.
OTHER_USER_ID = "t4946-intruder"
OTHER_PROFILE_ID = "t4946intruderprof"


@pytest.fixture()
def client(tmp_path):
    from app.session_init import _init_cache
    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        from app.database import ensure_database
        from app.profile_context import set_current_profile_id
        from app.user_context import set_current_user_id

        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        ensure_database()

        from app.main import app
        yield TestClient(app, raise_server_exceptions=True)


def _auth_headers() -> dict:
    return {"X-User-ID": USER_ID}


def _db_path():
    from app.database import get_database_path
    return get_database_path()


def _connect(path):
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    return conn


def _seed_member(db_path, *, game_ids=None, duration=15.0, aspect_ratio="9:16",
                 clip_count=1, rating=None, quality_score=None, tags=None):
    """A published, single-clip member reel for the collection resolver.
    Returns (fv_id, filename)."""
    from app.utils.encoding import encode_data
    conn = _connect(db_path)
    cur = conn.cursor()
    cur.execute("INSERT INTO projects (name, aspect_ratio) VALUES ('Reel', ?)", (aspect_ratio,))
    project_id = cur.lastrowid
    filename = f"f{project_id}.mp4"
    cur.execute(
        "INSERT INTO final_videos (project_id, filename, version, source_type, name, "
        "duration, aspect_ratio, published_at, clip_count, game_ids, tags, rating, quality_score) "
        "VALUES (?, ?, 1, 'custom_project', 'Reel', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?)",
        (project_id, filename, duration, aspect_ratio, clip_count,
         encode_data(game_ids) if game_ids is not None else None,
         encode_data(tags) if tags else None, rating, quality_score),
    )
    fv_id = cur.lastrowid
    cur.execute("UPDATE projects SET final_video_id = ? WHERE id = ?", (fv_id, project_id))
    conn.commit()
    conn.close()
    return fv_id, filename


def _install_stub_pipeline(stack, *, captured=None):
    """Patch the ffmpeg / intro / compose boundaries so a permitted download
    streams a byte or two without a real engine (local compute branch)."""
    captured = captured if captured is not None else {}

    def _local_stitch(user_id, profile_id, member_keys, out_path, tmp_dir):
        captured["local_member_keys"] = list(member_keys)
        with open(out_path, "wb") as f:
            f.write(b"STITCH")

    def _resolve_intro(user_id, profile_id, raw_card_id, total_duration, reel_id, **kw):
        return None

    def _compose(reel_path, out_path, *, intro=None, outro=True, metadata_hook=None):
        with open(out_path, "wb") as f:
            f.write(b"COMPOSED")
        return True

    stack.enter_context(patch("app.services.modal_client.modal_enabled", return_value=False))
    stack.enter_context(patch("app.routers.collections._stitch_members_local", _local_stitch))
    stack.enter_context(patch("app.services.intro_egress.resolve_intro_for_reel", _resolve_intro))
    stack.enter_context(patch("app.services.serve_time_video.compose_serve_time", _compose))
    return captured


# ===========================================================================
# 1. Sign-in gate: signed-out is rejected with a clear reason (not 500/bare 403)
# ===========================================================================

def test_signed_out_request_rejected_with_clear_401(client):
    """No session cookie and no X-User-ID -> the middleware 401s BEFORE the
    handler (the path is not allowlisted). It must be a clean, clearly-worded
    401 -- never the RuntimeError->500 that get_current_user_id would raise if
    an unauthenticated request somehow reached the handler, and never a bare
    403 with no context."""
    resp = client.get(
        "/api/collections/download",
        params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
        # deliberately NO auth headers
    )
    assert resp.status_code == 401
    detail = resp.json().get("detail", "")
    assert detail, "signed-out rejection must carry a reason, not a bare status"
    assert "auth" in detail.lower() or "session" in detail.lower()


# ===========================================================================
# 2. Permitted owner succeeds
# ===========================================================================

def test_signed_in_owner_with_members_can_download(client):
    """A signed-in user who owns published, in-scope reels downloads them."""
    db = _db_path()
    _, f1 = _seed_member(db, game_ids=[9], rating=2)
    _, f2 = _seed_member(db, game_ids=[9], rating=1)

    with ExitStack() as stack:
        cap = _install_stub_pipeline(stack)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    assert cap["local_member_keys"] == [f"final_videos/{f1}", f"final_videos/{f2}"]


# ===========================================================================
# 3. Unpermitted-but-signed-in: distinct failure mode, clear reason
# ===========================================================================

def test_signed_in_user_without_permitted_members_rejected_clearly(client):
    """A signed-in user requesting a scope they own no reels for gets a clear
    404 -- a DIFFERENT failure mode from the signed-out 401, with an explicit
    reason (never a bare 403). Because ownership is structural, "someone else's
    collection" is indistinguishable from "an empty one of your own": both
    surface as no members."""
    # user owns a 9:16 reel under game 9, but asks for game 999 (owns nothing).
    _seed_member(_db_path(), game_ids=[9], rating=1)

    with ExitStack() as stack:
        _install_stub_pipeline(stack)
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 999},
            headers=_auth_headers(),
        )
    assert resp.status_code == 404
    detail = resp.json().get("detail", "")
    assert "member" in detail.lower(), "the 404 must say WHY (no members), not be bare"


# ===========================================================================
# 4. Ownership is structural: another user's collection is invisible
# ===========================================================================

def test_members_are_scoped_to_the_callers_own_profile_db(tmp_path):
    """The core structural invariant. `evaluate_collection_members` reads the
    connection it is handed, and `get_db_connection()` resolves that connection
    purely from the request's own user/profile ContextVars -- there is no user
    argument, so a caller can NEVER address another user's profile DB. Seed
    reels for USER_ID; a second signed-in user (empty profile) sees NONE of
    them, and USER_ID still sees its own -- proving isolation is a property of
    the connection, not a check that could be forgotten."""
    from app.database import ensure_database, get_database_path, get_db_connection
    from app.profile_context import set_current_profile_id
    from app.routers.collections import (
        _collection_scope_and_definition,
        evaluate_collection_members,
    )
    from app.session_init import _init_cache
    from app.user_context import set_current_user_id

    _init_cache[USER_ID] = {"profile_id": PROFILE_ID, "is_new_user": False}
    _init_cache[OTHER_USER_ID] = {"profile_id": OTHER_PROFILE_ID, "is_new_user": False}

    _, definition = _collection_scope_and_definition("game", "9:16", 9, None)

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db._initialized_user_dbs", set()):
        # --- owner: seed two in-scope reels ---
        set_current_user_id(USER_ID)
        set_current_profile_id(PROFILE_ID)
        ensure_database()
        _seed_member(get_database_path(), game_ids=[9], rating=2)
        _seed_member(get_database_path(), game_ids=[9], rating=1)

        with get_db_connection() as conn:
            owner_members = evaluate_collection_members(conn, definition)
        assert len(owner_members) == 2, "owner sees their own reels"

        # --- a different signed-in user: empty profile, sees nothing ---
        set_current_user_id(OTHER_USER_ID)
        set_current_profile_id(OTHER_PROFILE_ID)
        ensure_database()
        with get_db_connection() as conn:
            intruder_members = evaluate_collection_members(conn, definition)
        assert intruder_members == [], \
            "a signed-in non-owner cannot reach another user's collection members"


# ===========================================================================
# 5. Free (Decision 4): a download never touches the credit ledger
# ===========================================================================

def test_download_charges_no_credits(client):
    """Decision 4 resolved downloads FREE. No reservation, no debit -- ever. If
    a future change wires a credit charge into this path, this test fails.

    The robust guard is the `credit_ledger.get_pg` spy: EVERY ledger mutation
    (grant / debit / reserve_credits / confirm_reservation) funnels through
    `with get_pg() as conn:` bound into the credit_ledger module, so patching it
    there catches any charge no matter how the caller imported the wrapper
    (real charge sites `from ..services.credit_ledger import reserve_credits`
    by value -- a module-attr spy on reserve_credits alone would miss that). The
    named reserve/debit spies are kept too, to document intent."""
    import app.services.credit_ledger as credit_ledger

    _seed_member(_db_path(), game_ids=[9], rating=1)

    with ExitStack() as stack:
        _install_stub_pipeline(stack)
        ledger_pg = stack.enter_context(
            patch.object(credit_ledger, "get_pg", wraps=credit_ledger.get_pg)
        )
        reserve = stack.enter_context(
            patch.object(credit_ledger, "reserve_credits", wraps=credit_ledger.reserve_credits)
        )
        debit = stack.enter_context(
            patch.object(credit_ledger, "debit", wraps=credit_ledger.debit)
        )
        resp = client.get(
            "/api/collections/download",
            params={"scope_type": "game", "aspect_ratio": "9:16", "game_id": 9},
            headers=_auth_headers(),
        )
    assert resp.status_code == 200
    reserve.assert_not_called()
    debit.assert_not_called()
    ledger_pg.assert_not_called()  # no ledger mutation of ANY kind touched PG
