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

# BEFORE any app.* import: app.storage freezes R2_ENABLED/APP_ENV at import time.
from dotenv import load_dotenv  # noqa: E402

load_dotenv(PROJECT_ROOT / ".env")

from app.routers.dev_accounts import TEMPLATE_EMAILS, DevAccountPreset  # noqa: E402

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
        return [*f, "no profile databases"]
    default_pid = default_profile_id or min(conns_by_profile)
    if default_pid not in conns_by_profile:
        return [*f, f"default profile {default_pid} has no database"]

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
    """--rebuild: delete the OLD template by exact email via delete_user.py's PG + storage steps.

    Uses the app's PG pool and R2 client (process env), never delete_user's own .env
    connector: in a container .env's localhost does not reach Postgres. The PG
    transaction commits (get_pg exit) BEFORE the irreversible storage purge (T8630 r3).
    """
    import delete_user as du

    from app import storage
    from app.services import pg

    with pg.get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT user_id FROM users WHERE email = %s", (email,))
        row = cur.fetchone()
        if not row:
            return
        bug_keys = du.delete_one_postgres(conn, row["user_id"], email, dry_run=False, force_paid=True)
    du.purge_user_storage(storage.get_r2_client(), storage.R2_BUCKET, storage.APP_ENV,
                          row["user_id"], bug_keys, dry_run=False)


def _game_hashes_of(d: sqlite3.Connection, game_id: int) -> set[str]:
    hashes = {r[0] for r in d.execute("SELECT blake3_hash FROM games WHERE id = ? AND blake3_hash IS NOT NULL",
                                      (game_id,))}
    hashes |= {r[0] for r in d.execute("SELECT blake3_hash FROM game_videos WHERE game_id = ?", (game_id,))}
    return hashes


def _not_in(column: str, values: list) -> str:
    """SQL for "column not in values"; an EMPTY list matches every row (SQLite's
    `x NOT IN (NULL)` is NULL, which would silently match none)."""
    return f"{column} NOT IN ({','.join('?' * len(values))})" if values else "1 = 1"


def trim_profile_db(d: sqlite3.Connection, *, keep_project_ids: list[int], game_id: int,
                    max_raw_clips: int) -> None:
    """Cut a cloned fixture profile down to one game + the kept projects, in FK-safe order.

    final_videos.project_id is ON DELETE NO ACTION, so final videos go before projects.
    Raw clips the kept projects use always survive; the rest of game_id's clips fill up
    to max_raw_clips. Requires PRAGMA foreign_keys=ON (cascades clear working_clips,
    working_videos, export_jobs, modal_tasks, game_videos, teammate_shares).
    """
    keep = list(keep_project_ids)
    d.execute(f"DELETE FROM final_videos WHERE project_id IS NULL OR {_not_in('project_id', keep)}", keep)
    d.execute(f"DELETE FROM projects WHERE {_not_in('id', keep)}", keep)
    used = {r[0] for r in d.execute("SELECT raw_clip_id FROM working_clips")}
    # An archived finished project's clips live in its archive msgpack; its source clip
    # must survive or restoring the project breaks.
    used |= {r[0] for r in d.execute("SELECT source_clip_id FROM final_videos WHERE source_clip_id IS NOT NULL")}
    fill = [r[0] for r in d.execute("SELECT id FROM raw_clips WHERE game_id = ? ORDER BY id", (game_id,))
            if r[0] not in used]
    keep_clips = sorted(used | set(fill[:max(0, max_raw_clips - len(used))]))
    d.execute(f"DELETE FROM raw_clips WHERE {_not_in('id', keep_clips)}", keep_clips)
    hashes = sorted(_game_hashes_of(d, game_id))
    d.execute("DELETE FROM games WHERE id != ?", (game_id,))
    d.execute(f"DELETE FROM game_storage WHERE {_not_in('blake3_hash', hashes)}", hashes)
    for h in hashes:
        d.execute("UPDATE game_storage SET storage_expires_at = ? WHERE blake3_hash = ?", (FAR_FUTURE_EXPIRY, h))
    d.execute("DELETE FROM pending_uploads")  # the fixture's in-flight uploads are not ours to resume
    d.commit()


