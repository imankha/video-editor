"""Account clone service (T11500): R2 object mirroring + verification + the
game_storage_refs copy, shared by scripts/copy_user_between_envs.py (cross-env),
scripts/build_dev_account_templates.py and the dev-only /api/auth/dev-accounts
router.

Extracted VERBATIM from copy_user_between_envs.py (Refactoring Rule 3: moves are
mechanical). Contract change vs. the script (T11500 D7): every failure raises
AccountCloneError instead of sys.exit(1), because SystemExit is a BaseException
and would escape FastAPI's exception handlers inside a request.
"""

import contextlib
import logging
import sqlite3
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)


class AccountCloneError(Exception):
    """A clone/verify step failed. Never swallowed: callers fail loudly (the CLI
    maps it to exit 1, the dev-accounts endpoint to a 500 with nothing left behind)."""

    def __init__(self, reason: str, details: list[str] | None = None):
        self.reason = reason
        self.details = list(details or [])
        super().__init__(f"{reason}: {'; '.join(self.details[:5])}" if self.details else reason)


def _list_keys(r2, bucket: str, prefix: str) -> list[str]:
    paginator = r2.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            keys.append(obj["Key"])
    return keys


def _db_version(r2, bucket: str, key: str) -> str:
    try:
        head = r2.head_object(Bucket=bucket, Key=key)
        return head.get("Metadata", {}).get("db-version", "?")
    except Exception as e:
        return f"ERR({e})"


def verify_r2_copy(r2, bucket: str, user_id: str, src_prefix: str, dst_prefix: str, src_keys: list[str],
                   dst_user_id: str | None = None):
    """Fail loudly if the destination doesn't match the source after copy.

    Catches silent partial copies -- the failure mode that left dev/imankh stale.
    Compares object counts and the db-version metadata of every *.sqlite file.
    """
    dst_user_id = dst_user_id or user_id
    src_user_prefix = f"{src_prefix}/users/{user_id}/"
    dst_user_prefix = f"{dst_prefix}/users/{dst_user_id}/"
    dst_keys = set(_list_keys(r2, bucket, dst_user_prefix))
    expected = {k.replace(src_user_prefix, dst_user_prefix, 1) for k in src_keys}

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
        dst_key = src_key.replace(src_user_prefix, dst_user_prefix, 1)
        sv = _db_version(r2, bucket, src_key)
        dv = _db_version(r2, bucket, dst_key)
        rel = src_key[len(src_user_prefix):]
        if sv != dv:
            log.error(f"[VERIFY] db-version MISMATCH for {rel}: source={sv} dest={dv}")
            ok = False
        else:
            log.info(f"[VERIFY] {rel}: db-version={dv} OK")

    if not ok:
        log.error("[VERIFY] R2 copy verification FAILED -- destination is NOT a faithful mirror")
        raise AccountCloneError("verify_r2_copy", [f"missing={len(missing)}", f"extra={len(extra)}"])
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
    fatal (AccountCloneError, naming each). A missing poster is cosmetic (warn only).

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
        raise AccountCloneError("no_profile_sqlite", [dst_user_prefix])

    dangling: list[str] = []
    poster_warnings: list[str] = []
    total_refs = 0

    for pk in profile_sqlite_keys:
        profile_id = _profile_id_from_key(pk)
        if profile_id is None:
            log.error(f"[VERIFY-REFS] cannot parse profile_id from {pk}")
            raise AccountCloneError("bad_profile_key", [pk])
        prof_prefix = f"{dst_prefix}/users/{user_id}/profiles/{profile_id}"

        with tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False) as tf:
            tmp = tf.name
        try:
            r2.download_file(bucket, pk, tmp)
            # contextlib.closing guarantees the handle is released even when a
            # check below raises mid-iteration (a bare conn would leak).
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
                        raise AccountCloneError("invalid_profile_db", [f"profile {profile_id}: no {table} table"])
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
        raise AccountCloneError("dangling_media_refs", list(dangling))
    log.info(f"[VERIFY-REFS] OK: all {total_refs} media rows across {len(profile_sqlite_keys)} profile(s) resolve to present objects")


def copy_user_objects(r2, bucket: str, user_id: str, src_prefix: str, dst_prefix: str, dry_run: bool,
                      dst_user_id: str | None = None) -> list[str]:
    """Mirror all R2 objects for a user from source prefix to destination prefix.

    Source and destination share the same bucket (only the {env}/ prefix differs),
    so this is an in-bucket copy. The destination prefix is PURGED first so the
    result is a faithful mirror -- stale objects left over from a prior account
    (e.g. an old profile.sqlite that copy_object would never touch) don't survive.

    T7800: with dst_user_id set (an --to-email alias clone), objects land under the
    ALIAS user's prefix — the user_id path segment is rewritten along with the env.
    """
    dst_user_id = dst_user_id or user_id

    user_prefix = f"{src_prefix}/users/{user_id}/"
    dst_user_prefix = f"{dst_prefix}/users/{dst_user_id}/"
    src_keys = _list_keys(r2, bucket, user_prefix)
    log.info(f"Found {len(src_keys)} R2 objects to copy")

    # Safety: never purge the destination if the source is empty -- that would
    # wipe the destination and leave nothing in its place.
    if not src_keys:
        log.error(f"Source prefix {user_prefix} is EMPTY -- aborting R2 copy (refusing to wipe destination)")
        raise AccountCloneError("empty_source", [user_prefix])

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
        dst_key = key.replace(user_prefix, dst_user_prefix, 1)
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
        verify_r2_copy(r2, bucket, user_id, src_prefix, dst_prefix, src_keys, dst_user_id)
        verify_media_refs(r2, bucket, dst_user_id, dst_prefix)
    return src_keys


