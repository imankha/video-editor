"""
Copy a single user's data from one environment to another.

Copies:
  1. Postgres rows (users + game_storage_refs)
  2. R2 objects (profile.sqlite, user.sqlite, media files)

Requirements:
  - Fly proxy running for BOTH source and destination Postgres:
      fly proxy 15432:5432 --app reel-ballers-db-staging
      fly proxy 15433:5432 --app reel-ballers-db-prod
  - .env files at project root (.env, .env.staging, .env.prod)

Usage:
    cd src/backend && .venv\\Scripts\\python.exe ..\\..\\scripts\\copy_user_between_envs.py \
        --email imankh@gmail.com --from production --to staging
"""

import argparse
import contextlib
import logging
import sqlite3
import sys
import tempfile
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

PROJECT_ROOT = Path(__file__).parent.parent

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("copy-user")


def load_env(env_name: str) -> dict:
    suffix = {"dev": "", "staging": ".staging", "production": ".prod"}[env_name]
    env_file = PROJECT_ROOT / f".env{suffix}"
    if not env_file.exists():
        log.error(f"{env_file} not found")
        sys.exit(1)
    config = {}
    with open(env_file) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            config[key.strip()] = value.strip()
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
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=10,
            read_timeout=60,
        ),
        region_name="auto",
    )


def get_pg_conn(config: dict):
    return psycopg2.connect(config["DATABASE_URL"], cursor_factory=RealDictCursor)


