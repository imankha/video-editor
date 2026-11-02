"""
T11500: build (or verify) the dev account-picker TEMPLATE accounts in the dev env.

Templates: dev-template+upload@reelballers.local ("Just an upload") and
dev-template+full@reelballers.local ("Full account"), cloned from the prod-derived
fixture account and trimmed to the preset. The dev picker clones THESE for every pick.

DEV ONLY (refuses unless APP_ENV == "dev"). Runs in-process with the app's modules so
it uses the app's R2/PG clients, the JIT migration seam and the CAS sync path
(`sync_*_explicit` must return SyncResult.OK; never a blind `max+1` upload).

    cd src/backend && python ../../scripts/build_dev_account_templates.py --preset all
    cd src/backend && python ../../scripts/build_dev_account_templates.py --check
    cd src/backend && python ../../scripts/build_dev_account_templates.py --preset full --rebuild

Idempotent: an existing template is only ASSERTED (exit non-zero on drift); --rebuild deletes
it (delete_user.py's PG + storage path, by exact template email) and builds a NEW user_id, so no
live process can hold a stale CAS baseline for it.

Full-preset states are PICKED from the fixture's real projects (Framing / Spotlight / finished),
not fabricated: if the chosen game lacks one, the build fails naming the missing state.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "src" / "backend"))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from app.routers.dev_accounts import TEMPLATE_EMAILS, DevAccountPreset

FAR_FUTURE_EXPIRY = "2099-12-31T00:00:00+00:00"
FIXTURE_EMAIL = "imankh+devfixture@gmail.com"
MAX_TEMPLATE_OBJECTS = 80  # a clone must stay "seconds"; initial ceiling (design Step 3)
RAW_CLIPS_RANGE = (4, 8)  # "about 6 annotated plays"


# ---------------------------------------------------------------------------
# Pure assertions (unit-tested against synthetic SQLite)
# ---------------------------------------------------------------------------

def _scalar(conn: sqlite3.Connection, sql: str, params=()):
    return conn.execute(sql, params).fetchone()[0]


def _game_hashes(conn: sqlite3.Connection) -> set[str]:
    hashes = {r[0] for r in conn.execute("SELECT blake3_hash FROM games WHERE blake3_hash IS NOT NULL")}
    hashes |= {r[0] for r in conn.execute("SELECT blake3_hash FROM game_videos")}
    return hashes


def assert_preset_state(preset: DevAccountPreset, conns_by_profile: dict, pg_refs: list,
                        default_profile_id: str | None = None) -> list[str]:
    """Return the list of failures (empty == the template is in the described state).

    conns_by_profile: {profile_id: sqlite3.Connection (row_factory=Row)}.
    pg_refs: [{"profile_id", "blake3_hash", "storage_expires_at"}] from game_storage_refs.
    """
    f: list[str] = []
    if preset is DevAccountPreset.EMPTY:
        return ["empty has no template"]

    if preset is DevAccountPreset.UPLOAD:
        if len(conns_by_profile) != 1:
            f.append(f"upload: expected 1 profile, found {len(conns_by_profile)}")
    else:
        if len(conns_by_profile) != 2:
            f.append(f"full: expected 2 profiles, found {len(conns_by_profile)}")
    if not conns_by_profile:
        return f + ["no profile databases"]
    default_pid = default_profile_id or min(conns_by_profile)
    if default_pid not in conns_by_profile:
        return f + [f"default profile {default_pid} has no database"]

    for pid, conn in conns_by_profile.items():
        games = _scalar(conn, "SELECT COUNT(*) FROM games")
        ready = _scalar(conn, "SELECT COUNT(*) FROM games WHERE status = 'ready'")
        if pid == default_pid and games != 1:
            f.append(f"profile {pid}: expected exactly 1 game, found {games}")
        if pid != default_pid and games < 1:
            f.append(f"profile {pid}: second profile must own at least 1 game")
        if ready != games:
            f.append(f"profile {pid}: {games - ready} game(s) not status='ready'")
        sqlite_expiry = {r[0]: r[1] for r in conn.execute("SELECT blake3_hash, storage_expires_at FROM game_storage")}
        pg_expiry = {r["blake3_hash"]: str(r["storage_expires_at"]) for r in pg_refs if r["profile_id"] == pid}
        for h in _game_hashes(conn):
            if not str(sqlite_expiry.get(h, "")).startswith("2099-12-31"):
                f.append(f"profile {pid}: game_storage[{h[:8]}] expiry is {sqlite_expiry.get(h)!r}, not far-future")
            if not pg_expiry.get(h, "").startswith("2099-12-31"):
                f.append(f"profile {pid}: PG game_storage_refs[{h[:8]}] expiry is {pg_expiry.get(h)!r}, not far-future")
        for h in set(pg_expiry) - _game_hashes(conn):
            f.append(f"profile {pid}: PG ref {h[:8]} has no game in this profile")

    d = conns_by_profile[default_pid]
    raw = _scalar(d, "SELECT COUNT(*) FROM raw_clips")
    projects = _scalar(d, "SELECT COUNT(*) FROM projects")
    if preset is DevAccountPreset.UPLOAD:
        if raw:
            f.append(f"upload: expected 0 raw_clips, found {raw}")
        if projects:
            f.append(f"upload: expected 0 projects, found {projects}")
        return f

    lo, hi = RAW_CLIPS_RANGE
    if not lo <= raw <= hi:
        f.append(f"full: expected {lo}-{hi} raw_clips in the default profile, found {raw}")
    framing = _scalar(
        d,
        "SELECT COUNT(*) FROM projects p WHERE p.working_video_id IS NULL AND p.final_video_id IS NULL "
        "AND EXISTS (SELECT 1 FROM working_clips w WHERE w.project_id = p.id)",
    )
    spotlight = _scalar(
        d,
        "SELECT COUNT(*) FROM projects p WHERE p.working_video_id IS NOT NULL AND p.current_mode = 'overlay' "
        "AND p.final_video_id IS NULL",
    )
    # A finished project is archived by session init (working data deleted, final kept), so assert on
    # the PUBLISHED final video, not on a live project row.
    finished = _scalar(d, "SELECT COUNT(*) FROM final_videos WHERE published_at IS NOT NULL")
    for label, n in (("Framing project (clips, no working video)", framing),
                     ("Spotlight project (working video, overlay mode, no final)", spotlight),
                     ("published final video", finished)):
        if n < 1:
            f.append(f"full: missing {label}")
    return f


# ---------------------------------------------------------------------------
# Live build (NOT exercised by CI; needs dev R2 + Postgres + the fixture account)
# ---------------------------------------------------------------------------

def _guard_dev() -> None:
    from app import storage
    if storage.APP_ENV != "dev":
        sys.exit(f"REFUSING: APP_ENV={storage.APP_ENV!r}; the template builder is dev-only")
    if not storage.R2_ENABLED:
        sys.exit("REFUSING: R2_ENABLED is not true; templates live in dev R2")


def _open_profile_conns(user_id: str) -> tuple[dict, str]:
    """Open every registered profile DB of user_id through the JIT seam (migrates to head)."""
    from app.database import ensure_database, get_database_path
    from app.profile_context import set_current_profile_id
    from app.services.user_db import (
        ensure_user_database,
        get_profiles,
        get_selected_profile_id,
    )
    from app.user_context import set_current_user_id

    set_current_user_id(user_id)
    ensure_user_database(user_id)
    conns = {}
    for p in get_profiles(user_id):
        set_current_profile_id(p["id"])
        ensure_database()
        c = sqlite3.connect(get_database_path())
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA foreign_keys = ON")
        conns[p["id"]] = c
    return conns, get_selected_profile_id(user_id)


def _pg_refs(user_id: str) -> list:
    from app.services import auth_db
    with auth_db.get_auth_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT profile_id, blake3_hash, storage_expires_at FROM game_storage_refs WHERE user_id = %s",
                    (user_id,))
        return list(cur.fetchall())


def _sync_all(user_id: str, profile_ids) -> None:
    from app.database import (
        SyncResult,
        sync_db_to_r2_explicit,
        sync_user_db_to_r2_explicit,
    )
    for pid in profile_ids:
        r = sync_db_to_r2_explicit(user_id, pid)
        if r != SyncResult.OK:
            sys.exit(f"CAS sync of profile {pid} returned {r}; the build is not durable")
    r = sync_user_db_to_r2_explicit(user_id)
    if r != SyncResult.OK:
        sys.exit(f"CAS sync of user.sqlite returned {r}; the build is not durable")


def _content_digest(conns: dict) -> str:
    h = hashlib.sha256()
    for pid in sorted(conns):
        for line in conns[pid].iterdump():
            h.update(line.encode())
    return h.hexdigest()


def _r2_totals(r2, bucket: str, env: str, user_id: str) -> tuple[int, int]:
    n = size = 0
    for page in r2.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"{env}/users/{user_id}/"):
        for o in page.get("Contents", []) or []:
            n += 1
            size += o["Size"]
    return n, size


def _delete_template(config_env: str, email: str) -> None:
    """--rebuild: delete the OLD template by exact email via delete_user.py's PG + storage path."""
    import delete_user as du
    from app import storage
    config = du.load_env("dev")
    pg = du.get_pg_conn(config)
    cur = pg.cursor()
    cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
    row = cur.fetchone()
    if not row:
        return
    bug_keys = du.delete_one_postgres(pg, row["user_id"], email, dry_run=False, force_paid=True)
    pg.commit()
    du.purge_user_storage(du.get_r2_client(config), storage.R2_BUCKET, storage.APP_ENV,
                          row["user_id"], bug_keys, dry_run=False)
    pg.close()


