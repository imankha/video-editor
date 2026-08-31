"""
T7880: admin-run sweep for stranded prod uploads belonging to users who never return.

T7490's honest reap (games_upload.list_pending_uploads) only fires when the AFFECTED
USER loads their own Games tab. A user who never returns is never reconciled: their
`pending_uploads` row (or, if it was silently deleted by the pre-T7490 code, no row at
all) and any open R2 multipart sit forever, and any matching `games` row stays
'pending'-invisible indefinitely.

This script is the same honest-reap TRANSITION T7490 already performs (abort the R2
multipart(s), flip the game to 'upload_failed', delete the stale pending_uploads row),
applied proactively across EVERY profile in an environment instead of waiting for a
Games-tab load — read-only by default, real writes gated behind --apply.

Widens scan_orphaned_pending_uploads.py's original target set (which only saw pending
games with NO pending_uploads row) to also catch the two-stranded-account shape found in
the 2026-08-27 drop-off refresh: a game WITH a pending_uploads row whose upload never
finished. T8160 NOTE: a stored r2_upload_id can NEVER be matched against listed ids —
R2 returns per-call UploadId aliases, so "stored id not among open ids" is true for
every upload, live or dead (that false shape was previously reported here as the
"double-UploadId anomaly"; root cause found + fixed in T8160). Liveness is judged by
open-multipart AGE only.

Two phases, matching the data-safety rule (dry-run report -> user sign-off -> apply):

  1. ENUMERATE (this script, runs LOCALLY, read-only): downloads every profile.sqlite +
     auth.sqlite from R2 (same pattern as audit_clip_dimensions.py) and cross-references
     against a full R2 listing of every open multipart under "games/". Produces a report
     AND a JSON manifest (--manifest-out) naming exactly which (user_id, profile_id,
     game_id, blake3_hash, upload_ids_to_abort, has_pending_uploads_row) need reaping.
  2. APPLY (a separate live-machine step, scripts/apply_stranded_uploads_sweep.py, run
     via `fly ssh console -a reel-ballers-api -C "python3 -"` with the manifest piped
     in): reads the manifest and performs the actual writes through the app's own
     connection-opening path (ContextVars + get_db_connection + sync_db_to_r2_explicit),
     never by editing a downloaded copy and blind-pushing it — this script's local
     profile.sqlite copies are for READING ONLY, never re-uploaded.

Usage:
    cd src/backend && .venv/Scripts/python.exe ../../scripts/scan_stranded_uploads_sweep.py --env prod
    cd src/backend && .venv/Scripts/python.exe ../../scripts/scan_stranded_uploads_sweep.py --env prod --hours 24 --manifest-out /tmp/t7880_manifest.json
"""

import argparse
import json
import sqlite3
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent


def load_env(env_name: str) -> dict:
    env_file = PROJECT_ROOT / (".env" if env_name == "dev" else f".env.{env_name}")
    if not env_file.exists():
        print(f"ERROR: {env_file} not found")
        sys.exit(1)
    config = {}
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
    config.setdefault("APP_ENV", env_name)
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


def download_remote_dbs(r2_client, bucket: str, app_env: str, dest: Path):
    """Download auth.sqlite + all profile.sqlite from R2.

    Returns (auth_db_path, [(user_id, profile_id, profile_db_path), ...]).
    """
    auth_local = dest / "auth.sqlite"
    auth_local.parent.mkdir(parents=True, exist_ok=True)
    r2_client.download_file(bucket, f"{app_env}/auth/auth.sqlite", str(auth_local))

    profiles: list[tuple[str, str, Path]] = []
    paginator = r2_client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=f"{app_env}/users/"):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            if not key.endswith("profile.sqlite"):
                continue
            # key = {app_env}/users/{uid}/profiles/{pid}/profile.sqlite
            parts = key.split("/")
            if len(parts) < 6:
                continue
            user_id, profile_id = parts[2], parts[4]
            local = dest / "/".join(parts[2:])
            local.parent.mkdir(parents=True, exist_ok=True)
            r2_client.download_file(bucket, key, str(local))
            profiles.append((user_id, profile_id, local))
    return auth_local, profiles


