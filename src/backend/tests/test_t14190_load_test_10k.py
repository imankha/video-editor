"""T14190 -- 10K readiness load test tooling (scripts/load_test_10k.py).

The staging run itself is an operator action; these tests pin the parts that decide
its verdict and its blast radius:

  - the pass criteria (`/api/health` p95 < 200 ms, no authenticated request > 1 s,
    no failed request) are evaluated from raw latencies, not eyeballed;
  - seeding writes only synthetic users (email suffix `@loadtest.invalid`), is
    idempotent, and refuses prod;
  - cleanup (scripts/delete_user.py --email-suffix) selects ONLY the synthetic
    users, never a real account.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import psycopg2
import pytest
from psycopg2.extras import RealDictCursor

REPO_ROOT = Path(__file__).resolve().parents[3]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name, REPO_ROOT / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def lt():
    return _load("load_test_10k")


@pytest.fixture
def raw_pg_conn(pg_conn, lt):
    conn = psycopg2.connect(pg_conn, cursor_factory=RealDictCursor)
    _cleanup(conn, lt)
    yield conn
    conn.rollback()
    _cleanup(conn, lt)
    conn.close()


def _cleanup(conn, lt):
    cur = conn.cursor()
    cur.execute("DELETE FROM users WHERE email LIKE %s", ("%" + lt.SYNTHETIC_EMAIL_SUFFIX,))
    cur.execute("DELETE FROM users WHERE user_id = 't14190_real'")
    conn.commit()


# --- pass criteria ---------------------------------------------------------

def test_percentile_nearest_rank(lt):
    values = list(range(1, 101))  # 1..100 ms
    assert lt.percentile(values, 95) == 95
    assert lt.percentile(values, 50) == 50
    assert lt.percentile([7.0], 95) == 7.0


def test_evaluate_passes_a_healthy_run(lt):
    failures = lt.evaluate(health_ms=[20.0] * 99 + [150.0], auth_ms=[300.0, 999.0], errors=0)
    assert failures == []


def test_evaluate_names_each_breached_criterion(lt):
    failures = lt.evaluate(
        health_ms=[250.0] * 100, auth_ms=[100.0, 1500.0], errors=3,
    )
    joined = "\n".join(failures)
    assert len(failures) == 3, failures
    assert "health p95" in joined and "250" in joined
    assert "1500" in joined
    assert "3 failed" in joined


def test_evaluate_refuses_an_empty_measurement(lt):
    # A run that recorded nothing must not read as a pass.
    failures = lt.evaluate(health_ms=[], auth_ms=[], errors=0)
    assert failures and "no /api/health samples" in failures[0]


# --- seeding ---------------------------------------------------------------

def test_seed_refuses_prod(lt):
    with pytest.raises(SystemExit):
        lt.require_non_prod("prod")
    lt.require_non_prod("staging")


def test_seed_users_is_synthetic_and_idempotent(lt, raw_pg_conn):
    assert lt.seed_users(raw_pg_conn, 25) == 25
    assert lt.seed_users(raw_pg_conn, 30) == 5  # only the 5 new ones
    cur = raw_pg_conn.cursor()
    cur.execute("SELECT email FROM users WHERE email LIKE %s", ("%" + lt.SYNTHETIC_EMAIL_SUFFIX,))
    emails = {r["email"] for r in cur.fetchall()}
    assert emails == {lt.synthetic_email(i) for i in range(30)}
    assert len(lt.synthetic_user_ids(raw_pg_conn, 10)) == 10


# --- cleanup ---------------------------------------------------------------

def test_cleanup_selects_only_synthetic_users(lt, raw_pg_conn):
    du = _load("delete_user")
    lt.seed_users(raw_pg_conn, 3)
    cur = raw_pg_conn.cursor()
    # A real account whose email merely CONTAINS the marker must never be selected.
    cur.execute(
        "INSERT INTO users (user_id, email) VALUES ('t14190_real', %s)",
        ("loadtest.invalid.fan@example.com",),
    )
    raw_pg_conn.commit()
    rows = du.select_targets(cur, email_suffix=lt.SYNTHETIC_EMAIL_SUFFIX)
    assert sorted(r["email"] for r in rows) == sorted(lt.synthetic_email(i) for i in range(3))


def test_cleanup_suffix_wildcards_are_literal(lt, raw_pg_conn):
    du = _load("delete_user")
    cur = raw_pg_conn.cursor()
    cur.execute("INSERT INTO users (user_id, email) VALUES ('t14190_real', 'a@x.com')")
    raw_pg_conn.commit()
    # '%' / '_' in the suffix are matched literally, so they cannot widen the target set.
    assert du.select_targets(cur, email_suffix="%") == []
    assert du.select_targets(cur, email_suffix="_.com") == []
