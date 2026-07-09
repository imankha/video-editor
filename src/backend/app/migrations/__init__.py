import logging
import shutil
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

from .user_db import RUNNER as USER_DB_RUNNER
from .profile_db import RUNNER as PROFILE_DB_RUNNER
from .postgres import RUNNER as PG_RUNNER

logger = logging.getLogger(__name__)


@dataclass
class MigrateResult:
    """Per-profile migration outcome from _migrate_profile_db."""
    status: str  # "ok" | "sync_failed" | "not_at_head" | "missing" | "download_failed"
    applied: list = field(default_factory=list)
    r2_version: int | None = None


def get_migration_status() -> dict:
    return {
        "user_db": {"latest_version": USER_DB_RUNNER.latest_version},
        "profile_db": {"latest_version": PROFILE_DB_RUNNER.latest_version},
        "postgres": {"latest_version": PG_RUNNER.latest_version},
    }


def run_all_migrations() -> dict:
    from ..services.auth_db import get_all_users_for_admin

    results = {
        "postgres": {"applied": [], "current_version": None, "latest_version": PG_RUNNER.latest_version, "error": None},
        "users": {"total": 0, "migrated": 0, "skipped": 0, "errors": [], "orphans": []},
    }

    # 1. Postgres (run once)
    _migrate_postgres(results)

    # 2. Per-user SQLite DBs
    users = get_all_users_for_admin()
    results["users"]["total"] = len(users)

    for user in users:
        user_id = user["user_id"]
        try:
            user_result = _migrate_user(user_id)

            for pid in user_result["orphans"]:
                results["users"]["orphans"].append({"user_id": user_id, "profile_id": pid})

            for err in user_result["errors"]:
                results["users"]["errors"].append({"user_id": user_id, **err})

            # A user is migrated/skipped ONLY when all registered profiles verified at head.
            if not user_result["errors"]:
                if user_result["any_applied"]:
                    results["users"]["migrated"] += 1
                else:
                    results["users"]["skipped"] += 1
        except Exception as e:
            logger.error(f"[Migration] Error migrating user {user_id}: {e}")
            results["users"]["errors"].append({"user_id": user_id, "error": str(e)})

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
            results["postgres"]["current_version"] = PG_RUNNER.get_current_version(conn, "postgres")
    except Exception as e:
        logger.error(f"[Migration] Postgres migration error: {e}")
        results["postgres"]["error"] = str(e)


def _migrate_user(user_id: str) -> dict:
    """
    Migrate all registered profiles for a user.

    Returns dict with keys:
      any_applied: bool  — at least one profile or user.sqlite had pending migrations
      errors: list[dict] — per-profile failures (profile_id, reason, r2_version?)
      orphans: list[str] — R2 profile IDs not in registry (informational, not migrated)
    """
    from ..services.user_db import get_profiles

    errors: list[dict] = []
    orphans: list[str] = []
    any_applied = False

    # Migrate user.sqlite first; ensure_user_database inside restores from R2
    user_db_applied = _migrate_user_db(user_id)
    if user_db_applied:
        any_applied = True

    # Registry is authoritative — only registered profiles are "real"
    try:
        registered_ids = {p["id"] for p in get_profiles(user_id)}
    except Exception as e:
        logger.error(f"[Migration] Failed to read profile registry for {user_id}: {e}")
        return {
            "any_applied": any_applied,
            "errors": [{"profile_id": None, "reason": f"registry_read_failed: {e}"}],
            "orphans": [],
        }

    # Detect orphans: R2 dirs not in registry (log + report, never migrate)
    r2_ids = set(_get_profile_ids(user_id))
    for pid in sorted(r2_ids - registered_ids):
        logger.warning("[Migration] Orphan profile %s for user %s — not in registry; skipping", pid, user_id)
        orphans.append(pid)

    # Migrate each registered profile
    for profile_id in sorted(registered_ids):
        try:
            result = _migrate_profile_db(user_id, profile_id)
            if result.applied:
                any_applied = True
            if result.status != "ok":
                errors.append({
                    "profile_id": profile_id,
                    "reason": result.status,
                    "r2_version": result.r2_version,
                })
        except Exception as e:
            logger.error("[Migration] Exception migrating profile %s for %s: %s", profile_id, user_id, e)
            errors.append({"profile_id": profile_id, "reason": f"exception: {e}", "r2_version": None})

    return {"any_applied": any_applied, "errors": errors, "orphans": orphans}


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