def copy_postgres_rows(src_config: dict, dst_config: dict, email: str, dry_run: bool) -> str:
    """Copy user + game_storage_refs from source to destination Postgres. Returns user_id."""
    src_conn = get_pg_conn(src_config)
    dst_conn = get_pg_conn(dst_config)

    try:
        src_cur = src_conn.cursor()
        src_cur.execute("SELECT * FROM users WHERE email = %s", (email,))
        user_row = src_cur.fetchone()
        if not user_row:
            log.error(f"User {email} not found in source Postgres")
            sys.exit(1)

        user_id = user_row["user_id"]
        log.info(f"Found user_id: {user_id}")

        if dry_run:
            log.info(f"[DRY RUN] Would copy users row for {user_id}")
        else:
            dst_cur = dst_conn.cursor()

            # Remove any existing user with this email but different user_id
            dst_cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
            existing = dst_cur.fetchone()
            if existing and existing["user_id"] != user_id:
                old_id = existing["user_id"]
                log.info(f"Removing existing dev user {old_id} (same email, different user_id)")
                for table in ("game_storage_refs", "sessions", "user_segments", "user_actions",
                              "credit_transactions", "credit_reservations", "credits"):
                    dst_cur.execute(f"DELETE FROM {table} WHERE user_id = %s", (old_id,))
                dst_cur.execute("DELETE FROM pending_teammate_shares WHERE sharer_user_id = %s", (old_id,))
                dst_cur.execute("DELETE FROM shares WHERE sharer_user_id = %s", (old_id,))
                dst_cur.execute("DELETE FROM referrals WHERE referrer_id = %s OR referred_id = %s", (old_id, old_id))
                dst_cur.execute("DELETE FROM otp_codes WHERE email = %s", (email,))
                dst_cur.execute("DELETE FROM users WHERE user_id = %s", (old_id,))

            # Upsert user row
            cols = list(user_row.keys())
            vals = [user_row[c] for c in cols]
            placeholders = ", ".join(["%s"] * len(cols))
            col_names = ", ".join(cols)
            update_set = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols if c != "user_id")
            dst_cur.execute(
                f"INSERT INTO users ({col_names}) VALUES ({placeholders}) "
                f"ON CONFLICT (user_id) DO UPDATE SET {update_set}",
                vals,
            )
            log.info(f"Copied users row for {user_id}")

            # Copy game_storage_refs. Clear the destination's existing refs for this
            # user_id first so a re-copy is a faithful mirror -- otherwise refs that
            # were removed at the source linger (ON CONFLICT DO NOTHING never deletes).
            dst_cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s", (user_id,))
            src_cur.execute("SELECT * FROM game_storage_refs WHERE user_id = %s", (user_id,))
            refs = src_cur.fetchall()
            for ref in refs:
                dst_cur.execute(
                    """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ON CONFLICT (user_id, profile_id, blake3_hash) DO NOTHING""",
                    (ref["user_id"], ref["profile_id"], ref["blake3_hash"],
                     ref["game_size_bytes"], ref["storage_expires_at"], ref["created_at"]),
                )
            log.info(f"Copied {len(refs)} game_storage_refs rows")

            # Copy user_segments — the analytics row the admin dashboard INNER JOINs
            # on (users ⋈ user_segments). Without it the copied account never shows in
            # the dashboard. referrer_id has a FK to users(user_id); null it if the
            # referrer isn't present at the destination so the insert can't fail.
            dst_cur.execute("DELETE FROM user_segments WHERE user_id = %s", (user_id,))
            src_cur.execute("SELECT * FROM user_segments WHERE user_id = %s", (user_id,))
            seg = src_cur.fetchone()
            if seg:
                seg = dict(seg)
                ref = seg.get("referrer_id")
                if ref:
                    dst_cur.execute("SELECT 1 FROM users WHERE user_id = %s", (ref,))
                    if not dst_cur.fetchone():
                        log.info(f"  referrer {ref} not at destination -- nulling referrer_id")
                        seg["referrer_id"] = None
                cols = list(seg.keys())
                placeholders = ", ".join(["%s"] * len(cols))
                dst_cur.execute(
                    f"INSERT INTO user_segments ({', '.join(cols)}) VALUES ({placeholders})",
                    [seg[c] for c in cols],
                )
                log.info("Copied user_segments row")
            else:
                log.info("No user_segments row at source")

            # Copy user_actions — drives the dashboard's funnel, last-step, session and
            # usage columns. Clear the destination first for a faithful mirror.
            dst_cur.execute("DELETE FROM user_actions WHERE user_id = %s", (user_id,))
            src_cur.execute("SELECT * FROM user_actions WHERE user_id = %s", (user_id,))
            action_rows = src_cur.fetchall()
            for a in action_rows:
                a = dict(a)
                cols = list(a.keys())
                placeholders = ", ".join(["%s"] * len(cols))
                dst_cur.execute(
                    f"INSERT INTO user_actions ({', '.join(cols)}) VALUES ({placeholders})",
                    [a[c] for c in cols],
                )
            log.info(f"Copied {len(action_rows)} user_actions rows")

            # T5840: copy the credit ledger + balance -- credits live in Postgres
            # now (NOT in the copied user.sqlite), so without this a copied
            # account would arrive with a zero balance. Clear destination first
            # for a faithful mirror; re-derive balance from the copied ledger
            # rather than copying the `credits` row verbatim (never trust a
            # copied balance over the ledger it should equal).
            # N5: also clear credit_reservations -- reservations are ephemeral
            # in-flight state (an export job id from the SOURCE env means
            # nothing on the destination), never copied, but a STALE
            # destination-side reservation from a prior copy of this same
            # user_id must not linger and silently offset the re-derived balance.
            # A SOURCE env that has not yet run postgres v019 has no credit ledger
            # at all -- credits still live in the copied user.sqlite, and v019 is
            # exactly what moves them into Postgres. That is an environment-version
            # difference between two real deployments, not missing internal data,
            # so skip the ledger copy loudly instead of crashing the whole copy.
            # The destination's own migrate is what will populate the ledger.
            src_cur.execute("SELECT to_regclass('public.credit_transactions') IS NOT NULL AS ok")
            if not src_cur.fetchone()["ok"]:
                log.warning(
                    "SOURCE has no credit_transactions table (pre-v019) -- skipping ledger "
                    "copy. Credits ride along inside user.sqlite; run the destination "
                    "migrate to move them into Postgres."
                )
            else:
                dst_cur.execute("DELETE FROM credit_reservations WHERE user_id = %s", (user_id,))
                dst_cur.execute("DELETE FROM credit_transactions WHERE user_id = %s", (user_id,))
                src_cur.execute(
                    "SELECT amount, source, idempotency_key, reference_id, video_seconds, created_at "
                    "FROM credit_transactions WHERE user_id = %s", (user_id,),
                )
                tx_rows = src_cur.fetchall()
                for tx in tx_rows:
                    tx = dict(tx)
                    cols = ["user_id", *list(tx.keys())]
                    placeholders = ", ".join(["%s"] * len(cols))
                    dst_cur.execute(
                        f"INSERT INTO credit_transactions ({', '.join(cols)}) VALUES ({placeholders})",
                        [user_id, *[tx[c] for c in tx]],
                    )
                dst_cur.execute(
                    """INSERT INTO credits (user_id, balance)
                       VALUES (%s, (SELECT COALESCE(SUM(amount), 0) FROM credit_transactions WHERE user_id = %s))
                       ON CONFLICT (user_id) DO UPDATE SET
                           balance = (SELECT COALESCE(SUM(amount), 0) FROM credit_transactions WHERE user_id = %s),
                           updated_at = now()""",
                    (user_id, user_id, user_id),
                )
                log.info(f"Copied {len(tx_rows)} credit_transactions rows, re-derived balance")

            dst_conn.commit()

        return user_id

    finally:
        src_conn.close()
        dst_conn.close()