def list_open_multiparts_under_games(r2_client, bucket: str) -> dict[str, list[dict]]:
    """All open multiparts under 'games/', grouped by key -> [{'UploadId', 'Initiated'}]."""
    by_key: dict[str, list[dict]] = {}
    paginator = r2_client.get_paginator("list_multipart_uploads")
    for page in paginator.paginate(Bucket=bucket, Prefix="games/"):
        for u in page.get("Uploads", []) or []:
            by_key.setdefault(u["Key"], []).append({
                "UploadId": u["UploadId"],
                "Initiated": u.get("Initiated").isoformat() if u.get("Initiated") else None,
            })
    return by_key


def email_for_user(auth_db: Path, user_id: str) -> str | None:
    conn = sqlite3.connect(f"file:{auth_db}?mode=ro", uri=True)
    try:
        row = conn.execute("SELECT email FROM users WHERE user_id = ?", (user_id,)).fetchone()
        return row[0] if row else None
    finally:
        conn.close()


# T8160: R2's ListMultipartUploads returns a DIFFERENT UploadId string on every
# call, so `stored_id in open_ids` is ALWAYS false against R2 — id membership can
# never detect liveness or the "double-UploadId" shape (the pre-T8160 logic
# classified every genuinely-live upload as "double_uploadid_anomaly", and its
# upload_ids_to_abort would have killed it). Liveness is therefore judged by the
# open multiparts' AGE: anything initiated within the recency window may be an
# active upload and is report-only; only provably old multiparts are abort
# candidates.
LIVE_RECENCY_HOURS = 6


def _initiated_recent(u: dict) -> bool:
    iso = u.get("Initiated")
    if not iso:
        return True  # unprovable age: treat as possibly live, never abort
    try:
        ts = datetime.fromisoformat(iso)
    except ValueError:
        return True
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - ts) < timedelta(hours=LIVE_RECENCY_HOURS)