def _pick_game_and_trim(preset: DevAccountPreset, user_id: str, conns: dict, default_pid: str, r2, bucket: str) -> None:
    """Keep ONE game G (HEAD-verified), drop everything else, set far-future expiry in SQLite + PG."""
    from app.services import account_clone, auth_db

    d = conns[default_pid]
    candidates = [r for r in d.execute("SELECT id, blake3_hash FROM games WHERE status = 'ready' "
                                       "AND blake3_hash IS NOT NULL ORDER BY id")]
    chosen = None
    reasons = []
    for g in candidates:
        try:
            account_clone.verify_game_videos_present(r2, bucket, {g["blake3_hash"]})
        except account_clone.AccountCloneError:
            reasons.append(f"game {g['id']}: video absent in R2")
            continue
        if preset is DevAccountPreset.FULL:
            lacking = _full_state_gaps(d, g["id"])
            if lacking:
                reasons.append(f"game {g['id']}: lacks {', '.join(lacking)}")
                continue
        chosen = g
        break
    if chosen is None:
        sys.exit(f"{preset.value}: no usable game in the fixture: {'; '.join(reasons) or 'no ready games'}")
    gid, ghash = chosen["id"], chosen["blake3_hash"]

    if preset is DevAccountPreset.UPLOAD:
        d.execute("DELETE FROM projects")
        d.execute("DELETE FROM raw_clips")
    else:
        keep = _full_keep_projects(d, gid)
        marks = ",".join("?" * len(keep))
        d.execute(f"DELETE FROM projects WHERE id NOT IN ({marks})", keep)
        d.execute("DELETE FROM raw_clips WHERE game_id != ? OR game_id IS NULL "
                  "AND id NOT IN (SELECT raw_clip_id FROM working_clips)", (gid,))
    d.execute("DELETE FROM games WHERE id != ?", (gid,))
    d.execute("DELETE FROM game_storage WHERE blake3_hash != ?", (ghash,))
    d.execute("UPDATE game_storage SET storage_expires_at = ? WHERE blake3_hash = ?", (FAR_FUTURE_EXPIRY, ghash))
    d.commit()

    # Drop non-default profiles for upload; full keeps/creates exactly one second profile below.
    from app.services.user_db import delete_profile
    others = [p for p in conns if p != default_pid]
    if preset is DevAccountPreset.UPLOAD:
        for pid in others:
            conns.pop(pid).close()
            delete_profile(user_id, pid)
    with auth_db.get_auth_db() as pg:
        cur = pg.cursor()
        keep_pids = list(conns)
        cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s AND profile_id = %s AND blake3_hash != %s",
                    (user_id, default_pid, ghash))
        cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s AND NOT (profile_id = ANY(%s))",
                    (user_id, keep_pids))
        cur.execute("UPDATE game_storage_refs SET storage_expires_at = %s "
                    "WHERE user_id = %s AND profile_id = %s AND blake3_hash = %s",
                    (FAR_FUTURE_EXPIRY, user_id, default_pid, ghash))

    if preset is DevAccountPreset.FULL:
        _ensure_second_profile(user_id, conns, default_pid, gid, ghash)