def _migrate_profile_db(user_id: str, profile_id: str) -> MigrateResult:
    """
    Migrate a single registered profile DB.

    Always migrates the canonical R2 copy (force-download), with a guard:
    if local is AHEAD of R2 (unsynced local writes), syncs local up first.
    Verifies in R2 after every run.  Returns MigrateResult; status "ok" means
    the profile verified at head in R2.
    """
    from ..database import USER_DATA_BASE, sync_db_to_r2_explicit
    from ..user_context import set_current_user_id
    from ..profile_context import set_current_profile_id
    from ..storage import get_r2_client

    db_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite"
    db_path.parent.mkdir(parents=True, exist_ok=True)

    client = get_r2_client()

    if client:
        # Force-download the canonical R2 copy to a temp file
        tmp_path = db_path.with_name("profile.sqlite.migrating_tmp")
        tmp_path.unlink(missing_ok=True)

        try:
            found = _download_profile_db(user_id, profile_id, tmp_path)
        except Exception as e:
            logger.warning("[Migration] Download failed for %s/%s: %s", user_id, profile_id, e)
            return MigrateResult(status="download_failed", applied=[])

        if found and tmp_path.exists():
            r2_version = _read_sqlite_user_version(tmp_path)
            local_version = _read_sqlite_user_version(db_path) if db_path.exists() else -1

            if local_version > r2_version:
                # Local AHEAD of R2: sync local up first, then keep local file
                tmp_path.unlink(missing_ok=True)
                set_current_user_id(user_id)
                set_current_profile_id(profile_id)
                if not sync_db_to_r2_explicit(user_id, profile_id):
                    return MigrateResult(status="sync_failed", applied=[])
                # db_path stays as-is (already newer than R2 was)
            else:
                # R2 is canonical: overwrite local with the downloaded copy
                shutil.move(str(tmp_path), str(db_path))
        elif not found:
            # Key not in R2 — registered profile has no R2 object (fail loud)
            return MigrateResult(status="missing", applied=[])
        else:
            # found=True but file missing: shouldn't happen, treat as download failure
            return MigrateResult(status="download_failed", applied=[])
    else:
        # Local-only mode (no R2 configured)
        if not db_path.exists():
            return MigrateResult(status="missing", applied=[])

    # Set context vars needed by migrations that read them (e.g. v002 get_current_user_id)
    set_current_user_id(user_id)
    set_current_profile_id(profile_id)

    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.execute("PRAGMA busy_timeout=30000")
    try:
        applied = PROFILE_DB_RUNNER.run(conn, "sqlite")
    finally:
        conn.close()

    if applied and client:
        if not sync_db_to_r2_explicit(user_id, profile_id):
            return MigrateResult(status="sync_failed", applied=applied)

    # Always verify in R2 (when R2 available): re-download and assert user_version == head
    if client:
        head = PROFILE_DB_RUNNER.latest_version
        verified = _read_r2_profile_user_version(user_id, profile_id)
        if verified != head:
            return MigrateResult(status="not_at_head", applied=applied, r2_version=verified)

    return MigrateResult(status="ok", applied=applied)


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


def _download_profile_db(user_id: str, profile_id: str, local_path) -> bool:
    """
    Download profile.sqlite from R2 to local_path.

    Returns True if downloaded successfully, False if the key does not exist in R2
    (or if no R2 client is available).  Raises on other download errors (fail loud).
    Accepts both Path and str for local_path.
    """
    from ..storage import get_r2_client, R2_BUCKET, APP_ENV

    local_path = Path(local_path)  # fix Path/str bug: ensure .parent works
    client = get_r2_client()
    if not client:
        return False

    key = f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/profile.sqlite"
    try:
        local_path.parent.mkdir(parents=True, exist_ok=True)
        client.download_file(R2_BUCKET, key, str(local_path))
        logger.info(f"[Migration] Downloaded profile DB from R2: {key}")
        return True
    except Exception as e:
        # NoSuchKey / 404 → not found (not an error)
        is_not_found = False
        if hasattr(e, "response"):
            code = (e.response or {}).get("Error", {}).get("Code", "")
            is_not_found = code in ("NoSuchKey", "404", "NoSuchBucket")
        if not is_not_found and hasattr(client, "exceptions") and hasattr(client.exceptions, "NoSuchKey"):
            is_not_found = is_not_found or isinstance(e, client.exceptions.NoSuchKey)
        if is_not_found:
            return False
        # Any other error: propagate (fail loud — caller catches and returns download_failed)
        raise


def _read_sqlite_user_version(db_path: Path) -> int:
    """Read PRAGMA user_version from a SQLite file. Returns 0 on any read error."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=5)
        try:
            return conn.execute("PRAGMA user_version").fetchone()[0]
        finally:
            conn.close()
    except Exception:
        return 0


def _read_r2_profile_user_version(user_id: str, profile_id: str) -> int | None:
    """
    Re-download profile.sqlite from R2 to a temp file and read PRAGMA user_version.
    Returns the version, or None on any failure (download error, not found, unreadable).
    Used for post-migration verification.
    """
    from ..database import USER_DATA_BASE

    tmp_path = USER_DATA_BASE / user_id / "profiles" / profile_id / "profile.sqlite.verify_tmp"
    try:
        downloaded = _download_profile_db(user_id, profile_id, tmp_path)
        if not downloaded or not tmp_path.exists():
            return None
        return _read_sqlite_user_version(tmp_path)
    except Exception as e:
        logger.warning("[Migration] Failed to verify R2 version for %s/%s: %s", user_id, profile_id, e)
        return None
    finally:
        tmp_path.unlink(missing_ok=True)
