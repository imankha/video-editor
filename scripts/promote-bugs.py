#!/usr/bin/env python3
"""Promote 'testing' bugs to 'done' and purge old resolved bugs.

Usage:
    python promote-bugs.py --env prod              # promote + purge (default 14 days)
    python promote-bugs.py --env prod --check      # just count, don't change anything
    python promote-bugs.py --env prod --purge-only  # skip promotion, just purge
"""
import argparse
import json
import ssl
import sys
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / ".task-manager-config.json"
PURGE_DAYS = 14


def _make_request(url, method="GET", data=None, session=""):
    req = urllib.request.Request(url, method=method)
    if session:
        if len(session) == 36 and session.count("-") == 4:
            req.add_header("X-User-ID", session)
        else:
            req.add_header("Cookie", f"rb_session={session}")
    if data is not None:
        req.data = json.dumps(data).encode()
        req.add_header("Content-Type", "application/json")
    ctx = ssl.create_default_context()
    resp = urllib.request.urlopen(req, context=ctx, timeout=15)
    return json.loads(resp.read())


def _load_config(env):
    if not CONFIG_PATH.exists():
        print(f"[bugs]     Config not found: {CONFIG_PATH}", file=sys.stderr)
        sys.exit(0)

    config = json.loads(CONFIG_PATH.read_text())
    base_url = config.get(f"{env}_url", "")
    session = config.get(f"{env}_session", "")
    if not base_url or not session:
        print(f"[bugs]     No {env} session configured, skipping")
        sys.exit(0)
    return base_url, session


def promote(base_url, session, check_only=False):
    bugs = _make_request(
        f"{base_url}/api/admin/bugs?status=testing&page_size=100",
        session=session,
    ).get("bugs", [])

    if check_only:
        if bugs:
            print(f"[bugs]     {len(bugs)} testing bug(s) to promote")
            return True
        print("[bugs]     No testing bugs to promote")
        return False

    if not bugs:
        print("[bugs]     No testing bugs to promote")
        return False

    promoted = 0
    for bug in bugs:
        try:
            _make_request(
                f"{base_url}/api/admin/bugs/{bug['id']}",
                method="PATCH",
                data={"status": "done"},
                session=session,
            )
            promoted += 1
            print(f"[bugs]     Bug #{bug['id']} promoted to done")
        except Exception as e:
            print(f"[bugs]     Failed to promote bug #{bug['id']}: {e}", file=sys.stderr)

    print(f"[bugs]     {promoted} bug(s) promoted to done")
    return True


def purge(base_url, session, days=PURGE_DAYS):
    try:
        result = _make_request(
            f"{base_url}/api/admin/bugs/purge?days={days}",
            method="DELETE",
            session=session,
        )
        count = result.get("purged", 0)
        if count:
            print(f"[bugs]     Purged {count} resolved bug(s) older than {days} days")
        else:
            print(f"[bugs]     No resolved bugs older than {days} days to purge")
    except Exception as e:
        print(f"[bugs]     Purge failed: {e}", file=sys.stderr)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True, choices=["prod", "staging"])
    parser.add_argument("--check", action="store_true", help="Just print count, exit 0 if any found")
    parser.add_argument("--purge-only", action="store_true", help="Skip promotion, just purge old done bugs")
    args = parser.parse_args()

    base_url, session = _load_config(args.env)

    if args.check:
        found = promote(base_url, session, check_only=True)
        sys.exit(0 if found else 1)

    if not args.purge_only:
        promote(base_url, session)

    purge(base_url, session)


if __name__ == "__main__":
    main()