def _full_state_gaps(d: sqlite3.Connection, game_id: int) -> list[str]:
    gaps = []
    if _scalar(d, "SELECT COUNT(*) FROM raw_clips WHERE game_id = ?", (game_id,)) < RAW_CLIPS_RANGE[0]:
        gaps.append(f"fewer than {RAW_CLIPS_RANGE[0]} raw_clips")
    gaps.extend(_missing_states(d, game_id))
    return gaps


def _project_ids_for_game(d: sqlite3.Connection, game_id: int, where: str) -> list[int]:
    return [r[0] for r in d.execute(
        f"SELECT DISTINCT p.id FROM projects p JOIN working_clips w ON w.project_id = p.id "
        f"JOIN raw_clips r ON r.id = w.raw_clip_id WHERE r.game_id = ? AND {where} ORDER BY p.id", (game_id,))]


_FRAMING_WHERE = "p.working_video_id IS NULL AND p.final_video_id IS NULL"
_SPOTLIGHT_WHERE = "p.working_video_id IS NOT NULL AND p.current_mode = 'overlay' AND p.final_video_id IS NULL"
_FINISHED_WHERE = ("p.final_video_id IS NOT NULL AND EXISTS "
                   "(SELECT 1 FROM final_videos f WHERE f.id = p.final_video_id AND f.published_at IS NOT NULL)")


