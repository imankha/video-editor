import logging
import sqlite3

from .user_db import RUNNER as USER_DB_RUNNER
from .profile_db import RUNNER as PROFILE_DB_RUNNER
from .postgres import RUNNER as PG_RUNNER

logger = logging.getLogger(__name__)


def get_migration_status() -> dict:
    return {
        "user_db": {"latest_version": USER_DB_RUNNER.latest_version},
        "profile_db": {"latest_version": PROFILE_DB_RUNNER.latest_version},
        "postgres": {"latest_version": PG_RUNNER.latest_version},
    }


def run_all_migrations() -> dict:
    from ..services.auth_db import get_all_users_for_admin

    results = {
        "postgres": {"applied": [], "error": None},
        "users": {"total": 0, "migrated": 0, "skipped": 0, "errors": []},
    }

    # 1. Postgres (run once)
    _migrate_postgres(results)

    # 2. Per-user SQLite DBs
    users = get_all_users_for_admin()
    results["users"]["total"] = len(users)

    for user in users:
        try:
            applied = _migrate_user(user["user_id"])
            if applied:
                results["users"]["migrated"] += 1
            else:
                results["users"]["skipped"] += 1
        except Exception as e:
            logger.error(f"[Migration] Error migrating user {user['user_id']}: {e}")
            results["users"]["errors"].append({
                "user_id": user["user_id"],
                "error": str(e),
            })

    return results


def _migrate_postgres(results: dict) -> None:
    from ..services.pg import get_pg

    try:
        with get_pg() as conn:
            applied = PG_RUNNER.run(conn, "postgres")
            results["postgres"]["applied"] = [
                {"version": m.version, "description": m.description}
                for m in applied
            ]
    except Exception as e:
        logger.error(f"[Migration] Postgres migration error: {e}")
        results["postgres"]["error"] = str(e)


def _migrate_user(user_id: str) -> bool:
    any_applied = False

    applied = _migrate_user_db(user_id)
    if applied:
        any_applied = True

    for profile_id in _get_profile_ids(user_id):
        applied = _migrate_profile_db(user_id, profile_id)
        if applied:
            any_applied = True

    return any_applied


def _migrate_user_db(user_id: str) -> list:
    from ..services.user_db import ensure_user_database, _get_user_db_path
    from ..database import sync_user_db_to_r2_explicit

    ensure_user_database(user_id)
    db_path = _get_user_db_path(user_id)
    if not db_path.exists():
        return []

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        applied = USER_DB_RUNNER.run(conn, "sqlite")
    finally:
        conn.close()

    if applied:
        sync_user_db_to_r2_explicit(user_id)

    return applied


def _migrate_profile_db(user_id: str, profile_id: str) -> list:
    from ..database import USER_DATA_BASE, sync_db_to_r2_explicit
    from ..user_context import set_current_user_id
    from ..profile_context import set_current_profile_id

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    if not db_path.exists():
        _download_profile_db(user_id, profile_id, db_path)
        if not db_path.exists():
            return []

    # Set context vars needed by R2 sync functions
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        applied = PROFILE_DB_RUNNER.run(conn, "sqlite")
    finally:
        conn.close()

    if applied:
        sync_db_to_r2_explicit(user_id, profile_id)

    return applied


def _get_profile_ids(user_id: str) -> list[str]:
    from ..database import USER_DATA_BASE
    from ..storage import get_r2_client, R2_BUCKET, APP_ENV

    client = get_r2_client()
    if not client:
        profiles_dir = USER_DATA_BASE / user_id / "profiles"
        if not profiles_dir.exists():
            return []
        return [
            d.name for d in profiles_dir.iterdir()
            if d.is_dir() and (d / "profile.sqlite").exists()
        ]

    prefix = f"{APP_ENV}/users/{user_id}/profiles/"
    try:
        response = client.list_objects_v2(Bucket=R2_BUCKET, Prefix=prefix, Delimiter="/")
        profile_ids = []
        for cp in response.get("CommonPrefixes", []):
            parts = cp["Prefix"].rstrip("/").split("/")
            profile_ids.append(parts[-1])
        return profile_ids
    except Exception as e:
        logger.warning(f"[Migration] Failed to list profiles for {user_id}: {e}")
        return []


def _download_profile_db(user_id: str, profile_id: str, local_path) -> None:
    from ..storage import get_r2_client, R2_BUCKET, APP_ENV

    client = get_r2_client()
    if not client:
        return

    key = f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(R2_BUCKET, key, str(local_path))
        logger.info(f"[Migration] Downloaded profile DB from R2: {key}")
    except client.exceptions.NoSuchKey:
        pass
    except Exception as e:
        logger.warning(f"[Migration] Failed to download profile DB: {key} - {e}")
