"""T11500 Steps 3/6 (backend half): template-state assertions, nuke-safety selection of the
cleanup script, and the copy script's AccountCloneError -> exit 1 contract.

The template BUILDER ITSELF needs dev R2 + Postgres + the fixture account and was NOT run
live here; only its pure `assert_preset_state` is exercised, on synthetic SQLite.
"""
import importlib
import sqlite3
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))

NOW = datetime(2026, 11, 2, 12, 0, 0, tzinfo=UTC)


def _mod(name):
    return importlib.import_module(name)


# ---- cleanup_dev_accounts selection --------------------------------------

def _row(email, test=True, age_days=1):
    return {"user_id": email, "email": email, "is_test_account": test,
            "created_at": NOW - timedelta(days=age_days)}


def _email(preset, stack, ts="20261101T100000", h="a1b2c3"):
    return f"dev+{preset}+{stack}+{ts}-{h}@reelballers.local"


def test_stack_selection_is_exact_and_never_touches_templates_or_real_accounts():
    c = _mod("cleanup_dev_accounts")
    rows = [
        _row(_email("full", "a")), _row(_email("empty", "a", h="ffffff")),
        _row(_email("full", "a-2")),                     # different stack that shares a prefix
        _row("dev-template+full@reelballers.local"),     # template
        _row(_email("full", "a"), test=False),           # same grammar but not a test account
        _row("imankh@gmail.com"),
    ]
    selected, refused = c.select_accounts(rows, "a", None, NOW)
    assert [r["email"] for r in selected] == [_email("full", "a"), _email("empty", "a", h="ffffff")]
    assert [r["email"] for r in refused] == ["dev-template+full@reelballers.local"]


def test_template_is_refused_even_with_older_than_zero_days():
    c = _mod("cleanup_dev_accounts")
    rows = [_row("dev-template+upload@reelballers.local", age_days=400), _row(_email("upload", "host"), age_days=3)]
    selected, refused = c.select_accounts(rows, None, c.parse_older_than("0d"), NOW)
    assert [r["email"] for r in selected] == [_email("upload", "host")]
    assert len(refused) == 1


def test_older_than_keeps_recent_accounts_and_selection_requires_a_filter():
    c = _mod("cleanup_dev_accounts")
    rows = [_row(_email("empty", "host"), age_days=10), _row(_email("empty", "host", h="eeeeee"), age_days=2)]
    selected, _ = c.select_accounts(rows, None, c.parse_older_than("7d"), NOW)
    assert [r["email"] for r in selected] == [_email("empty", "host")]
    with pytest.raises(ValueError):
        c.select_accounts(rows, None, None, NOW)
    with pytest.raises(__import__("argparse").ArgumentTypeError):
        c.parse_older_than("7 days")


# ---- build_dev_account_templates.assert_preset_state ----------------------

def _profile(games=1, raw=0, projects=(), published=0, expiry="2099-12-31T00:00:00+00:00"):
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.executescript("""
        CREATE TABLE games (id INTEGER PRIMARY KEY, status TEXT, blake3_hash TEXT);
        CREATE TABLE game_videos (id INTEGER PRIMARY KEY, blake3_hash TEXT);
        CREATE TABLE game_storage (blake3_hash TEXT, storage_expires_at TEXT);
        CREATE TABLE raw_clips (id INTEGER PRIMARY KEY, game_id INTEGER);
        CREATE TABLE projects (id INTEGER PRIMARY KEY, working_video_id INTEGER, final_video_id INTEGER,
                               current_mode TEXT);
        CREATE TABLE working_clips (id INTEGER PRIMARY KEY, project_id INTEGER);
        CREATE TABLE final_videos (id INTEGER PRIMARY KEY, published_at TEXT);
    """)
    for i in range(games):
        c.execute("INSERT INTO games (id, status, blake3_hash) VALUES (?, 'ready', ?)", (i + 1, f"h{i}"))
        c.execute("INSERT INTO game_storage VALUES (?, ?)", (f"h{i}", expiry))
    for _ in range(raw):
        c.execute("INSERT INTO raw_clips (game_id) VALUES (1)")
    for n, (wv, fv, mode) in enumerate(projects, 1):
        c.execute("INSERT INTO projects VALUES (?, ?, ?, ?)", (n, wv, fv, mode))
        c.execute("INSERT INTO working_clips (project_id) VALUES (?)", (n,))
    for _ in range(published):
        c.execute("INSERT INTO final_videos (published_at) VALUES ('2026-01-01')")
    return c