def _list_keys(r2, bucket: str, prefix: str) -> list[str]:
    paginator = r2.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            keys.append(obj["Key"])
    return keys


def copy_r2_objects(config: dict, user_id: str, src_prefix: str, dst_prefix: str, dry_run: bool):
    """Mirror all R2 objects for a user from source prefix to destination prefix.

    Source and destination share the same bucket (only the {env}/ prefix differs),
    so this is an in-bucket copy. The destination prefix is PURGED first so the
    result is a faithful mirror -- stale objects left over from a prior account
    (e.g. an old profile.sqlite that copy_object would never touch) don't survive.
    """
    r2 = get_r2_client(config)
    bucket = config["R2_BUCKET"]

    user_prefix = f"{src_prefix}/users/{user_id}/"
    dst_user_prefix = f"{dst_prefix}/users/{user_id}/"
    src_keys = _list_keys(r2, bucket, user_prefix)
    log.info(f"Found {len(src_keys)} R2 objects to copy")

    # Safety: never purge the destination if the source is empty -- that would
    # wipe the destination and leave nothing in its place.
    if not src_keys:
        log.error(f"Source prefix {user_prefix} is EMPTY -- aborting R2 copy (refusing to wipe destination)")
        sys.exit(1)

    # Purge destination prefix so removed/renamed objects don't linger.
    dst_existing = _list_keys(r2, bucket, dst_user_prefix)
    if dst_existing:
        if dry_run:
            log.info(f"  [DRY RUN] Would purge {len(dst_existing)} existing objects under {dst_user_prefix}")
        else:
            for i in range(0, len(dst_existing), 1000):
                batch = [{"Key": k} for k in dst_existing[i:i + 1000]]
                r2.delete_objects(Bucket=bucket, Delete={"Objects": batch})
            log.info(f"  Purged {len(dst_existing)} stale objects under {dst_user_prefix}")

    copied = 0
    for key in src_keys:
        dst_key = key.replace(f"{src_prefix}/", f"{dst_prefix}/", 1)
        if dry_run:
            log.info(f"  [DRY RUN] {key} -> {dst_key}")
        else:
            # MetadataDirective defaults to COPY, preserving the db-version metadata
            # the destination backend uses to decide it must re-download from R2.
            r2.copy_object(
                Bucket=bucket,
                Key=dst_key,
                CopySource={"Bucket": bucket, "Key": key},
            )
        copied += 1
        if copied % 20 == 0:
            log.info(f"  Copied {copied}/{len(src_keys)}...")

    log.info(f"R2 copy complete: {copied} objects from {src_prefix}/ to {dst_prefix}/")

    if not dry_run:
        verify_r2_copy(r2, bucket, user_id, src_prefix, dst_prefix, src_keys)
        verify_media_refs(r2, bucket, user_id, dst_prefix)