def _missing_states(d, game_id) -> list[str]:
    out = []
    for label, where in (("a Framing project", _FRAMING_WHERE), ("a Spotlight project", _SPOTLIGHT_WHERE),
                         ("a published finished project", _FINISHED_WHERE)):
        if not _project_ids_for_game(d, game_id, where):
            out.append(label)
    return out


def _full_keep_projects(d, game_id) -> list[int]:
    keep = []
    for where in (_FRAMING_WHERE, _SPOTLIGHT_WHERE, _FINISHED_WHERE):
        ids = _project_ids_for_game(d, game_id, where)
        if ids:
            keep.append(ids[0])
    return keep


def _ensure_second_profile(user_id, conns, default_pid, gid, ghash) -> None:
    """Q5: the second profile keeps one of ITS OWN fixture games if it has one, else gets a copy of G."""
    from uuid import uuid4

    from app.database import ensure_database, get_database_path
    from app.profile_context import set_current_profile_id
    from app.services import auth_db
    from app.services.materialization import _copy_game
    from app.services.user_db import create_profile

    others = [p for p in conns if p != default_pid]
    if others:
        pid = others[0]
        for extra in others[1:]:
            conns.pop(extra).close()
        c = conns[pid]
        own = c.execute("SELECT id FROM games WHERE status = 'ready' AND blake3_hash IS NOT NULL ORDER BY id").fetchone()
        if own:
            c.execute("DELETE FROM projects")
            c.execute("DELETE FROM raw_clips")
            c.execute("DELETE FROM games WHERE id != ?", (own["id"],))
            c.commit()
            return
    else:
        pid = uuid4().hex[:8]
        create_profile(user_id, pid, name="Second", color="#10b981")
        set_current_profile_id(pid)
        ensure_database()
        c = sqlite3.connect(get_database_path())
        c.row_factory = sqlite3.Row
        conns[pid] = c
    _copy_game(conns[default_pid], c, gid)
    size = conns[default_pid].execute("SELECT game_size_bytes FROM game_storage WHERE blake3_hash = ?",
                                      (ghash,)).fetchone()[0]
    auth_db.upsert_game_storage_row(c, ghash, size, FAR_FUTURE_EXPIRY)
    c.commit()
    auth_db.insert_game_storage_ref_pg_only(user_id, pid, ghash, size, FAR_FUTURE_EXPIRY)