def _refs(*profile_ids, expiry="2099-12-31T00:00:00+00:00"):
    return [{"profile_id": p, "blake3_hash": "h0", "storage_expires_at": expiry} for p in profile_ids]


def test_upload_state_passes_and_detects_drift():
    b = _mod("build_dev_account_templates")
    P = b.DevAccountPreset.UPLOAD
    assert b.assert_preset_state(P, {"p1": _profile()}, _refs("p1"), "p1") == []
    assert any("raw_clips" in m for m in b.assert_preset_state(P, {"p1": _profile(raw=2)}, _refs("p1"), "p1"))
    assert any("far-future" in m for m in b.assert_preset_state(
        P, {"p1": _profile(expiry="2026-12-01T00:00:00")}, _refs("p1"), "p1"))
    assert any("PG game_storage_refs" in m for m in b.assert_preset_state(
        P, {"p1": _profile()}, _refs("p1", expiry="2026-12-01T00:00:00+00:00"), "p1"))
    assert any("expected 1 profile" in m for m in b.assert_preset_state(
        P, {"p1": _profile(), "p2": _profile()}, _refs("p1", "p2"), "p1"))


def test_full_state_requires_two_profiles_and_all_three_project_states():
    b = _mod("build_dev_account_templates")
    P = b.DevAccountPreset.FULL
    projects = [(None, None, "framing"), (1, None, "overlay")]
    good = {"p1": _profile(raw=6, projects=projects, published=1), "p2": _profile()}
    assert b.assert_preset_state(P, good, _refs("p1", "p2"), "p1") == []
    one_profile = {"p1": good["p1"]}
    assert any("expected 2 profiles" in m for m in b.assert_preset_state(P, one_profile, _refs("p1"), "p1"))
    no_final = {"p1": _profile(raw=6, projects=projects, published=0), "p2": _profile()}
    assert any("published final video" in m for m in b.assert_preset_state(P, no_final, _refs("p1", "p2"), "p1"))
    no_spot = {"p1": _profile(raw=6, projects=[(None, None, "framing")], published=1), "p2": _profile()}
    assert any("Spotlight" in m for m in b.assert_preset_state(P, no_spot, _refs("p1", "p2"), "p1"))
    few = {"p1": _profile(raw=1, projects=projects, published=1), "p2": _profile()}
    assert any("raw_clips" in m for m in b.assert_preset_state(P, few, _refs("p1", "p2"), "p1"))
    empty_second = {"p1": good["p1"], "p2": _profile(games=0)}
    assert any("second profile must own" in m for m in b.assert_preset_state(P, empty_second, _refs("p1"), "p1"))


# ---- copy_user_between_envs main(): AccountCloneError -> exit 1 -----------

def test_copy_script_maps_account_clone_error_to_exit_code_1(monkeypatch, caplog):
    cu = _mod("copy_user_between_envs")
    from app.services.account_clone import AccountCloneError
    monkeypatch.setattr(sys, "argv", ["copy_user_between_envs.py", "--email", "x@y.com", "--from", "dev",
                                      "--to", "staging", "--dest-machines-stopped"])
    monkeypatch.setattr(cu, "load_env", lambda env: {"APP_ENV": env})
    monkeypatch.setattr(cu, "copy_postgres_rows", lambda *a, **k: ("u", "u"))

    def fail(*a, **k):
        raise AccountCloneError("empty_source", ["dev/users/u/"])

    monkeypatch.setattr(cu, "copy_r2_objects", fail)
    with caplog.at_level("ERROR"), pytest.raises(SystemExit) as exc:
        cu.main()
    assert exc.value.code == 1
    assert any("empty_source" in r.message for r in caplog.records)


# ---- builder main(): must bring up the PG pool itself (first live run crashed) ----

def test_builder_main_initializes_the_pg_pool_before_touching_postgres(monkeypatch):
    """The script runs outside uvicorn, so nothing else calls init_pg_pool(); --check hits
    auth_db.get_user_by_email first and raised 'Postgres pool not initialized'. (conftest stubs
    the pool for every test, so the order of init -> first query -> close is what is asserted;
    the real pool is proven by the live run recorded in qa/.)"""
    from app.services import auth_db, pg

    b = _mod("build_dev_account_templates")
    events = []
    monkeypatch.setattr(pg, "init_pg_pool", lambda: events.append("init"))
    monkeypatch.setattr(pg, "close_pg_pool", lambda: events.append("close"))
    monkeypatch.setattr(auth_db, "get_user_by_email",
                        lambda email: events.append("query") or {"user_id": "t"})
    monkeypatch.setattr(b, "_guard_dev", lambda: None)
    monkeypatch.setattr(b, "build_preset", lambda *a, **k: [])
    assert b.main(["--check", "--preset", "upload"]) == 0
    assert events == ["init", "query", "close"]