def _db_version(r2, bucket: str, key: str) -> str:
    try:
        head = r2.head_object(Bucket=bucket, Key=key)
        return head.get("Metadata", {}).get("db-version", "?")
    except Exception as e:
        return f"ERR({e})"


def verify_r2_copy(r2, bucket: str, user_id: str, src_prefix: str, dst_prefix: str, src_keys: list[str]):
    """Fail loudly if the destination doesn't match the source after copy.

    Catches silent partial copies -- the failure mode that left dev/imankh stale.
    Compares object counts and the db-version metadata of every *.sqlite file.
    """
    dst_user_prefix = f"{dst_prefix}/users/{user_id}/"
    dst_keys = set(_list_keys(r2, bucket, dst_user_prefix))
    expected = {k.replace(f"{src_prefix}/", f"{dst_prefix}/", 1) for k in src_keys}

    missing = expected - dst_keys
    extra = dst_keys - expected
    ok = True
    if missing:
        log.error(f"[VERIFY] {len(missing)} expected objects MISSING at destination, e.g. {sorted(missing)[:3]}")
        ok = False
    if extra:
        log.error(f"[VERIFY] {len(extra)} unexpected objects at destination, e.g. {sorted(extra)[:3]}")
        ok = False

    # Compare db-version metadata on every sqlite file (the real source of truth
    # for what the backend will load).
    for src_key in src_keys:
        if not src_key.endswith(".sqlite"):
            continue
        dst_key = src_key.replace(f"{src_prefix}/", f"{dst_prefix}/", 1)
        sv = _db_version(r2, bucket, src_key)
        dv = _db_version(r2, bucket, dst_key)
        rel = src_key[len(f"{src_prefix}/users/{user_id}/"):]
        if sv != dv:
            log.error(f"[VERIFY] db-version MISMATCH for {rel}: source={sv} dest={dv}")
            ok = False
        else:
            log.info(f"[VERIFY] {rel}: db-version={dv} OK")

    if not ok:
        log.error("[VERIFY] R2 copy verification FAILED -- destination is NOT a faithful mirror")
        sys.exit(1)
    log.info(f"[VERIFY] OK: {len(expected)} objects mirrored to {dst_user_prefix}")


# Media-referencing rows in each profile.sqlite and the R2 sub-prefix each row's
# `filename` resolves to. The key scheme is
# {dst_prefix}/users/{user_id}/profiles/{profile_id}/{sub}/{filename}
# (storage.py: r2_key). Omitting that env/profile prefix makes every lookup 404
# and produces a totally false audit -- so this walks the SAME keys the running
# backend presigns, not a guessed path.
_MEDIA_REF_TABLES = (
    ("final_videos", "final_videos"),
    ("working_videos", "working_videos"),
)


def _profile_id_from_key(profile_sqlite_key: str) -> str | None:
    """Extract the profile_id segment from a .../profiles/{pid}/profile.sqlite key."""
    parts = profile_sqlite_key.split("/")
    try:
        return parts[parts.index("profiles") + 1]
    except (ValueError, IndexError):
        return None


