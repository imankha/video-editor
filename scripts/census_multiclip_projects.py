#!/usr/bin/env python3
"""T11200: READ-ONLY census of multi-clip drafts and reels across every env.

R3 (what to do with in-progress multi-clip drafts once Reels is removed) cannot
be decided without counts, and per-user data lives in per-profile SQLite in R2 —
there is no central query. This script walks R2 DIRECTLY (so orphan / unregistered
profile objects are included), downloads each ``profile.sqlite`` + its archive
msgpack files to a temp dir, and reports:

  1. Projects with >1 latest working clip, bucketed by lifecycle
     (published / rendered-not-published / framing-only draft / archived).
  2. ``is_auto_created = 0`` projects with exactly 1 latest clip (1-clip "reels").
  3. Latest-version published ``final_videos`` with ``clip_count > 1`` OR
     ``source_type = 'custom_project'`` (multi-clip published outputs).
  4. Archived multi-clip projects living ONLY in the R2 archive JSON
     (``project_archive.py``) — profile_db migrations cannot reach these, so they
     are reported DISTINCTLY.
  5. Postgres (staging/prod only): share tokens / collection shares pointing at
     the multi-clip finals found in (3).

STRICTLY READ-ONLY. Every SQLite connection is opened ``mode=ro`` through the
single ``open_ro`` choke point; the R2 client is used ONLY for ``list_objects_v2``
and ``download_file`` — it never PUTs, uploads, or deletes; Postgres is read with
a single ``SELECT``. Modeled on ``scripts/measure_migration_floor.py`` (orphan-
inclusive R2 walk, temp-file + WAL-sidecar cleanup) and
``scripts/audit_rating_export_correlation.py`` (``load_env``, R2 download to a
tempdir, ``mode=ro`` connections).

Output: an aggregate summary + a per-user breakdown (user id, NEVER email) to
stdout, plus a JSON report ``census_multiclip_<env>_<date>.json`` (gitignored)
the operator can diff across environments.

Usage (from project root; staging/prod need THAT env's .env.<env> present):

    cd src/backend
    .venv/Scripts/python.exe ../../scripts/census_multiclip_projects.py --env dev
    .venv/Scripts/python.exe ../../scripts/census_multiclip_projects.py --env staging
    .venv/Scripts/python.exe ../../scripts/census_multiclip_projects.py --env prod

R2 uses a single shared bucket keyed by ``{prefix}/users/...`` where the prefix is
``dev``/``staging``/``production`` — note ``--env prod`` maps to ``production/``,
NOT ``prod/`` (the historical ``measure_migration_floor`` bug). A walk that finds
zero profile objects HALTS loudly rather than reporting an empty (false all-clear)
census.
"""

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import msgpack

PROJECT_ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))

# Reuse the SINGLE source of truth for "latest version per identity" rather than
# reimplementing the window-function join (queries.py:69 docstring: project_id
# MUST be in the partition — omitting it deletes one project's rows in favour of
# another's, the T1532 release-blocker). These are pure string builders with no
# app-runtime side effects.
from app.queries import (  # noqa: E402
    latest_final_videos_subquery,
    latest_working_clips_subquery,
)

# --env prod maps to the `production/` R2 prefix, NOT `prod/`. Mapping --env
# verbatim (the measure_migration_floor bug) makes `--env prod` walk an empty,
# non-existent `prod/` prefix and calmly report "no objects" — a false all-clear.
_R2_PREFIX_FOR_ENV = {"dev": "dev", "staging": "staging", "prod": "production"}

# R2 write verbs this script must NEVER call. Enumerated so the test suite can
# assert zero invocations against a mock client, and as executable documentation
# of the read-only contract.
R2_WRITE_METHODS = (
    "put_object",
    "upload_file",
    "upload_fileobj",
    "copy",
    "copy_object",
    "delete_object",
    "delete_objects",
    "create_multipart_upload",
    "upload_part",
    "complete_multipart_upload",
    "put_bucket_versioning",
)

BUCKET_KEYS = ("published", "rendered_not_published", "framing_only_draft", "archived")