def objects_to_prune(d: sqlite3.Connection, *, game_id: int, present: list[str]) -> list[str]:
    """Profile-relative R2 keys under a trimmed profile that its DB no longer references.

    Keeps the DB itself, every filename the media tables name (final-video posters by
    prefix, which covers their .card.jpg variants), per-project archives and draft
    posters, game_id's recap files, and intro images (intro_cards). Everything else --
    other games' recaps, caches (collection/reel downloads), orphans -- goes.
    """
    exact = {"profile.sqlite"}
    prefixes = ["intro/", f"recaps/{game_id}.", f"recaps/{game_id}_", f"recaps/posters/{game_id}."]
    for table in ("raw_clips", "working_videos", "final_videos"):
        exact |= {f"{table}/{r[0]}" for r in d.execute(f"SELECT filename FROM {table} WHERE filename IS NOT NULL")}
    prefixes += [f"final_videos/posters/{r[0]}" for r in
                 d.execute("SELECT poster_filename FROM final_videos WHERE poster_filename IS NOT NULL")]
    for (pid,) in d.execute("SELECT id FROM projects"):
        exact |= {f"archive/{pid}.msgpack", f"posters/drafts/{pid}.v2.jpg"}
    return [k for k in present if k not in exact and not any(k.startswith(p) for p in prefixes)]


def _ensure_game_storage_rows(d: sqlite3.Connection, game_id: int) -> None:
    """Give every video hash of game_id a far-future game_storage row. The fixture's chosen
    game had game_videos but no game_storage rows at all; sizes come from game_videos (or
    games.video_size for a single-video game with no game_videos row). No size -> fail."""
    from app.services import auth_db

    sizes = dict(d.execute("SELECT blake3_hash, video_size FROM game_videos WHERE game_id = ?", (game_id,)).fetchall())
    row = d.execute("SELECT blake3_hash, video_size FROM games WHERE id = ?", (game_id,)).fetchone()
    if row and row[0] and row[0] not in sizes:
        sizes[row[0]] = row[1]
    have = {r[0] for r in d.execute("SELECT blake3_hash FROM game_storage")}
    for h in sorted(_game_hashes_of(d, game_id) - have):
        if not sizes.get(h):
            sys.exit(f"game {game_id} hash {h[:8]}: no game_storage row and no video_size to create one")
        auth_db.upsert_game_storage_row(d, h, sizes[h], FAR_FUTURE_EXPIRY)
    d.commit()


def _ensure_pg_refs(user_id: str, profile_id: str, d: sqlite3.Connection, game_id: int) -> None:
    """Upsert a far-future game_storage_refs row per hash of game_id. The dev fixture has
    no refs rows, so the clone inherits none: an UPDATE would leave the shared game video
    unprotected from the sweep. Sizes come from the profile's own game_storage rows."""
    from app.services import auth_db

    sizes = dict(d.execute("SELECT blake3_hash, game_size_bytes FROM game_storage").fetchall())
    for h in sorted(_game_hashes_of(d, game_id)):
        if h not in sizes:
            sys.exit(f"profile {profile_id}: game {game_id} hash {h[:8]} has no game_storage row")
        auth_db.insert_game_storage_ref_pg_only(user_id, profile_id, h, sizes[h], FAR_FUTURE_EXPIRY)


def _prune_profile_objects(r2, bucket: str, env: str, user_id: str, profile_id: str,
                           d: sqlite3.Connection, game_id: int) -> int:
    prefix = f"{env}/users/{user_id}/profiles/{profile_id}/"
    present = []
    for page in r2.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefix):
        present += [o["Key"][len(prefix):] for o in page.get("Contents", []) or []]
    doomed = objects_to_prune(d, game_id=game_id, present=present)
    for i in range(0, len(doomed), 1000):
        r2.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": prefix + k} for k in doomed[i:i + 1000]]})
    print(f"  profile {profile_id}: pruned {len(doomed)} of {len(present)} R2 objects")
    return len(doomed)