def verify_media_refs(r2, bucket: str, user_id: str, dst_prefix: str):
    """Fail loudly if any final_videos/working_videos row lacks its R2 object.

    This is the SECOND half of the copy's integrity check. `verify_r2_copy`
    proves the object SET was mirrored; it never opens the profile.sqlite, so it
    cannot see a DB row whose media object is absent -- a dangling ref -> black
    player for the user, reported success from the tool (the T6150 symptom).

    Reads whatever profile.sqlite is authoritative in R2 at the destination AT
    THIS MOMENT and asserts every media row resolves. A dangling video ref is
    fatal (sys.exit(1), naming each). A missing poster is cosmetic (warn only).

    SCOPE / what this does NOT catch: this runs synchronously right after the
    copy, so it sees the copy's OWN result. It catches a partial copy that is
    already inconsistent at copy time -- a dirty source, a failed object copy, a
    purge/copy race. It does NOT reliably catch the specific T6150 incident,
    because that clobber is ASYNCHRONOUS: a LIVE destination backend still holds
    its own profile.sqlite open and re-uploads its stale version (local-ahead
    guard) on its next write -- possibly seconds AFTER this script exits, over
    the good copy we just verified. Preventing that is the job of the
    --dest-machines-stopped guard in main(), NOT this check. The two are
    complementary: the guard stops the live-clobber at the source; this catches
    every other partial-copy shape (and the live-clobber too, IF it already
    happened by the time we read).
    """
    dst_user_prefix = f"{dst_prefix}/users/{user_id}/"
    all_keys = set(_list_keys(r2, bucket, dst_user_prefix))
    profile_sqlite_keys = sorted(k for k in all_keys if k.endswith("/profile.sqlite"))
    if not profile_sqlite_keys:
        log.error(f"[VERIFY-REFS] no profile.sqlite found under {dst_user_prefix} -- cannot verify media refs")
        sys.exit(1)

    dangling: list[str] = []
    poster_warnings: list[str] = []
    total_refs = 0

    for pk in profile_sqlite_keys:
        profile_id = _profile_id_from_key(pk)
        if profile_id is None:
            log.error(f"[VERIFY-REFS] cannot parse profile_id from {pk}")
            sys.exit(1)
        prof_prefix = f"{dst_prefix}/users/{user_id}/profiles/{profile_id}"

        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tf:
            tmp = tf.name
        try:
            r2.download_file(bucket, pk, tmp)
            # contextlib.closing guarantees the handle is released even when a
            # check below sys.exit()s mid-iteration (a bare conn would leak).
            with contextlib.closing(sqlite3.connect(tmp)) as conn:
                conn.row_factory = sqlite3.Row
                tables = {
                    r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
                }
                for table, sub in _MEDIA_REF_TABLES:
                    # Unlike the poster COLUMN (added by a later migration, legitimately
                    # absent on old DBs), these TABLES have existed since the earliest
                    # profile schema -- a profile.sqlite without them is not a valid
                    # profile DB, so fail loudly with the structured message rather than
                    # let sqlite raise a bare "no such table" traceback.
                    if table not in tables:
                        log.error(
                            f"[VERIFY-REFS] profile {profile_id}: profile.sqlite has no '{table}' "
                            f"table -- not a valid profile DB, the copy cannot be trusted"
                        )
                        sys.exit(1)
                    for row in conn.execute(f"SELECT filename FROM {table} WHERE filename IS NOT NULL"):
                        fn = row["filename"]
                        total_refs += 1
                        expected = f"{prof_prefix}/{sub}/{fn}"
                        if expected not in all_keys:
                            dangling.append(f"profile {profile_id} {table}.filename={fn!r} -> MISSING {expected}")
                # Posters are best-effort cosmetic assets (T4890) -- a missing one
                # must not fail the copy, but report it so it can be regenerated.
                # `poster_filename` stores the BASENAME already INCLUDING `.jpg`
                # (poster.py poster_basename -> "{final_filename}.jpg"); the key is
                # final_videos/posters/{poster_filename} -- do NOT append another
                # .jpg. The column is absent on pre-migration profile DBs (a real
                # env-version difference between deployments, like the pre-v019
                # credit ledger above), so skip it loudly rather than crash.
                final_cols = {c[1] for c in conn.execute("PRAGMA table_info(final_videos)")}
                if "poster_filename" in final_cols:
                    for row in conn.execute(
                        "SELECT poster_filename FROM final_videos WHERE poster_filename IS NOT NULL"
                    ):
                        pf = row["poster_filename"]
                        expected = f"{prof_prefix}/final_videos/posters/{pf}"
                        if expected not in all_keys:
                            poster_warnings.append(f"profile {profile_id} poster {pf!r} -> missing {expected}")
                else:
                    log.info(f"[VERIFY-REFS] profile {profile_id}: no poster_filename column (pre-migration) -- skipping poster check")
        finally:
            Path(tmp).unlink(missing_ok=True)

    for w in poster_warnings:
        log.warning(f"[VERIFY-REFS] {w}")
    if dangling:
        log.error(
            f"[VERIFY-REFS] {len(dangling)} media row(s) reference objects that DO NOT EXIST at "
            f"the destination -- the copy is a SILENT PARTIAL. This is the T6150 half-apply: the "
            f"profile-DB half did not land coherently with the R2 object half. Do NOT trust this "
            f"copy. If the destination is a LIVE env, STOP its machines and re-run (see "
            f"--dest-machines-stopped)."
        )
        for d in dangling:
            log.error(f"[VERIFY-REFS]   {d}")
        sys.exit(1)
    log.info(f"[VERIFY-REFS] OK: all {total_refs} media rows across {len(profile_sqlite_keys)} profile(s) resolve to present objects")


