"""
T3420: Profile critical-path endpoints.

Exercises /api/health, /api/auth/me, /api/bootstrap through the full middleware
stack using TestClient (in-process, no network). Uses real session cookies to
exercise the actual validate_session / Postgres code paths.

Usage:
  cd src/backend && .venv/Scripts/python.exe ../../scripts/profile_endpoints.py

Requires: local Postgres running (Docker), .env configured.
"""
import io
import logging
import os
import sys
import time

# Ensure backend is on the path
_script_dir = os.path.dirname(os.path.abspath(__file__))
_backend_dir = os.path.join(_script_dir, "..", "src", "backend")
sys.path.insert(0, _backend_dir)
os.chdir(_backend_dir)

# Load env before any app imports
from dotenv import load_dotenv
_env_file = os.path.join(_script_dir, "..", ".env")
load_dotenv(_env_file)

# Set root logger to DEBUG so our handler sees everything.
# Must happen BEFORE importing app.main (which calls basicConfig — a no-op
# once handlers exist, so it won't override our level).
logging.root.setLevel(logging.DEBUG)

# Capture log output to extract [PROFILE ...] and [REQ_TIMING] lines
_log_buf = io.StringIO()
_log_handler = logging.StreamHandler(_log_buf)
_log_handler.setLevel(logging.DEBUG)
_log_handler.setFormatter(logging.Formatter("%(name)s - %(levelname)s - %(message)s"))
logging.root.addHandler(_log_handler)

# Also log to stderr so we see startup messages
_stderr_handler = logging.StreamHandler(sys.stderr)
_stderr_handler.setLevel(logging.WARNING)
logging.root.addHandler(_stderr_handler)

from fastapi.testclient import TestClient
from app.main import app


RUNS_PER_ENDPOINT = 3
PROFILE_TAGS = ("[PROFILE", "[REQ_TIMING]", "[SLOW")


def _drain_logs():
    """Return captured log lines matching profile tags, then reset buffer."""
    text = _log_buf.getvalue()
    _log_buf.truncate(0)
    _log_buf.seek(0)
    return [l.strip() for l in text.splitlines() if any(t in l for t in PROFILE_TAGS)]


def _run(client, label, method, path, cookies=None, headers=None):
    """Hit an endpoint RUNS_PER_ENDPOINT times, print timing + profile lines."""
    times = []
    all_profile_lines = []

    for i in range(RUNS_PER_ENDPOINT):
        _drain_logs()  # clear buffer
        t0 = time.perf_counter()
        if method == "GET":
            r = client.get(path, cookies=cookies, headers=headers)
        elif method == "POST":
            r = client.post(path, cookies=cookies, headers=headers)
        else:
            raise ValueError(f"Unknown method: {method}")
        elapsed_ms = (time.perf_counter() - t0) * 1000
        times.append(elapsed_ms)
        profile_lines = _drain_logs()
        if i == 0:
            all_profile_lines = profile_lines
            status = r.status_code

    avg = sum(times) / len(times)
    mn = min(times)
    mx = max(times)

    print(f"\n{'='*70}")
    print(f"  {label}")
    print(f"  {method} {path}  |  status={status}")
    print(f"  Timing ({RUNS_PER_ENDPOINT} runs): avg={avg:.1f}ms  min={mn:.1f}ms  max={mx:.1f}ms")
    if all_profile_lines:
        print(f"  Log lines (run 1):")
        for line in all_profile_lines:
            print(f"    {line}")
    print(f"{'='*70}")
    return r


def main():
    print("=" * 70)
    print("  T3420 Endpoint Profiler")
    print("  Exercises middleware + handler code paths in-process")
    print("=" * 70)

    with TestClient(app, raise_server_exceptions=False) as client:

        # --- Warm up (first request pays import / pool-init cost) ---
        print("\n[warm-up] hitting /api/health once...")
        client.get("/api/health")
        _drain_logs()

        # --- 1. /api/health (no session — allowlisted early-return) ---
        _run(client, "health (no session)", "GET", "/api/health")

        # --- 2. Login to get a real session cookie ---
        print("\n[setup] test-login to get session cookie...")
        r = client.post(
            "/api/auth/test-login",
            headers={"X-Test-Mode": "1"},
        )
        session_cookie = r.cookies.get("rb_session")
        if not session_cookie:
            print(f"  WARN: test-login returned {r.status_code}, no rb_session cookie.")
            print(f"  Falling back to X-User-ID header auth.")
            cookies = {}
            auth_headers = {"X-User-ID": "profile-test-user"}
        else:
            print(f"  Got session cookie: {session_cookie[:12]}...")
            cookies = {"rb_session": session_cookie}
            auth_headers = {}

        # --- 3. /api/health (with session — full middleware auth path) ---
        _run(
            client, "health (with session)", "GET", "/api/health",
            cookies=cookies, headers=auth_headers,
        )

        # --- 4. /api/auth/me ---
        _run(
            client, "auth/me", "GET", "/api/auth/me",
            cookies=cookies, headers=auth_headers,
        )

        # --- 5. Get profile_id via auth/init ---
        print("\n[setup] calling /api/auth/init to get profile_id...")
        r = client.post(
            "/api/auth/init",
            cookies=cookies, headers=auth_headers,
        )
        profile_id = None
        if r.status_code == 200:
            data = r.json()
            profile_id = data.get("profile_id") or data.get("selected_profile_id")
        if profile_id:
            print(f"  Got profile_id: {profile_id}")
        else:
            print(f"  WARN: no profile_id from auth/init (status={r.status_code})")
        _drain_logs()

        # --- 6. /api/bootstrap (with session + profile) ---
        bootstrap_headers = {**auth_headers}
        if profile_id:
            bootstrap_headers["X-Profile-ID"] = profile_id

        _run(
            client, "bootstrap", "GET", "/api/bootstrap",
            cookies=cookies, headers=bootstrap_headers,
        )

        # --- Summary ---
        print("\n" + "=" * 70)
        print("  Done. Compare these numbers before/after instrumentation changes.")
        print("  Profile log lines appear only after instrumentation is added.")
        print("=" * 70)


if __name__ == "__main__":
    main()
