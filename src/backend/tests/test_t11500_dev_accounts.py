"""T11500 Step 4: dev-only account picker backend (/api/auth/dev-accounts).

Red-first: before the feature `app.routers.dev_accounts`, `_mount_dev_only_routers`,
`account_clone.clone_account_for_dev` and `auth_db.create_user(is_test_account=)` do not
exist, so every test fails (ModuleNotFoundError / AttributeError / TypeError at call time,
because the feature modules are imported lazily inside the tests, NOT stubbed).
"""
import importlib
import re
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import psycopg2
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from psycopg2.extras import RealDictCursor

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

from tests.conftest import register_test_user_ids
from tests.test_t11500_account_clone_characterization import FakeR2, _seed_profile_sqlite

ENV = "test"
BUCKET = "bucket"
HASH = "ab" * 16
EXPIRY = "2099-12-31T00:00:00+00:00"


def _mod(name):
    return importlib.import_module(name)


def _mounted_app(monkeypatch, app_env):
    from app import storage
    monkeypatch.setattr(storage, "APP_ENV", app_env)
    from app import main as main_mod
    app = FastAPI()
    main_mod._mount_dev_only_routers(app)
    return app


def _paths(app):
    return {getattr(r, "path", "") for r in app.routes}


def _session_cookie(resp):
    m = re.search(r"rb_session=([^;]+)", resp.headers.get("set-cookie", ""))
    assert m, "no rb_session Set-Cookie"
    return m.group(1)


def _q(dsn, sql, params=()):
    c = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
    try:
        cur = c.cursor()
        cur.execute(sql, params)
        return cur.fetchall() if cur.description else None
    finally:
        c.commit()
        c.close()


@pytest.fixture
def dev_client(monkeypatch, pg_conn):
    from app import storage
    monkeypatch.setattr(storage, "APP_ENV", ENV)
    monkeypatch.setattr(storage, "R2_ENABLED", True)
    monkeypatch.setattr(storage, "R2_BUCKET", BUCKET)
    monkeypatch.setenv("DEV_STACK_ID", "stack-a")
    r2 = FakeR2()
    monkeypatch.setattr(storage, "get_r2_client", lambda: r2)
    app = _mounted_app(monkeypatch, ENV)
    return TestClient(app), r2, pg_conn


def _seed_template(dsn, r2, monkeypatch, preset="upload", with_game_video=True):
    dev = _mod("app.routers.dev_accounts")
    suffix = uuid.uuid4().hex[:8]
    tid = f"t11500-tpl-{suffix}"
    email = f"dev-template+{preset}-test-{suffix}@reelballers.local"
    register_test_user_ids(tid)
    monkeypatch.setitem(dev.TEMPLATE_EMAILS, dev.DevAccountPreset(preset), email)
    _q(dsn, "INSERT INTO users (user_id, email, is_test_account) VALUES (%s, %s, TRUE)", (tid, email))
    _q(dsn, "INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at) "
            "VALUES (%s, 'p1', %s, 10, %s)", (tid, HASH, EXPIRY))
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        prof = _seed_profile_sqlite(Path(td))
    p = f"{ENV}/users/{tid}"
    r2.objects.update({
        f"{p}/user.sqlite": b"u", f"{p}/profiles/p1/profile.sqlite": prof,
        f"{p}/profiles/p1/raw_clips/a.mp4": b"a",
    })
    if with_game_video:
        r2.objects[f"games/{HASH}.mp4"] = b"video"
    return tid


# ---- Layer 1: mount gating -------------------------------------------------

@pytest.mark.parametrize("app_env", ["staging", "production", "prod"])
def test_routes_absent_and_404_outside_dev(monkeypatch, app_env):
    app = _mounted_app(monkeypatch, app_env)
    assert not any(p.startswith("/api/auth/dev-accounts") for p in _paths(app))
    client = TestClient(app)
    assert client.get("/api/auth/dev-accounts").status_code == 404
    assert client.post("/api/auth/dev-accounts/empty").status_code == 404