def copy_game_storage_refs(src_cur, dst_cur, src_user_id: str, dst_user_id: str) -> int:
    """Copy game_storage_refs from src_user_id (src_cur) to dst_user_id (dst_cur).

    Clear the destination's existing refs for this user_id first so a re-copy is a
    faithful mirror -- otherwise refs that were removed at the source linger (ON
    CONFLICT DO NOTHING never deletes). Returns the number of rows copied."""
    dst_cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s", (dst_user_id,))
    src_cur.execute("SELECT * FROM game_storage_refs WHERE user_id = %s", (src_user_id,))
    refs = src_cur.fetchall()
    for ref in refs:
        dst_cur.execute(
            """INSERT INTO game_storage_refs (user_id, profile_id, blake3_hash, game_size_bytes, storage_expires_at, created_at)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (user_id, profile_id, blake3_hash) DO NOTHING""",
            (dst_user_id, ref["profile_id"], ref["blake3_hash"],
             ref["game_size_bytes"], ref["storage_expires_at"], ref["created_at"]),
        )
    return len(refs)


# ---------------------------------------------------------------------------
# T11500 Step 2d: dev -> dev clone composition (NEW code, not moved)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CloneResult:
    user_id: str
    objects_copied: int
    game_hashes: frozenset
    seconds: float


def game_video_key(blake3_hash: str) -> str:
    """Shared, deduplicated game video key. env-prefix-FREE (storage.py HARD GUARD,
    migrations/profile_db/v023 `games/{h}.mp4`): one object serves dev/staging/prod."""
    return f"games/{blake3_hash}.mp4"


def verify_game_videos_present(r2, bucket: str, hashes) -> None:
    """HEAD every referenced shared game video. A clone whose game video is gone
    would show a black player; fail at clone time instead (T11500 R1)."""
    missing = []
    for h in sorted(hashes):
        try:
            r2.head_object(Bucket=bucket, Key=game_video_key(h))
        except Exception:
            missing.append(game_video_key(h))
    if missing:
        log.error(f"[VERIFY-GAMES] {len(missing)} referenced game video(s) absent: {missing[:3]}")
        raise AccountCloneError("game_video_missing", missing)


def purge_user_prefix(r2, bucket: str, env: str, user_id: str) -> int:
    """Delete every R2 object under {env}/users/{user_id}/ (best-effort rollback)."""
    keys = _list_keys(r2, bucket, f"{env}/users/{user_id}/")
    for i in range(0, len(keys), 1000):
        r2.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]})
    return len(keys)


def clone_account_for_dev(*, r2, bucket: str, env: str, template_user_id: str,
                          new_user_id: str, new_email: str,
                          verify_games: bool = True) -> CloneResult:
    """Clone a template account into a brand-new loginable test account (same env).

    Order (T11500 D4): R2 copy + every verify FIRST, then ONE Postgres transaction
    (users row + game_storage_refs). The users row is what makes the account
    loginable, so a failure before that commit leaves nothing loginable; the new R2
    prefix is purged on any failure. Game videos are shared and never copied.
    """
    from app.services import auth_db  # local import: keeps the script re-export import-light

    started = time.monotonic()
    try:
        src_keys = copy_user_objects(r2, bucket, template_user_id, env, env, False, new_user_id)
        verify_r2_copy(r2, bucket, template_user_id, env, env, src_keys, new_user_id)
        verify_media_refs(r2, bucket, new_user_id, env)

        with auth_db.get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "SELECT DISTINCT blake3_hash FROM game_storage_refs WHERE user_id = %s",
                (template_user_id,),
            )
            hashes = frozenset(r["blake3_hash"] for r in cur.fetchall())
        if verify_games:  # the template builder passes False and HEADs only its chosen game
            verify_game_videos_present(r2, bucket, hashes)

        with auth_db.get_auth_db() as conn:
            cur = conn.cursor()
            cur.execute(
                "INSERT INTO users (user_id, email, verified_at, is_test_account) "
                "VALUES (%s, %s, now(), TRUE)",
                (new_user_id, new_email),
            )
            copy_game_storage_refs(cur, cur, template_user_id, new_user_id)
    except Exception as e:
        try:
            purged = purge_user_prefix(r2, bucket, env, new_user_id)
            log.error(f"[CLONE] failed ({e}); purged {purged} objects under {env}/users/{new_user_id}/")
        except Exception as purge_err:
            log.critical(
                f"[CLONE] failed ({e}) AND purge of {env}/users/{new_user_id}/ failed ({purge_err}); "
                f"orphan R2 prefix needs a manual purge (no users row exists, it cannot log in)"
            )
        if isinstance(e, AccountCloneError):
            raise
        raise AccountCloneError("clone_failed", [repr(e)]) from e

    return CloneResult(new_user_id, len(src_keys), hashes, time.monotonic() - started)