def test_builder_loads_dotenv_before_any_app_import():
    """app.storage freezes R2_ENABLED at import; the first live run died 'R2_ENABLED is not true'
    because the script imported app.* before reading .env (main.py documents the same trap)."""
    src = (Path(__file__).resolve().parents[3] / "scripts" / "build_dev_account_templates.py").read_text()
    assert "load_dotenv(" in src
    assert src.index("load_dotenv(") < src.index("\nfrom app.")


# ---- builder trim + R2 prune (first live run: FK failure, 631 objects / 3.1 GB per clone) ----

@pytest.fixture()
def fixture_profile_db(tmp_path):
    """A profile DB built by the real ensure_database() (canonical schema + FKs), seeded like
    the dev fixture: a chosen game G (two video hashes) and another game, projects in each
    state plus one on the other game, and a stray pending upload."""
    from unittest.mock import patch

    from app.profile_context import set_current_profile_id
    from app.user_context import set_current_user_id

    set_current_user_id("trim-user")
    set_current_profile_id("trimprof")
    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.database._initialized_users", set()), \
         patch("app.database.R2_ENABLED", False):
        from app.database import ensure_database, get_database_path
        ensure_database()
        path = get_database_path()
    c = sqlite3.connect(str(path))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys = ON")
    x = c.execute
    x("INSERT INTO games (id, name, blake3_hash, status) VALUES (1, 'G', 'hG', 'ready')")
    x("INSERT INTO games (id, name, blake3_hash, status) VALUES (2, 'Other', 'hO', 'ready')")
    x("INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (1, 'hG', 1)")
    x("INSERT INTO game_videos (game_id, blake3_hash, sequence) VALUES (1, 'hG2', 2)")
    for h in ("hG", "hG2", "hO"):
        x("INSERT INTO game_storage (blake3_hash, game_size_bytes, storage_expires_at) VALUES (?, 1, '2026-01-01')", (h,))
    for i in range(1, 9):
        x("INSERT INTO raw_clips (id, filename, game_id, start_time, end_time) VALUES (?, ?, 1, 0, 1)", (i, f"c{i}.mp4"))
    for i in (20, 21):
        x("INSERT INTO raw_clips (id, filename, game_id, start_time, end_time) VALUES (?, ?, 2, 0, 1)", (i, f"c{i}.mp4"))
    for pid in (101, 102, 103, 104):
        x("INSERT INTO projects (id, name, aspect_ratio) VALUES (?, ?, '9:16')", (pid, f"P{pid}"))
    x("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (101, 8)")    # Framing, uses clip 8
    x("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (102, 2)")
    x("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (103, 3)")
    x("INSERT INTO working_clips (project_id, raw_clip_id) VALUES (104, 20)")   # other game
    x("INSERT INTO working_videos (id, project_id, filename) VALUES (1, 102, 'w102.mp4')")
    x("UPDATE projects SET working_video_id = 1, current_mode = 'overlay' WHERE id = 102")
    x("INSERT INTO final_videos (id, project_id, filename, poster_filename, published_at) "
      "VALUES (1, 103, 'f103.mp4', 'f103.mp4.jpg', '2026-10-01')")
    x("INSERT INTO final_videos (id, project_id, filename, poster_filename) VALUES (2, 104, 'f104.mp4', 'f104.mp4.jpg')")
    x("UPDATE projects SET final_video_id = 1 WHERE id = 103")
    x("UPDATE projects SET final_video_id = 2 WHERE id = 104")
    x("INSERT INTO pending_uploads (blake3_hash, file_size, original_filename, r2_upload_id, parts_json) VALUES ('hX', 1, 'x.mp4', 'u1', '[]')")
    c.commit()
    yield c
    c.close()


def _ids(c, sql):
    return sorted(r[0] for r in c.execute(sql))