def _fixed_point_and_summary(preset, email, r2, bucket, env) -> list[str]:
    """Open the template through the seam, assert state + fixed point, print the summary."""
    from app.services import account_clone, auth_db
    from app.session_init import invalidate_user_cache, user_session_init

    uid = auth_db.get_user_by_email(email)["user_id"]
    user_session_init(uid)  # archives the finished project (Full); idempotent thereafter
    conns, default_pid = _open_profile_conns(uid)
    failures = assert_preset_state(preset, conns, _pg_refs(uid), default_pid)
    before = _content_digest(conns)
    invalidate_user_cache(uid)
    user_session_init(uid)
    conns2, _ = _open_profile_conns(uid)
    if _content_digest(conns2) != before:
        failures.append("fixed point violated: a second user_session_init changed the profile DBs")
    n, size = _r2_totals(r2, bucket, env, uid)
    if n > MAX_TEMPLATE_OBJECTS:
        failures.append(f"R2 object ceiling exceeded: {n} > {MAX_TEMPLATE_OBJECTS}")
    try:
        account_clone.verify_media_refs(r2, bucket, uid, env)
        account_clone.verify_game_videos_present(r2, bucket, {r["blake3_hash"] for r in _pg_refs(uid)})
    except account_clone.AccountCloneError as e:
        failures.append(f"media/game verify: {e}")
    d = conns2[default_pid]
    print(f"[{preset.value}] user_id={uid} profiles={len(conns2)} games={_scalar(d, 'SELECT COUNT(*) FROM games')} "
          f"raw_clips={_scalar(d, 'SELECT COUNT(*) FROM raw_clips')} projects={_scalar(d, 'SELECT COUNT(*) FROM projects')} "
          f"pg_refs={len(_pg_refs(uid))} r2_objects={n} r2_bytes={size}")
    for c in (*conns.values(), *conns2.values()):
        c.close()
    shutil.rmtree(PROJECT_ROOT / "user_data" / uid, ignore_errors=True)  # no stale local baseline on this host
    return failures


def build_preset(preset: DevAccountPreset, source_email: str, rebuild: bool) -> list[str]:
    from app import storage
    from app.services import account_clone, auth_db

    r2, bucket, env = storage.get_r2_client(), storage.R2_BUCKET, storage.APP_ENV
    email = TEMPLATE_EMAILS[preset]
    exists = auth_db.get_user_by_email(email) is not None
    if exists and not rebuild:
        return _fixed_point_and_summary(preset, email, r2, bucket, env)
    if exists:
        _delete_template(env, email)
    src = auth_db.get_user_by_email(source_email)
    if not src:
        sys.exit(f"fixture account {source_email} not found in dev Postgres")
    uid = auth_db.generate_user_id()
    account_clone.clone_account_for_dev(r2=r2, bucket=bucket, env=env, template_user_id=src["user_id"],
                                        new_user_id=uid, new_email=email, verify_games=False)
    conns, default_pid = _open_profile_conns(uid)
    _pick_game_and_trim(preset, uid, conns, default_pid, r2, bucket)
    _sync_all(uid, conns)
    for c in conns.values():
        c.close()
    shutil.rmtree(PROJECT_ROOT / "user_data" / uid, ignore_errors=True)
    return _fixed_point_and_summary(preset, email, r2, bucket, env)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Build/verify the dev account-picker templates (dev only)")
    p.add_argument("--preset", choices=["upload", "full", "all"], default="all")
    p.add_argument("--source-email", default=FIXTURE_EMAIL)
    p.add_argument("--rebuild", action="store_true", help="delete + rebuild (new user_id)")
    p.add_argument("--check", action="store_true", help="assert only; never build")
    args = p.parse_args(argv)
    if args.check and args.rebuild:
        p.error("--check and --rebuild are mutually exclusive")
    _guard_dev()
    presets = [DevAccountPreset.UPLOAD, DevAccountPreset.FULL] if args.preset == "all" \
        else [DevAccountPreset(args.preset)]
    failed = False
    for preset in presets:
        if args.check:
            from app.services import auth_db
            if auth_db.get_user_by_email(TEMPLATE_EMAILS[preset]) is None:
                print(f"[{preset.value}] MISSING: template not built")
                failed = True
                continue
        failures = build_preset(preset, args.source_email, args.rebuild and not args.check)
        for line in failures:
            print(f"[{preset.value}] FAIL: {line}")
        failed |= bool(failures)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