# --------------------------------------------------------------------------- #
# Env + client boilerplate (mirrors audit_rating_export_correlation.load_env)
# --------------------------------------------------------------------------- #
def load_env(env_name: str) -> dict:
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found (this env's credentials are not present here)")
        sys.exit(1)
    config: dict = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
    for k in ("R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"):
        if k not in config:
            print(f"ERROR: {k} missing from {env_file}")
            sys.exit(1)
    return config


def get_r2_client(config: dict):
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=config["R2_ENDPOINT"],
        aws_access_key_id=config["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=config["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        region_name="auto",
    )


# --------------------------------------------------------------------------- #
# Read-only SQLite choke point — EVERY connection in this script goes through here
# --------------------------------------------------------------------------- #
def open_ro(db_path) -> sqlite3.Connection:
    """Open a SQLite DB strictly read-only. The single connection factory for
    this script so the ``mode=ro`` guarantee is provable by inspecting one line."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


# --------------------------------------------------------------------------- #
# Pure classification helpers (unit-tested against a seeded fixture)
# --------------------------------------------------------------------------- #
def bucket_project(row) -> str:
    """Classify a multi-clip project by lifecycle. Precedence follows the natural
    lifecycle so each project lands in exactly one bucket:

    1. archived      — ``archived_at`` set (working data lives only in R2 archive)
    2. published     — ``final_video_id`` set AND that final's ``published_at`` set
    3. rendered_not_published — a working video exists but the final isn't published
    4. framing_only_draft     — none of the above (never rendered)

    ``row`` is any mapping exposing archived_at / final_video_id / published_at /
    working_video_id (sqlite3.Row or dict)."""
    if row["archived_at"] is not None:
        return "archived"
    if row["final_video_id"] is not None and row["published_at"] is not None:
        return "published"
    if row["working_video_id"] is not None:
        return "rendered_not_published"
    return "framing_only_draft"


def count_archive_clip_identities(archive: dict) -> int:
    """Number of DISTINCT clip identities inside a project archive msgpack.

    The archive stores ALL versions of every working_clip but does NOT carry the
    raw_clips rows, so the exact ``COALESCE(rc.end_time, uploaded_filename)``
    identity key used by ``latest_working_clips_subquery`` is unavailable here.
    ``raw_clip_id`` is a faithful proxy WITHIN a project: re-framing reuses the
    same raw_clip_id across versions (collapses to one identity), and distinct
    source clips carry distinct raw_clip_ids. Uploaded clips (no raw_clip_id)
    fall back to ``uploaded_filename``. A project is "multi-clip" iff this > 1."""
    identities = set()
    for clip in archive.get("working_clips", []) or []:
        raw_clip_id = clip.get("raw_clip_id")
        if raw_clip_id is not None:
            identities.add(("rc", raw_clip_id))
        else:
            identities.add(("file", clip.get("uploaded_filename")))
    return len(identities)


# --------------------------------------------------------------------------- #
# Per-profile census over an open read-only connection
# --------------------------------------------------------------------------- #
def census_profile_db(conn: sqlite3.Connection) -> dict:
    """Run buckets 1-3 against one open read-only profile.sqlite connection.

    Returns lists of ids (not counts) so the caller can attribute them per user."""
    latest_wc = latest_working_clips_subquery(project_filter=False)
    latest_fv = latest_final_videos_subquery()

    result = {
        "multiclip_projects": {k: [] for k in BUCKET_KEYS},  # bucket 1
        "single_clip_manual_reels": [],  # bucket 2
        "published_multiclip_finals": [],  # bucket 3
    }

    # Bucket 1: projects with >1 latest working clip.
    rows = conn.execute(
        f"""
        SELECT p.id AS id, COUNT(*) AS n, p.is_auto_created AS is_auto_created,
               p.working_video_id AS working_video_id, p.final_video_id AS final_video_id,
               fv.published_at AS published_at, p.archived_at AS archived_at
        FROM projects p
        JOIN working_clips wc ON wc.project_id = p.id
        LEFT JOIN final_videos fv ON fv.id = p.final_video_id
        WHERE wc.id IN ({latest_wc})
        GROUP BY p.id
        HAVING n > 1
        """
    ).fetchall()
    for r in rows:
        result["multiclip_projects"][bucket_project(r)].append(r["id"])

    # Bucket 2: is_auto_created = 0 projects with exactly 1 latest clip.
    rows = conn.execute(
        f"""
        SELECT p.id AS id
        FROM projects p
        JOIN working_clips wc ON wc.project_id = p.id
        WHERE p.is_auto_created = 0 AND wc.id IN ({latest_wc})
        GROUP BY p.id
        HAVING COUNT(*) = 1
        """
    ).fetchall()
    result["single_clip_manual_reels"] = [r["id"] for r in rows]

    # Bucket 3: latest-version published finals that are multi-clip.
    rows = conn.execute(
        f"""
        SELECT fv.id AS id
        FROM final_videos fv
        WHERE fv.id IN ({latest_fv})
          AND fv.published_at IS NOT NULL
          AND (fv.clip_count > 1 OR fv.source_type = 'custom_project')
        """
    ).fetchall()
    result["published_multiclip_finals"] = [r["id"] for r in rows]

    return result


# --------------------------------------------------------------------------- #
# R2 walk (orphan-inclusive, like measure_migration_floor)
# --------------------------------------------------------------------------- #
def collect_profile_objects(client, bucket: str, prefix: str) -> dict:
    """Walk R2 directly, grouping every object under ``{prefix}/users/`` by its
    owning profile. Returns ``{(user_id, profile_id): {"profile_key": str|None,
    "archive_keys": [str, ...]}}``. Listing R2 (not the profile registry) means
    ORPHAN / unregistered profiles are included by construction."""
    profiles: dict = defaultdict(lambda: {"profile_key": None, "archive_keys": []})
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            parts = key.split("/")
            if "profiles" not in parts or "users" not in parts:
                continue
            try:
                user_id = parts[parts.index("users") + 1]
                profile_id = parts[parts.index("profiles") + 1]
            except (ValueError, IndexError):
                continue
            entry = profiles[(user_id, profile_id)]
            if key.endswith("/profile.sqlite"):
                entry["profile_key"] = key
            elif "/archive/" in key and key.endswith(".msgpack"):
                entry["archive_keys"].append(key)
    return dict(profiles)


def _download(client, bucket: str, key: str, dest: str) -> None:
    client.download_file(bucket, key, dest)


def _cleanup_tmp(tmp: str) -> None:
    """Delete a temp file and any WAL/SHM sidecars a WAL-mode object left behind
    (local hygiene only; never touches R2 or any real DB)."""
    for suffix in ("", "-wal", "-shm"):
        p = tmp + suffix
        if os.path.exists(p):
            os.unlink(p)


# --------------------------------------------------------------------------- #
# Postgres bucket 5 (staging/prod only)
# --------------------------------------------------------------------------- #
def census_postgres(config: dict, multiclip_finals: list) -> dict:
    """Bucket 5: Postgres shares pointing at the multi-clip finals from bucket 3.

    ``multiclip_finals`` is a list of ``(user_id, profile_id, final_video_id)``.
    ``share_videos.video_id`` is a per-profile final_videos id, so a match is only
    meaningful when scoped to the SAME sharer (user_id, profile_id) — a bare
    ``video_id`` equality would cross-match unrelated profiles (ids are per-profile
    AUTOINCREMENTs). Collection shares store a live, scope-based definition (not a
    frozen id list; see collections._evaluated_share_members), so exact membership
    cannot be resolved statically — we report the count of active collection shares
    owned by the affected sharer profiles as an ADVISORY upper bound, clearly
    labelled."""
    result = {
        "video_shares": [],  # exact: (user_id, profile_id, final_video_id, share_token)
        "collection_shares_advisory": 0,
        "error": None,
    }
    url = config.get("DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not url:
        result["error"] = "DATABASE_URL not set — cannot read Postgres shares"
        return result
    if not multiclip_finals:
        return result

    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as e:  # pragma: no cover
        result["error"] = f"psycopg2 unavailable: {e}"
        return result

    affected_profiles = sorted({(u, p) for (u, p, _fv) in multiclip_finals})
    conn = psycopg2.connect(url)
    try:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        # Exact video-share matches, scoped per sharer profile.
        for (user_id, profile_id, fv_id) in multiclip_finals:
            cur.execute(
                """
                SELECT s.share_token
                FROM shares s
                JOIN share_videos sv ON sv.share_id = s.id
                WHERE s.share_type = 'video'
                  AND s.revoked_at IS NULL
                  AND s.sharer_user_id = %s
                  AND s.sharer_profile_id = %s
                  AND sv.video_id = %s
                """,
                (user_id, profile_id, fv_id),
            )
            for row in cur.fetchall():
                result["video_shares"].append(
                    {
                        "user_id": user_id,
                        "profile_id": profile_id,
                        "final_video_id": fv_id,
                        "share_token": row["share_token"],
                    }
                )
        # Advisory: active collection shares owned by any affected sharer profile.
        advisory = 0
        for (user_id, profile_id) in affected_profiles:
            cur.execute(
                """
                SELECT COUNT(*) AS n
                FROM shares
                WHERE share_type = 'collection'
                  AND revoked_at IS NULL
                  AND sharer_user_id = %s
                  AND sharer_profile_id = %s
                """,
                (user_id, profile_id),
            )
            advisory += cur.fetchone()["n"]
        result["collection_shares_advisory"] = advisory
    finally:
        conn.close()
    return result


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def run_census(env: str, config: dict, client) -> dict:
    bucket = config["R2_BUCKET"]
    prefix = f"{_R2_PREFIX_FOR_ENV[env]}/users/"

    profiles = collect_profile_objects(client, bucket, prefix)
    profile_dirs = {k: v for k, v in profiles.items() if v["profile_key"]}
    if not profile_dirs:
        raise SystemExit(
            f"[{env}] ANOMALY: walked prefix '{prefix}' and found ZERO profile.sqlite "
            "objects. This is NOT an empty census — the prefix/bucket/credentials are "
            "wrong for this env (e.g. the prod vs production/ bug). Refusing to report."
        )

    # Per-user accumulators.
    per_user: dict = defaultdict(
        lambda: {f"b1_{k}": 0 for k in BUCKET_KEYS}
        | {
            "b2_single_clip_manual_reels": 0,
            "b3_published_multiclip_finals": 0,
            "b4_archived_multiclip_projects": 0,
        }
    )
    multiclip_finals: list = []  # (user_id, profile_id, final_video_id) for bucket 5
    errored_profiles: list = []
    profiles_read = 0
    archives_scanned = 0

    for (user_id, profile_id), entry in profile_dirs.items():
        tmp = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as f:
                tmp = f.name
            _download(client, bucket, entry["profile_key"], tmp)
            conn = open_ro(tmp)
            try:
                census = census_profile_db(conn)
            finally:
                conn.close()
            profiles_read += 1
        except Exception as e:  # noqa: BLE001 — a bad profile is reported, not fatal
            errored_profiles.append({"user_id": user_id, "profile_id": profile_id,
                                     "error": f"{type(e).__name__}: {e}"})
            print(f"  !! could not census {entry['profile_key']}: {type(e).__name__}: {e}")
            continue
        finally:
            if tmp:
                _cleanup_tmp(tmp)

        u = per_user[user_id]
        for k in BUCKET_KEYS:
            u[f"b1_{k}"] += len(census["multiclip_projects"][k])
        u["b2_single_clip_manual_reels"] += len(census["single_clip_manual_reels"])
        u["b3_published_multiclip_finals"] += len(census["published_multiclip_finals"])
        for fv_id in census["published_multiclip_finals"]:
            multiclip_finals.append((user_id, profile_id, fv_id))

        # Bucket 4: archived multi-clip projects living only in R2 archive JSON.
        for arch_key in entry["archive_keys"]:
            atmp = None
            try:
                with tempfile.NamedTemporaryFile(suffix=".msgpack", delete=False) as f:
                    atmp = f.name
                _download(client, bucket, arch_key, atmp)
                with open(atmp, "rb") as fh:
                    archive = msgpack.unpackb(fh.read(), raw=False)
                archives_scanned += 1
                if count_archive_clip_identities(archive) > 1:
                    u["b4_archived_multiclip_projects"] += 1
            except Exception as e:  # noqa: BLE001
                print(f"  !! could not read archive {arch_key}: {type(e).__name__}: {e}")
            finally:
                if atmp:
                    _cleanup_tmp(atmp)

    # Bucket 5: Postgres (staging/prod only).
    postgres = None
    if env == "dev":
        print("[dev] Skipping Postgres share census (bucket 5) — staging/prod only.")
    else:
        postgres = census_postgres(config, multiclip_finals)

    return {
        "env": env,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "profiles_found": len(profile_dirs),
        "profiles_read": profiles_read,
        "profiles_errored": errored_profiles,
        "archives_scanned": archives_scanned,
        "per_user": dict(per_user),
        "postgres": postgres,
    }


def _aggregate(per_user: dict) -> dict:
    totals: dict = defaultdict(int)
    users_with: dict = defaultdict(int)
    for counts in per_user.values():
        for k, v in counts.items():
            totals[k] += v
            if v:
                users_with[k] += 1
    return {"totals": dict(totals), "users_affected": dict(users_with)}


def print_summary(report: dict) -> None:
    env = report["env"]
    agg = _aggregate(report["per_user"])
    totals, affected = agg["totals"], agg["users_affected"]
    print()
    print(f"=== Multi-clip census ({env}) ===")
    print(f"  profiles found:   {report['profiles_found']}")
    print(f"  profiles read:    {report['profiles_read']}")
    print(f"  profiles errored: {len(report['profiles_errored'])}")
    print(f"  archives scanned: {report['archives_scanned']}")
    print()
    print("--- Aggregate counts (count / users affected) ---")
    labels = [
        ("b1_published", "1. multi-clip project: published"),
        ("b1_rendered_not_published", "1. multi-clip project: rendered, not published"),
        ("b1_framing_only_draft", "1. multi-clip project: framing-only draft"),
        ("b1_archived", "1. multi-clip project: archived (archived_at set)"),
        ("b2_single_clip_manual_reels", "2. is_auto_created=0 single-clip reels"),
        ("b3_published_multiclip_finals", "3. published multi-clip finals"),
        ("b4_archived_multiclip_projects", "4. archived multi-clip (R2 archive JSON only)"),
    ]
    for key, label in labels:
        print(f"  {label:<52} {totals.get(key, 0):>6}  ({affected.get(key, 0)} users)")

    pg = report.get("postgres")
    print()
    if pg is None:
        print("  5. Postgres shares: skipped (dev)")
    elif pg.get("error"):
        print(f"  5. Postgres shares: ERROR — {pg['error']}")
    else:
        print(f"  5. Postgres video shares -> multi-clip finals: {len(pg['video_shares'])}")
        print(f"     collection shares by affected profiles (advisory): "
              f"{pg['collection_shares_advisory']}")

    if report["profiles_errored"]:
        print()
        print(f"  WARNING: {len(report['profiles_errored'])} profile(s) unreadable — "
              "their rows are absent from every bucket above (possible undercount).")


def main() -> None:
    ap = argparse.ArgumentParser(description="T11200 read-only multi-clip census")
    ap.add_argument("--env", required=True, choices=["dev", "staging", "prod"],
                    help="environment whose R2 prefix / DATABASE_URL to census")
    ap.add_argument("--out-dir", default=str(PROJECT_ROOT),
                    help="directory for the JSON report (default: repo root)")
    args = ap.parse_args()

    config = load_env(args.env)
    print(f"Environment: {args.env} (R2 prefix={_R2_PREFIX_FOR_ENV[args.env]}/, "
          f"bucket={config['R2_BUCKET']})")
    client = get_r2_client(config)

    report = run_census(args.env, config, client)
    print_summary(report)

    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out_path = Path(args.out_dir) / f"census_multiclip_{args.env}_{date}.json"
    with open(out_path, "w") as fh:
        json.dump(report, fh, indent=2, sort_keys=True)
    print()
    print(f"JSON report written: {out_path}")


if __name__ == "__main__":
    main()
