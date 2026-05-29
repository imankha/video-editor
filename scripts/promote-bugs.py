#!/usr/bin/env python3
"""Promote bugs through lifecycle stages and purge old resolved bugs.

Usage:
    python promote-bugs.py --env prod                             # testing->done + purge
    python promote-bugs.py --env staging --from new --to testing  # new->testing
    python promote-bugs.py --env prod --check                     # just count
    python promote-bugs.py --env prod --purge-only                # skip promotion, just purge
    python promote-bugs.py --from-git                             # scan commits for bug refs, promote new->testing
    python promote-bugs.py --from-git --since deploy/backend/2026-05-28  # explicit baseline
"""
import argparse
import json
import re
import ssl
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

CONFIG_PATH = Path(__file__).parent / ".task-manager-config.json"
PURGE_DAYS = 14

BUG_REF_PATTERN = re.compile(r"(?:bug\s+#?|#)(\d+)(p|s)", re.IGNORECASE)


def _make_request(url, method="GET", data=None, session="", retries=3):
    last_err = None
    for attempt in range(retries):
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
        try:
            resp = urllib.request.urlopen(req, context=ctx, timeout=15)
            return json.loads(resp.read())
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, ConnectionResetError) as e:
            last_err = str(getattr(e, "reason", e))
            if attempt < retries - 1:
                time.sleep(1)
                continue
            raise
    raise Exception(f"Failed after {retries} retries: {last_err}")


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


def _find_last_deploy_tag():
    """Find the most recent deploy tag to use as the baseline for commit scanning."""
    try:
        result = subprocess.run(
            ["git", "tag", "-l", "deploy/*", "--sort=-creatordate"],
            capture_output=True, text=True, check=True,
        )
        tags = result.stdout.strip().split("\n")
        if tags and tags[0]:
            return tags[0]
    except subprocess.CalledProcessError:
        pass
    return None


def _extract_bug_refs_from_commits(since_ref=None):
    """Parse bug references from commit messages since a given ref."""
    if since_ref:
        cmd = ["git", "log", f"{since_ref}..HEAD", "--format=%s%n%b"]
    else:
        cmd = ["git", "log", "-20", "--format=%s%n%b"]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        print(f"[bugs]     git log failed: {e}", file=sys.stderr)
        return {}

    refs = {}  # {env: set of bug_ids}
    for match in BUG_REF_PATTERN.finditer(result.stdout):
        bug_id = int(match.group(1))
        env = "prod" if match.group(2).lower() == "p" else "staging"
        refs.setdefault(env, set()).add(bug_id)

    return refs


def promote(base_url, session, from_status="testing", to_status="done",
            check_only=False, bug_ids=None):
    bugs = _make_request(
        f"{base_url}/api/admin/bugs?status={from_status}&page_size=100",
        session=session,
    ).get("bugs", [])

    if bug_ids is not None:
        bugs = [b for b in bugs if b["id"] in bug_ids]

    if check_only:
        if bugs:
            print(f"[bugs]     {len(bugs)} {from_status} bug(s) to promote")
            return True
        print(f"[bugs]     No {from_status} bugs to promote")
        return False

    if not bugs:
        print(f"[bugs]     No {from_status} bugs to promote")
        return False

    promoted = 0
    for bug in bugs:
        try:
            _make_request(
                f"{base_url}/api/admin/bugs/{bug['id']}",
                method="PATCH",
                data={"status": to_status},
                session=session,
            )
            promoted += 1
            print(f"[bugs]     Bug #{bug['id']} promoted to {to_status}")
        except Exception as e:
            print(f"[bugs]     Failed to promote bug #{bug['id']}: {e}", file=sys.stderr)

    print(f"[bugs]     {promoted} bug(s) promoted {from_status} -> {to_status}")
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


def from_git(since_ref=None):
    """Scan commits for bug references and promote new -> testing."""
    if since_ref is None:
        since_ref = _find_last_deploy_tag()
        if since_ref:
            print(f"[bugs]     Scanning commits since {since_ref}")
        else:
            print(f"[bugs]     No deploy tag found, scanning last 20 commits")

    refs = _extract_bug_refs_from_commits(since_ref)
    if not refs:
        print("[bugs]     No bug references found in commits")
        return

    for env, bug_ids in refs.items():
        print(f"[bugs]     Found {env} bug refs: {', '.join(f'#{bid}' for bid in sorted(bug_ids))}")
        base_url, session = _load_config(env)
        promote(base_url, session, from_status="new", to_status="testing", bug_ids=bug_ids)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", choices=["prod", "staging"])
    parser.add_argument("--from", dest="from_status", default="testing")
    parser.add_argument("--to", dest="to_status", default="done")
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--purge-only", action="store_true")
    parser.add_argument("--from-git", action="store_true",
                        help="Scan commits for bug refs and promote new->testing")
    parser.add_argument("--since", help="Git ref to scan from (default: last deploy tag)")
    args = parser.parse_args()

    if args.from_git:
        from_git(args.since)
        return

    if not args.env:
        parser.error("--env is required (unless using --from-git)")

    base_url, session = _load_config(args.env)

    if args.check:
        found = promote(base_url, session, args.from_status, args.to_status, check_only=True)
        sys.exit(0 if found else 1)

    if not args.purge_only:
        promote(base_url, session, args.from_status, args.to_status)

    purge(base_url, session)


if __name__ == "__main__":
    main()
