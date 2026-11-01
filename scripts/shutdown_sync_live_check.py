#!/usr/bin/env python3
"""T14280: drive the deploy-shutdown sync with a real SIGTERM against a live backend.

Starts uvicorn with SHUTDOWN_SYNC_IN_DEV=1 (registers the production SIGTERM handler in
dev), writes to one local DB OUTSIDE any request (raw sqlite3, the way a webhook or worker
does), sends SIGTERM, then reports which DBs the handler uploaded and whether that DB's
R2 version moved. Real uvicorn, real signal, real R2 CAS, real deadline.

Needs R2_ENABLED=true and a reachable DATABASE_URL (the app's own .env). POSIX only:
on Windows, SIGTERM is TerminateProcess and no handler runs (use WSL or a container).

Usage (from src/backend):
    python ../../scripts/shutdown_sync_live_check.py --user <user_id> --profile <profile_id>
    python ../../scripts/shutdown_sync_live_check.py --user <user_id>     # user.sqlite

Exit 0 only when the DB's R2 version moved, the handler logged it as synced, and no
CRITICAL was logged.
"""
import argparse
import os
import re
import signal
import socket
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "src" / "backend"
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv

load_dotenv(BACKEND.parent.parent / ".env")

from app.database import USER_DATA_BASE, USER_DB_SCOPE
from app.storage import R2_ENABLED, get_db_version_from_r2, get_user_db_version_from_r2

KILL_TIMEOUT_S = 30  # fly.toml kill_timeout
SYNCED_RE = re.compile(r"\[Shutdown\] Synced user=(\S+) scope=(\S+) to R2 v(\d+)")


def r2_version(user_id, scope):
    if scope == USER_DB_SCOPE:
        return get_user_db_version_from_r2(user_id)
    return get_db_version_from_r2(user_id, profile_id=scope)


def write_outside_request(db_file):
    """A committed schema change that leaves no content behind (create + drop)."""
    conn = sqlite3.connect(str(db_file))
    try:
        conn.execute("CREATE TABLE _t14280_live_check (x INTEGER)")
        conn.execute("DROP TABLE _t14280_live_check")
        conn.commit()
    finally:
        conn.close()


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for(log_path, needle, proc, timeout):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if needle in log_path.read_text(errors="replace"):
            return True
        if proc.poll() is not None:
            return False
        time.sleep(0.25)
    return False


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--user", required=True)
    ap.add_argument("--profile", help="profile id; omit to check the user's user.sqlite")
    ap.add_argument("--log", default="/tmp/shutdown_sync_live_check.log")
    args = ap.parse_args()

    if os.name != "posix":
        sys.exit("POSIX only: Windows cannot deliver SIGTERM to a Python handler")
    if not R2_ENABLED:
        sys.exit("R2_ENABLED is not true: nothing to check")
    scope = args.profile or USER_DB_SCOPE
    db_file = (USER_DATA_BASE / args.user / "profiles" / scope / "profile.sqlite" if args.profile
               else USER_DATA_BASE / args.user / "user.sqlite")
    if not db_file.exists():
        sys.exit(f"No local DB at {db_file}: log in as that user once so it is restored")

    before = r2_version(args.user, scope)
    if not isinstance(before, int):
        sys.exit(f"Cannot read the R2 version before the signal: {before}")

    log_path = Path(args.log)
    port = free_port()
    env = dict(os.environ, SHUTDOWN_SYNC_IN_DEV="1")
    with log_path.open("w") as log:
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--port", str(port)],
            cwd=BACKEND, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        if not wait_for(log_path, "SIGTERM handler registered", proc, 60) or \
                not wait_for(log_path, "Application startup complete", proc, 60):
            sys.exit(f"Backend did not start with the SIGTERM handler registered; see {log_path}")

        write_outside_request(db_file)
        print(f"Wrote {db_file} outside a request; R2 v{before} before the signal")

        sent = time.monotonic()
        proc.send_signal(signal.SIGTERM)
        proc.wait(timeout=KILL_TIMEOUT_S)
        elapsed = time.monotonic() - sent
    except subprocess.TimeoutExpired:
        proc.kill()
        sys.exit(f"Backend still running {KILL_TIMEOUT_S}s after SIGTERM (Fly would SIGKILL it); see {log_path}")
    finally:
        if proc.poll() is None:
            proc.kill()

    text = log_path.read_text(errors="replace")
    synced = SYNCED_RE.findall(text)
    critical = [line for line in text.splitlines() if "CRITICAL" in line]
    after = r2_version(args.user, scope)

    print(f"Backend exited {proc.returncode} {elapsed:.1f}s after SIGTERM")
    print(f"Uploaded {len(synced)} DB(s):")
    for user_id, db_scope, version in synced:
        print(f"  user={user_id} scope={db_scope} -> R2 v{version}")
    for line in critical:
        print(f"CRITICAL: {line}")
    print(f"Target user={args.user} scope={scope}: R2 v{before} -> v{after}")

    target_synced = any(u == args.user and s == scope for u, s, _ in synced)
    ok = isinstance(after, int) and after > before and target_synced and not critical
    print("PASS" if ok else f"FAIL (full log: {log_path})")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
