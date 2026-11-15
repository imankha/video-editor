"""T16500:C2 check: the server starts and the whole backend suite passes.

Not a pytest file (no test_ prefix); run from src/backend:

    python3 tests/t16500_backend_suite_check.py

1. Starts the real server (uvicorn app.main:app) on a free port and waits for
   GET /api/version to answer 200, then stops it.
2. Runs every tests/test_*.py file, the same file list Branch CI's backend
   shards run, split with scripts/split_pytest.py into SHARDS parallel pytest
   processes. CI gives each shard its own runner; here each shard gets its own
   detached git worktree of HEAD (app.database.USER_DATA_BASE is derived from
   the checkout path, so shards sharing one checkout block on each other's
   per-user SQLite files) and its own throwaway Postgres database (so the
   pg_conn cleanup of one shard cannot delete another shard's rows). Worktrees
   and databases are removed afterwards.

Exit 0 only if the server answered and every shard passed. Shard logs:
/tmp/t16500-shard-<i>.log.
"""

import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import psycopg2

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]
SHARDS = 5

sys.path.insert(0, str(REPO / "scripts"))
from split_pytest import split  # noqa: E402


def server_starts():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
        cwd=BACKEND, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            if server.poll() is not None:
                print(f"server exited with {server.returncode} before answering")
                return False
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/version", timeout=5) as r:
                    print(f"server started: GET /api/version -> {r.status}")
                    return r.status == 200
            except OSError:
                time.sleep(1)
        print("server did not answer GET /api/version within 180s")
        return False
    finally:
        server.terminate()
        server.wait(timeout=30)


def _admin(dsn):
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn


def backend_suite_passes():
    dsn = os.environ["DATABASE_URL"]
    parts = urlsplit(dsn)
    files = sorted(str(p.relative_to(BACKEND)) for p in (BACKEND / "tests").glob("test_*.py"))
    durations = json.loads((BACKEND / "tests/.test_durations.json").read_text())
    shards = split(files, durations, SHARDS)
    names = [f"t16500_suite_shard_{i}" for i in range(1, SHARDS + 1)]
    trees = [Path(f"/tmp/t16500-suite-shard-{i}") for i in range(1, SHARDS + 1)]
    admin = _admin(dsn)
    try:
        for tree in trees:
            subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=REPO, capture_output=True)
            subprocess.run(["git", "worktree", "add", "--detach", str(tree), "HEAD"], cwd=REPO, check=True, capture_output=True)
            if (REPO / ".env").exists():
                (tree / ".env").write_text((REPO / ".env").read_text())
        with admin.cursor() as cur:
            for name in names:
                cur.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
                cur.execute(f"CREATE DATABASE {name}")
        procs = []
        for i, (name, tree, shard) in enumerate(zip(names, trees, shards), start=1):
            env = dict(os.environ, DATABASE_URL=urlunsplit(parts._replace(path=f"/{name}")))
            log = open(f"/tmp/t16500-shard-{i}.log", "w")  # noqa: SIM115 -- closed after the shard exits
            procs.append((i, shard, log, subprocess.Popen(
                [sys.executable, "-m", "pytest", *shard, "-q", "-p", "no:cacheprovider",
                 "--tb=short", "--capture=sys", "-rfE"],
                cwd=tree / "src/backend", env=env, stdout=log, stderr=subprocess.STDOUT,
            )))
        ok = True
        for i, shard, log, proc in procs:
            proc.wait()
            log.close()
            summary = Path(log.name).read_text().strip().splitlines()[-1:]
            print(f"shard {i}/{SHARDS} ({len(shard)} files): exit {proc.returncode} {summary}")
            ok = ok and proc.returncode == 0
        print(f"backend suite: {len(files)} files in {SHARDS} shards, {'passed' if ok else 'FAILED'}")
        return ok
    finally:
        for tree in trees:
            subprocess.run(["git", "worktree", "remove", "--force", str(tree)], cwd=REPO, capture_output=True)
        with admin.cursor() as cur:
            for name in names:
                cur.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        admin.close()


if __name__ == "__main__":
    started = server_starts()
    passed = backend_suite_passes()
    sys.exit(0 if started and passed else 1)