def test_trim_full_keeps_exactly_the_preset_without_fk_errors(fixture_profile_db):
    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    b.trim_profile_db(c, keep_project_ids=[101, 102, 103], game_id=1, max_raw_clips=6)
    assert _ids(c, "SELECT id FROM projects") == [101, 102, 103]
    assert _ids(c, "SELECT id FROM final_videos") == [1]
    assert _ids(c, "SELECT id FROM games") == [1]
    clips = _ids(c, "SELECT id FROM raw_clips")
    assert len(clips) == 6 and {2, 3, 8} <= set(clips)          # clips the kept projects use survive
    assert {r[0]: r[1] for r in c.execute("SELECT blake3_hash, storage_expires_at FROM game_storage")} == {
        "hG": b.FAR_FUTURE_EXPIRY, "hG2": b.FAR_FUTURE_EXPIRY}
    assert _ids(c, "SELECT id FROM pending_uploads") == []
    assert c.execute("PRAGMA foreign_key_check").fetchall() == []


def test_trim_upload_keeps_only_the_game(fixture_profile_db):
    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    b.trim_profile_db(c, keep_project_ids=[], game_id=1, max_raw_clips=0)
    for t in ("projects", "final_videos", "raw_clips", "working_videos", "working_clips"):
        assert _ids(c, f"SELECT id FROM {t}") == [], t
    assert _ids(c, "SELECT id FROM games") == [1]


def test_prune_keeps_only_objects_the_trimmed_db_references(fixture_profile_db):
    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    b.trim_profile_db(c, keep_project_ids=[101, 102, 103], game_id=1, max_raw_clips=6)
    kept_clips = [f"raw_clips/c{i}.mp4" for i in _ids(c, "SELECT id FROM raw_clips")]
    present = [
        "profile.sqlite", *kept_clips, "raw_clips/c1.mp4", "raw_clips/c7.mp4", "raw_clips/c20.mp4",
        "working_videos/w102.mp4", "working_videos/w999.mp4",
        "final_videos/f103.mp4", "final_videos/posters/f103.mp4.jpg", "final_videos/posters/f103.mp4.jpg.card.jpg",
        "final_videos/f104.mp4", "final_videos/posters/f104.mp4.jpg",
        "archive/101.msgpack", "archive/104.msgpack", "archive/7.msgpack",
        "posters/drafts/101.v2.jpg", "posters/drafts/104.v2.jpg",
        "recaps/1.mp4", "recaps/1_clips.json", "recaps/posters/1.card.jpg",
        "recaps/2.mp4", "recaps/10.mp4", "recaps/posters/2.card.jpg",
        "intro/a.jpg", "collection_downloads/z.mp4", "reel_downloads/y.mp4",
    ]
    doomed = set(b.objects_to_prune(c, game_id=1, present=present))
    keep = set(present) - doomed
    assert keep == {
        "profile.sqlite", *kept_clips, "working_videos/w102.mp4",
        "final_videos/f103.mp4", "final_videos/posters/f103.mp4.jpg", "final_videos/posters/f103.mp4.jpg.card.jpg",
        "archive/101.msgpack", "posters/drafts/101.v2.jpg",
        "recaps/1.mp4", "recaps/1_clips.json", "recaps/posters/1.card.jpg", "intro/a.jpg",
    }


def test_delete_template_uses_the_app_pg_pool_and_commits_before_the_purge(monkeypatch):
    """--rebuild died connecting to .env's DATABASE_URL (localhost) through delete_user's own
    connector; inside a container only the process env (rewritten host) reaches Postgres --
    which is what the app pool uses. PG work must commit before the irreversible R2 purge."""
    from contextlib import contextmanager

    import delete_user as du

    from app import storage
    from app.services import pg

    b = _mod("build_dev_account_templates")
    events = []

    def _no_own_connector(*a, **k):
        raise AssertionError("must not open its own .env connection")

    class Cur:
        def execute(self, *a):
            events.append("select")

        def fetchone(self):
            return {"user_id": "tmpl-uid"}

    @contextmanager
    def fake_get_pg():
        class Conn:
            def cursor(self):
                return Cur()
        yield Conn()
        events.append("commit")

    monkeypatch.setattr(du, "get_pg_conn", _no_own_connector)
    monkeypatch.setattr(pg, "get_pg", fake_get_pg)
    monkeypatch.setattr(storage, "get_r2_client", lambda: "r2-client")
    monkeypatch.setattr(du, "delete_one_postgres",
                        lambda conn, uid, email, dry_run, force_paid: events.append(("pg_delete", uid)) or [])
    monkeypatch.setattr(du, "purge_user_storage",
                        lambda s3, bucket, env, uid, keys, dry_run: events.append(("purge", s3, uid)) or 0)
    b._delete_template("dev", "dev-template+upload@reelballers.local")
    assert events == ["select", ("pg_delete", "tmpl-uid"), "commit", ("purge", "r2-client", "tmpl-uid")]