@pytest.mark.parametrize("app_env", ["dev", "local", "test"])
def test_routes_mounted_in_dev_envs(monkeypatch, app_env):
    app = _mounted_app(monkeypatch, app_env)
    assert "/api/auth/dev-accounts" in _paths(app)
    assert "/api/auth/dev-accounts/{preset}" in _paths(app)


def test_dev_accounts_path_is_allowlisted_for_logged_out_callers():
    from types import SimpleNamespace

    from app.middleware.db_sync import RequestContextMiddleware
    mw = object.__new__(RequestContextMiddleware)
    for method in ("GET", "POST"):
        req = SimpleNamespace(method=method, url=SimpleNamespace(path="/api/auth/dev-accounts/full"))
        assert mw._is_allowlisted(req)
    assert mw._is_allowlisted(SimpleNamespace(method="GET", url=SimpleNamespace(path="/api/auth/dev-accounts")))


# ---- Layer 2: handlers re-check, no side effects --------------------------

@pytest.mark.parametrize("app_env", ["staging", "production"])
def test_handlers_404_without_side_effects_outside_dev(monkeypatch, app_env):
    from app import storage
    from app.services import account_clone, auth_db
    dev = _mod("app.routers.dev_accounts")
    monkeypatch.setattr(storage, "APP_ENV", app_env)

    def boom(*a, **k):
        raise AssertionError("side effect before the gate")

    monkeypatch.setattr(auth_db, "create_user", boom)
    monkeypatch.setattr(account_clone, "clone_account_for_dev", boom)
    for call in (lambda: dev.list_dev_accounts(),
                 lambda: dev.create_dev_account(dev.DevAccountPreset.EMPTY),
                 lambda: dev.create_dev_account(dev.DevAccountPreset.FULL)):
        with pytest.raises(HTTPException) as exc:
            call()
        assert exc.value.status_code == 404


# ---- empty preset: distinct accounts + cookie -----------------------------

def test_two_empty_picks_are_distinct_logged_in_test_accounts(dev_client):
    client, _r2, dsn = dev_client
    cleanup = _mod("cleanup_dev_accounts")
    from app.services import auth_db
    seen = []
    for _ in range(2):
        resp = client.post("/api/auth/dev-accounts/empty")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        register_test_user_ids(body["user_id"])
        row = _q(dsn, "SELECT email, is_test_account FROM users WHERE user_id = %s", (body["user_id"],))[0]
        assert row["is_test_account"] is True
        assert row["email"] == body["email"]
        m = cleanup.DEV_ACCOUNT_EMAIL_RE.match(row["email"])
        assert m and m.group("stack") == "stack-a" and m.group("preset") == "empty"
        assert auth_db.validate_session(_session_cookie(resp))["user_id"] == body["user_id"]
        seen.append(body["user_id"])
    assert seen[0] != seen[1]


def test_dev_account_email_grammar_and_same_second_uniqueness():
    dev = _mod("app.routers.dev_accounts")
    cleanup = _mod("cleanup_dev_accounts")
    now = datetime(2026, 11, 2, 12, 30, 5, tzinfo=UTC)
    a = dev.dev_account_email(dev.DevAccountPreset.FULL, "reel-task-foo", now, str(uuid.uuid4()))
    b = dev.dev_account_email(dev.DevAccountPreset.FULL, "reel-task-foo", now, str(uuid.uuid4()))
    assert a != b and cleanup.DEV_ACCOUNT_EMAIL_RE.match(a)
    assert a.startswith("dev+full+reel-task-foo+20261102T123005-")


def test_invalid_stack_id_is_a_loud_500(monkeypatch):
    dev = _mod("app.routers.dev_accounts")
    monkeypatch.setenv("DEV_STACK_ID", "Bad Stack!")
    with pytest.raises(HTTPException) as exc:
        dev.current_stack_id()
    assert exc.value.status_code == 500


# ---- clone presets --------------------------------------------------------