def scan_profile(db_path: Path, cutoff_iso: str, multiparts_by_key: dict) -> list[dict]:
    """One profile's stranded-upload findings. Each finding names exactly what a
    reap needs to do: which game_id to flip, which pending_uploads row (if any) to
    delete, and which R2 UploadId(s) to abort."""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    findings = []

    # Pending games, regardless of whether a pending_uploads row still exists.
    pending_games = cur.execute(
        "SELECT id, name, blake3_hash, created_at FROM games "
        "WHERE status = 'pending' AND created_at < ? ORDER BY created_at",
        (cutoff_iso,),
    ).fetchall()

    pending_uploads_by_hash = {
        r["blake3_hash"]: r for r in cur.execute(
            "SELECT id, blake3_hash, r2_upload_id, created_at FROM pending_uploads"
        ).fetchall()
    }

    for g in pending_games:
        r2_key = f"games/{g['blake3_hash']}.mp4" if g["blake3_hash"] else None
        open_uploads = multiparts_by_key.get(r2_key, []) if r2_key else []
        open_ids = {u["UploadId"] for u in open_uploads}

        pu = pending_uploads_by_hash.get(g["blake3_hash"])
        stored_id = pu["r2_upload_id"] if pu else None

        finding = {
            "game_id": g["id"],
            "game_name": g["name"],
            "blake3_hash": g["blake3_hash"],
            "game_created_at": g["created_at"],
            "has_pending_uploads_row": pu is not None,
            "pending_uploads_id": pu["id"] if pu else None,
            "stored_upload_id": stored_id,
            "open_upload_ids": sorted(open_ids),
            # Abort every open UploadId AND the one pending_uploads remembers (even if
            # it's not currently open) -- a defensive double-abort is a harmless no-op
            # against R2 (NoSuchUpload is swallowed), and it's the only way to be sure
            # a THIRD leaked multipart under a since-forgotten UploadId doesn't survive.
            "upload_ids_to_abort": sorted(open_ids | ({stored_id} if stored_id else set())),
        }

        if not open_ids:
            finding["classification"] = (
                "dead_no_open_multipart" if stored_id else "dead_no_record_no_multipart"
            )
        elif any(_initiated_recent(u) for u in open_uploads):
            # At least one open multipart is recent enough to be an in-flight
            # upload. Report only, never touch.
            finding["classification"] = "possibly_live_skip"
            finding["upload_ids_to_abort"] = []
        elif not stored_id:
            finding["classification"] = "orphan_multipart_no_record"
        else:
            finding["classification"] = "dead_stale_recorded_session"

        findings.append(finding)

    conn.close()
    return findings


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env", required=True, choices=["dev", "staging", "prod"])
    parser.add_argument("--hours", type=float, default=24.0, help="Min pending-game age in hours (default 24)")
    parser.add_argument("--manifest-out", type=Path, default=None, help="Write the reap manifest as JSON here")
    args = parser.parse_args()

    config = load_env(args.env)
    app_env = config["APP_ENV"]
    bucket = config["R2_BUCKET"]
    cutoff_iso = (datetime.now(timezone.utc) - timedelta(hours=args.hours)).isoformat()
    print(f"Environment: {args.env} (APP_ENV={app_env}, bucket={bucket})")
    print(f"Cutoff: pending games created before {cutoff_iso}")

    r2 = get_r2_client(config)

    with tempfile.TemporaryDirectory(prefix="t7880_sweep_") as tmp:
        dest = Path(tmp)
        print(f"\nDownloading profile DBs from R2 to {dest} ...")
        auth_db, profiles = download_remote_dbs(r2, bucket, app_env, dest)
        print(f"Downloaded {len(profiles)} profile DB(s) across "
              f"{len({u for u, _, _ in profiles})} user(s)")

        print("\nListing every open multipart under 'games/' ...")
        multiparts_by_key = list_open_multiparts_under_games(r2, bucket)
        total_open = sum(len(v) for v in multiparts_by_key.values())
        print(f"{total_open} open multipart(s) across {len(multiparts_by_key)} key(s)")

        manifest: list[dict] = []
        for user_id, profile_id, db_path in profiles:
            findings = scan_profile(db_path, cutoff_iso, multiparts_by_key)
            for f in findings:
                f["user_id"] = user_id
                f["profile_id"] = profile_id
                f["email"] = email_for_user(auth_db, user_id)
            manifest.extend(findings)

    if not manifest:
        print("\nNo stranded pending games found. Nothing to do.")
        return

    by_class: dict[str, list[dict]] = {}
    for f in manifest:
        by_class.setdefault(f["classification"], []).append(f)

    print(f"\n=== Found {len(manifest)} pending game(s) older than {args.hours}h ===\n")
    for cls, items in sorted(by_class.items()):
        print(f"--- {cls} ({len(items)}) ---")
        for f in items:
            print(f"  user={f['user_id']} ({f['email']}) profile={f['profile_id']} "
                  f"game_id={f['game_id']} name={f['game_name']!r} "
                  f"hash={(f['blake3_hash'] or '')[:12]} created={f['game_created_at']}")
            print(f"    has_pending_uploads_row={f['has_pending_uploads_row']} "
                  f"stored_upload_id={f['stored_upload_id']} "
                  f"open_upload_ids={f['open_upload_ids']}")
        print()

    # T8160: "double_uploadid_anomaly" removed — stored-vs-listed UploadId
    # comparison is meaningless against R2 (listed ids are per-call aliases),
    # so that class flagged every live upload. Root cause found + fixed (T8160).
    reap_classes = {
        "dead_no_open_multipart", "dead_no_record_no_multipart",
        "orphan_multipart_no_record", "dead_stale_recorded_session",
    }
    to_reap = [f for f in manifest if f["classification"] in reap_classes]
    skipped = [f for f in manifest if f["classification"] not in reap_classes]

    print(f"=== Summary ===")
    print(f"  reap-eligible:  {len(to_reap)}")
    print(f"  possibly live (skipped, not in manifest for apply): {len(skipped)}")

    if args.manifest_out:
        args.manifest_out.write_text(json.dumps(to_reap, indent=2))
        print(f"\nReap manifest ({len(to_reap)} entries) written to {args.manifest_out}")
        print("Review it, get user sign-off, then run scripts/apply_stranded_uploads_sweep.py "
              "via fly ssh with this manifest piped in.")
    else:
        print("\nPass --manifest-out <path> to write the reap manifest for the apply step.")


if __name__ == "__main__":
    main()
