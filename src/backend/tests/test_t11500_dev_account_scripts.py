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