def test_two_upload_picks_clone_isolated_accounts_and_protect_the_game(dev_client, monkeypatch):
    client, r2, dsn = dev_client
    tid = _seed_template(dsn, r2, monkeypatch)
    tpl_prefix = f"{ENV}/users/{tid}/"
    tpl_snapshot = {k: v for k, v in r2.objects.items() if k.startswith(tpl_prefix)}
    games_before = {k for k in r2.objects if k.startswith("games/")}
    ids = []
    for _ in range(2):
        resp = client.post("/api/auth/dev-accounts/upload")
        assert resp.status_code == 200, resp.text
        uid = resp.json()["user_id"]
        register_test_user_ids(uid)
        ids.append(uid)
        mirrored = {k[len(f"{ENV}/users/{uid}/"):] for k in r2.objects if k.startswith(f"{ENV}/users/{uid}/")}
        assert mirrored == {k[len(tpl_prefix):] for k in tpl_snapshot}
        refs = _q(dsn, "SELECT profile_id, blake3_hash, game_size_bytes, storage_expires_at "
                       "FROM game_storage_refs WHERE user_id = %s", (uid,))
        assert [(r["profile_id"], r["blake3_hash"], r["game_size_bytes"]) for r in refs] == [("p1", HASH, 10)]
        assert refs[0]["storage_expires_at"].year == 2099
        row = _q(dsn, "SELECT is_test_account FROM users WHERE user_id = %s", (uid,))[0]
        assert row["is_test_account"] is True
    assert ids[0] != ids[1]
    assert {k: v for k, v in r2.objects.items() if k.startswith(tpl_prefix)} == tpl_snapshot
    assert {k for k in r2.objects if k.startswith("games/")} == games_before  # game video never copied
    assert _q(dsn, "SELECT COUNT(*) AS n FROM game_storage_refs WHERE user_id = %s", (tid,))[0]["n"] == 1


def test_full_pick_without_template_is_409_and_creates_nothing(dev_client, monkeypatch):
    client, _r2, dsn = dev_client
    dev = _mod("app.routers.dev_accounts")
    monkeypatch.setitem(dev.TEMPLATE_EMAILS, dev.DevAccountPreset.FULL,
                        f"dev-template+full-missing-{uuid.uuid4().hex[:8]}@reelballers.local")
    before = _q(dsn, "SELECT COUNT(*) AS n FROM users")[0]["n"]
    resp = client.post("/api/auth/dev-accounts/full")
    assert resp.status_code == 409
    assert resp.json()["code"] == "template_missing"
    assert _q(dsn, "SELECT COUNT(*) AS n FROM users")[0]["n"] == before


def test_listing_reports_template_availability(dev_client, monkeypatch):
    client, r2, dsn = dev_client
    dev = _mod("app.routers.dev_accounts")
    monkeypatch.setitem(dev.TEMPLATE_EMAILS, dev.DevAccountPreset.FULL,
                        f"dev-template+full-missing-{uuid.uuid4().hex[:8]}@reelballers.local")
    _seed_template(dsn, r2, monkeypatch, preset="upload")
    body = client.get("/api/auth/dev-accounts").json()
    assert body["stack_id"] == "stack-a"
    by_id = {p["id"]: p for p in body["presets"]}
    assert by_id["empty"]["available"] and by_id["upload"]["available"]
    assert not by_id["full"]["available"]
    assert "build_dev_account_templates.py" in by_id["full"]["unavailable_reason"]


@pytest.mark.parametrize("failure", ["dropped_object", "game_video_missing"])
def test_clone_failure_is_a_loud_500_with_nothing_left_behind(dev_client, monkeypatch, failure):
    client, r2, dsn = dev_client
    tid = _seed_template(dsn, r2, monkeypatch, with_game_video=(failure != "game_video_missing"))
    if failure == "dropped_object":
        r2.drop_on_copy.add(f"{ENV}/users/{tid}/profiles/p1/raw_clips/a.mp4")
    keys_before = set(r2.objects)
    users_before = _q(dsn, "SELECT COUNT(*) AS n FROM users")[0]["n"]
    resp = client.post("/api/auth/dev-accounts/upload")
    assert resp.status_code == 500
    assert resp.json()["code"] == "clone_failed"
    assert "set-cookie" not in resp.headers
    assert _q(dsn, "SELECT COUNT(*) AS n FROM users")[0]["n"] == users_before
    assert set(r2.objects) == keys_before  # new prefix purged