def _pick_game_and_trim(preset: DevAccountPreset, user_id: str, conns: dict, default_pid: str, r2, bucket: str,
                        env: str) -> None:
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

    keep = [] if preset is DevAccountPreset.UPLOAD else _full_keep_projects(d, gid)
    trim_profile_db(d, keep_project_ids=keep, game_id=gid,
                    max_raw_clips=0 if preset is DevAccountPreset.UPLOAD else RAW_CLIPS_RANGE[0] + 2)
    hashes = sorted(_game_hashes_of(d, gid))
    _prune_profile_objects(r2, bucket, env, user_id, default_pid, d, gid)

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
        cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s AND profile_id = %s "
                    "AND NOT (blake3_hash = ANY(%s))", (user_id, default_pid, hashes))
        cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s AND NOT (profile_id = ANY(%s))",
                    (user_id, keep_pids))

    _ensure_game_storage_rows(d, gid)
    _ensure_pg_refs(user_id, default_pid, d, gid)
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


def _finished_project_ids(d, game_id: int) -> list[int]:
    """Published finished projects of game_id. Real finished projects are ARCHIVED (their
    working_clips live in archive/{id}.msgpack), so they are found by the final video's
    game_ids (msgpack list); a not-yet-archived one is also found through working_clips."""
    import msgpack

    ids = set(_project_ids_for_game(d, game_id, _FINISHED_WHERE))
    for pid, raw in d.execute("SELECT p.id, f.game_ids FROM projects p JOIN final_videos f "
                              "ON f.id = p.final_video_id WHERE f.published_at IS NOT NULL"):
        if raw and msgpack.unpackb(raw, raw=False) == [game_id]:
            ids.add(pid)
    return sorted(ids)


def _state_project_ids(d, game_id: int) -> list[tuple[str, list[int]]]:
    return [("a Framing project", _project_ids_for_game(d, game_id, _FRAMING_WHERE)),
            ("a Spotlight project", _project_ids_for_game(d, game_id, _SPOTLIGHT_WHERE)),
            ("a published finished project", _finished_project_ids(d, game_id))]


def _missing_states(d, game_id) -> list[str]:
    return [label for label, ids in _state_project_ids(d, game_id) if not ids]


def _full_keep_projects(d, game_id) -> list[int]:
    return [ids[0] for _, ids in _state_project_ids(d, game_id) if ids]


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
            trim_profile_db(c, keep_project_ids=[], game_id=own["id"], max_raw_clips=0)
            own_hashes = sorted(_game_hashes_of(c, own["id"]))
            with auth_db.get_auth_db() as pg:
                cur = pg.cursor()
                cur.execute("DELETE FROM game_storage_refs WHERE user_id = %s AND profile_id = %s "
                            "AND NOT (blake3_hash = ANY(%s))", (user_id, pid, own_hashes))
            _ensure_game_storage_rows(c, own["id"])
            _ensure_pg_refs(user_id, pid, c, own["id"])
            return
    else:
        pid = uuid4().hex[:8]
        create_profile(user_id, pid, name="Second", color="#10b981")
        set_current_profile_id(pid)
        ensure_database()
        c = sqlite3.connect(get_database_path())
        c.row_factory = sqlite3.Row
        conns[pid] = c
    new_gid = _copy_game(conns[default_pid], c, gid)
    c.commit()
    _ensure_game_storage_rows(c, new_gid)  # every video of G, not just its primary hash
    _ensure_pg_refs(user_id, pid, c, new_gid)


def _fixed_point_and_summary(preset, email, r2, bucket, env) -> list[str]:
    """Open the template through the seam, assert state + fixed point, print the summary."""
    from app.services import account_clone, auth_db
    from app.session_init import invalidate_user_cache, user_session_init
    from app.user_context import set_current_user_id

    uid = auth_db.get_user_by_email(email)["user_id"]
    set_current_user_id(uid)  # --check reaches here without the build path's seam having set it
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
    _pick_game_and_trim(preset, uid, conns, default_pid, r2, bucket, env)
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
    from app.services.pg import close_pg_pool, init_pg_pool
    init_pg_pool()  # runs outside uvicorn: nothing else brings the pool up
    try:
        return _run(args)
    finally:
        close_pg_pool()


def _run(args) -> int:
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