def main():
    parser = argparse.ArgumentParser(description="Copy a user between environments")
    parser.add_argument("--email", required=True)
    parser.add_argument("--from", dest="from_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--to", dest="to_env", required=True, choices=["dev", "staging", "production"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--dest-machines-stopped",
        action="store_true",
        help="Acknowledge the destination backend's Fly machines are STOPPED. A LIVE "
        "destination silently reverts the copied profile.sqlite (first-access-only "
        "restore + local-ahead re-upload guard), landing the R2 object half without the "
        "DB half -- the T6150 dangling-media half-apply. Required for --to staging/production.",
    )
    args = parser.parse_args()

    if args.from_env == args.to_env:
        log.error("Source and destination must be different")
        sys.exit(1)

    # A live destination backend holds its own profile.sqlite open and will
    # discard/revert the copied one -- the copy then half-applies silently (the
    # R2 objects land, the DB does not). Stopping the destination machines FIRST
    # makes R2 the sole authority so the copy is atomic and verify_media_refs is
    # meaningful. Refuse rather than silently produce dangling refs.
    if args.to_env in ("staging", "production") and not args.dry_run and not args.dest_machines_stopped:
        log.error(
            f"Refusing to copy into LIVE '{args.to_env}': its backend machines must be STOPPED "
            f"first, or they revert the copied profile.sqlite and leave dangling media refs "
            f"(T6150). Stop the destination machines (fly machine stop / scale to 0), then re-run "
            f"with --dest-machines-stopped."
        )
        sys.exit(1)

    src_config = load_env(args.from_env)
    dst_config = load_env(args.to_env)

    log.info(f"Copying {args.email}: {args.from_env} -> {args.to_env}")

    # 1. Copy Postgres rows (users + game_storage_refs)
    user_id = copy_postgres_rows(src_config, dst_config, args.email, args.dry_run)

    # 2. Copy R2 objects
    src_prefix = src_config["APP_ENV"]
    dst_prefix = dst_config["APP_ENV"]
    copy_r2_objects(src_config, user_id, src_prefix, dst_prefix, args.dry_run)

    log.info(f"Done. User {args.email} ({user_id}) copied from {args.from_env} to {args.to_env}")


if __name__ == "__main__":
    main()