def _archive_finished_103_like_the_fixture(c):
    """Real finished projects are ARCHIVED: no working_clips, linked to their game only by
    final_videos.game_ids (msgpack) and source_clip_id."""
    import msgpack
    c.execute("DELETE FROM working_clips WHERE project_id = 103")
    c.execute("UPDATE projects SET archived_at = '2026-06-01 05:38:39' WHERE id = 103")
    c.execute("UPDATE final_videos SET game_ids = ?, source_clip_id = 5 WHERE id = 1", (msgpack.packb([1]),))
    c.execute("UPDATE final_videos SET game_ids = ? WHERE id = 2", (msgpack.packb([2]),))
    c.commit()


def test_full_finds_an_archived_finished_project_by_final_game_ids(fixture_profile_db):
    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    _archive_finished_103_like_the_fixture(c)
    assert b._missing_states(c, 1) == []
    assert b._full_keep_projects(c, 1) == [101, 102, 103]
    assert "a published finished project" in b._missing_states(c, 2)  # 104's final is unpublished


def test_trim_keeps_the_archived_finished_projects_source_clip(fixture_profile_db):
    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    _archive_finished_103_like_the_fixture(c)
    b.trim_profile_db(c, keep_project_ids=[101, 102, 103], game_id=1, max_raw_clips=3)
    assert 5 in _ids(c, "SELECT id FROM raw_clips")      # restore of 103 needs its source clip
    assert len(_ids(c, "SELECT id FROM raw_clips")) == 3  # 8 + 2 (used), 5 (source), no fill left
    assert _ids(c, "SELECT id FROM final_videos") == [1]


def test_pg_refs_are_upserted_for_every_kept_hash(fixture_profile_db, monkeypatch):
    """The dev fixture has NO game_storage_refs rows, so the clone copies none and an UPDATE
    of 'its' refs touches nothing (first live run: pg_refs=0). Refs must be inserted."""
    from app.services import auth_db

    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    calls = []
    monkeypatch.setattr(auth_db, "insert_game_storage_ref_pg_only",
                        lambda uid, pid, h, size, exp: calls.append((uid, pid, h, size, exp)))
    b.trim_profile_db(c, keep_project_ids=[], game_id=1, max_raw_clips=0)
    b._ensure_pg_refs("tmpl", "trimprof", c, 1)
    assert sorted(calls) == [("tmpl", "trimprof", "hG", 1, b.FAR_FUTURE_EXPIRY),
                             ("tmpl", "trimprof", "hG2", 1, b.FAR_FUTURE_EXPIRY)]


def test_missing_game_storage_rows_are_created_from_game_videos_sizes(fixture_profile_db):
    """The fixture's chosen game had game_videos but NO game_storage rows (second live run:
    'game 11 hash 392c8cae has no game_storage row'). The template must hold far-future rows
    for every video of its game, sized from game_videos."""
    b = _mod("build_dev_account_templates")
    c = fixture_profile_db
    c.execute("UPDATE game_videos SET video_size = 70 WHERE blake3_hash = 'hG'")
    c.execute("UPDATE game_videos SET video_size = 30 WHERE blake3_hash = 'hG2'")
    c.execute("DELETE FROM game_storage")
    c.commit()
    b.trim_profile_db(c, keep_project_ids=[], game_id=1, max_raw_clips=0)
    b._ensure_game_storage_rows(c, 1)
    assert {r[0]: (r[1], r[2]) for r in c.execute(
        "SELECT blake3_hash, game_size_bytes, storage_expires_at FROM game_storage")} == {
        "hG": (70, b.FAR_FUTURE_EXPIRY), "hG2": (30, b.FAR_FUTURE_EXPIRY)}


def test_check_sets_the_template_user_context_before_session_init(monkeypatch):
    """`--check` on an existing template called user_session_init with no user context
    (RuntimeError 'No user context set'); only the build path had set it, via the seam."""
    from app import session_init, user_context
    from app.services import auth_db

    b = _mod("build_dev_account_templates")
    seen = []

    class _Stop(Exception):
        pass

    def fake_init(uid):
        seen.append(user_context.get_current_user_id())
        raise _Stop

    user_context.reset_user_id()
    monkeypatch.setattr(auth_db, "get_user_by_email", lambda email: {"user_id": "tmpl-uid"})
    monkeypatch.setattr(session_init, "user_session_init", fake_init)
    with pytest.raises(_Stop):
        b._fixed_point_and_summary(b.DevAccountPreset.UPLOAD, "dev-template+upload@reelballers.local",
                                   None, "bucket", "dev")
    assert seen == ["tmpl-uid"]
