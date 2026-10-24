"""T13260: staging deploy runs Postgres migrations via a Fly release_command.

`migrate_postgres()` returns its error in a dict and never raises, so the release
command needs a wrapper that turns `error` into a nonzero exit (aborting the release).
"""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_release_command_exits_zero_and_logs_applied_empty(monkeypatch, capsys):
    from app import migrations

    monkeypatch.setattr("app.services.pg.init_pg_pool", lambda: None)
    monkeypatch.setattr(
        migrations, "migrate_postgres",
        lambda: {"applied": [], "current_version": 35, "latest_version": 35, "error": None},
    )
    assert migrations.release_migrate_postgres() == 0
    assert "applied" in capsys.readouterr().out


def test_release_command_exits_nonzero_on_migration_error(monkeypatch):
    from app import migrations

    monkeypatch.setattr("app.services.pg.init_pg_pool", lambda: None)
    monkeypatch.setattr(
        migrations, "migrate_postgres",
        lambda: {"applied": [], "current_version": 26, "latest_version": 35, "error": "boom"},
    )
    assert migrations.release_migrate_postgres() == 1


def test_staging_fly_config_runs_release_command_prod_does_not():
    staging = (BACKEND / "fly.staging.toml").read_text()
    prod = (BACKEND / "fly.production.toml").read_text()
    m = re.search(r'^\s*release_command\s*=\s*"(.+)"\s*$', staging, re.M)
    assert m, "fly.staging.toml must define [deploy] release_command"
    assert "release_migrate_postgres" in m.group(1)
    assert "release_command" not in prod
