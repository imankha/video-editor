"""T5970: read-only migration-status probe. `get_migration_status_for_user` reports each
registered profile's ACTUAL R2 schema version vs. code head WITHOUT running the mutating
full-R2-walk migrate — closing the "no way to ask what has been run" gap. These tests mock
the R2 version read + profile registry so no real storage is needed, and pin the at_head /
unknown / behind classification the operator relies on."""

import app.migrations as m


def _patch(monkeypatch, profiles, r2_versions):
    monkeypatch.setattr(m, "_read_r2_profile_user_version", lambda uid, pid: r2_versions.get(pid))
    import app.services.user_db as udb
    monkeypatch.setattr(udb, "ensure_user_database", lambda uid: None)
    monkeypatch.setattr(udb, "get_profiles", lambda uid: [{"id": p} for p in profiles])


def test_head_only_when_no_user():
    s = m.get_migration_status()
    assert set(s) == {"user_db", "profile_db", "postgres"}
    assert s["profile_db"]["latest_version"] == m.PROFILE_DB_RUNNER.latest_version


def test_all_profiles_at_head(monkeypatch):
    head = m.PROFILE_DB_RUNNER.latest_version
    _patch(monkeypatch, ["aaaa1111"], {"aaaa1111": head})
    s = m.get_migration_status_for_user("u1")
    assert s["all_profiles_at_head"] is True
    assert s["profiles"][0]["at_head"] is True
    assert s["profiles"][0]["r2_user_version"] == head


def test_profile_behind_head_flagged(monkeypatch):
    head = m.PROFILE_DB_RUNNER.latest_version
    _patch(monkeypatch, ["aaaa1111", "bbbb2222"], {"aaaa1111": head, "bbbb2222": head - 3})
    s = m.get_migration_status_for_user("u1")
    assert s["all_profiles_at_head"] is False
    behind = next(p for p in s["profiles"] if p["profile_id"] == "bbbb2222")
    assert behind["at_head"] is False


def test_unreadable_r2_is_unknown_not_at_head(monkeypatch):
    _patch(monkeypatch, ["aaaa1111"], {"aaaa1111": None})
    s = m.get_migration_status_for_user("u1")
    assert s["profiles"][0]["at_head"] is None
    assert s["all_profiles_at_head"] is False
