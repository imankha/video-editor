"""
R2 Storage Backend for Video Editor.

Provides an abstraction layer for accessing user data either from local filesystem
or Cloudflare R2. When R2 is configured (via environment variables), files are
synced between local cache and R2.

Configuration:
    Set these environment variables to enable R2:
    - R2_ENABLED=true
    - R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
    - R2_ACCESS_KEY_ID=<your_access_key>
    - R2_SECRET_ACCESS_KEY=<your_secret_key>
    - R2_BUCKET=reel-ballers-users
"""

import os
import logging
from pathlib import Path
from typing import Optional, BinaryIO, Tuple
from functools import lru_cache
import threading

logger = logging.getLogger(__name__)

# Environment prefix for R2 paths (dev | staging | prod)
APP_ENV = os.getenv("APP_ENV", "dev")

# Check if R2 is enabled
R2_ENABLED = os.getenv("R2_ENABLED", "false").lower() == "true"
R2_ENDPOINT = os.getenv("R2_ENDPOINT", "")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID", "")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY", "")
R2_BUCKET = os.getenv("R2_BUCKET", "reel-ballers-users")


@lru_cache(maxsize=1)
def get_r2_client():
    """Get boto3 S3 client configured for R2. Cached for reuse."""
    if not R2_ENABLED:
        return None

    try:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"}
            ),
            region_name="auto"
        )
        logger.info(f"R2 client initialized for bucket: {R2_BUCKET}")
        return client
    except ImportError:
        logger.warning("boto3 not installed, R2 disabled")
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 client: {e}")
        return None


@lru_cache(maxsize=1)
def get_r2_sync_client():
    """Get boto3 S3 client with short timeouts for database sync.

    Database sync runs in the middleware request path — long timeouts
    block the HTTP response. This client fails fast (3s connect, 10s read)
    so the user sees sync failure quickly instead of waiting 20s+.
    """
    if not R2_ENABLED:
        return None

    try:
        import boto3
        from botocore.config import Config

        client = boto3.client(
            "s3",
            endpoint_url=R2_ENDPOINT,
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                connect_timeout=3,
                read_timeout=10,
                retries={"max_attempts": 0},
            ),
            region_name="auto"
        )
        return client
    except ImportError:
        return None
    except Exception as e:
        logger.error(f"Failed to initialize R2 sync client: {e}")
        return None


def r2_key(user_id: str, path: str) -> str:
    """Generate R2 object key for user profile data.

    Format: {env}/users/{user_id}/profiles/{profile_id}/{path}
    """
    from .profile_context import get_current_profile_id
    profile_id = get_current_profile_id()
    # Normalize path separators for R2
    path = path.replace("\\", "/")
    return f"{APP_ENV}/users/{user_id}/profiles/{profile_id}/{path}"


def download_from_r2(user_id: str, relative_path: str, local_path: Path, progress_callback=None) -> bool:
    """
    Download a file from R2 to local filesystem.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Local path to save the file
        progress_callback: Optional callback(bytes_transferred) for download progress

    Returns:
        True if download succeeded, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        # Ensure parent directory exists
        local_path.parent.mkdir(parents=True, exist_ok=True)

        # Use callback if provided for progress tracking
        if progress_callback:
            client.download_file(R2_BUCKET, key, str(local_path), Callback=progress_callback)
        else:
            client.download_file(R2_BUCKET, key, str(local_path))
        logger.debug(f"Downloaded from R2: {key} -> {local_path}")
        return True
    except client.exceptions.NoSuchKey:
        logger.debug(f"File not found in R2: {key}")
        return False
    except Exception as e:
        logger.error(f"Failed to download from R2: {key} - {e}")
        return False


def get_r2_file_size(user_id: str, relative_path: str) -> Optional[int]:
    """
    Get the size of a file in R2.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/

    Returns:
        File size in bytes, or None if file not found or error
    """
    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, relative_path)
    try:
        response = client.head_object(Bucket=R2_BUCKET, Key=key)
        return response.get('ContentLength')
    except Exception as e:
        logger.debug(f"Could not get file size from R2: {key} - {e}")
        return None


async def download_from_r2_with_progress(
    user_id: str,
    relative_path: str,
    local_path: Path,
    export_id: str,
    export_type: str,
    project_id: int = None,
    project_name: str = None,
    progress_start: int = 5,
    progress_end: int = 15,
    global_path: bool = False,
) -> bool:
    """
    Download a file from R2 with WebSocket progress updates.

    DRY helper for annotate, framing, and overlay exports.
    Sends progress updates during download matching Modal's pattern.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/ (or global if global_path=True)
        local_path: Local path to save the file
        export_id: Export ID for WebSocket progress
        export_type: 'annotate', 'framing', or 'overlay'
        project_id: Optional project ID for progress data
        project_name: Optional project name for progress data
        progress_start: Starting progress percentage (default 5%)
        progress_end: Ending progress percentage (default 15%)
        global_path: If True, relative_path is used as-is (no user_id prefix)

    Returns:
        True if download succeeded, False otherwise
    """
    import asyncio
    from app.websocket import manager

    # Get file size for progress calculation
    if global_path:
        total_size = get_r2_file_size_global(relative_path)
    else:
        total_size = get_r2_file_size(user_id, relative_path)

    # Send initial progress
    progress_data = {
        'progress': progress_start,
        'message': 'Downloading source video...',
        'phase': 'downloading',
        'status': 'processing',
        'type': export_type
    }
    if project_id is not None:
        progress_data['projectId'] = project_id
    if project_name is not None:
        progress_data['projectName'] = project_name

    await manager.send_progress(export_id, progress_data)

    # Download with progress callback
    if total_size and total_size > 0:
        downloaded_bytes = [0]
        last_progress_sent = [progress_start]
        loop = asyncio.get_running_loop()

        def download_callback(bytes_transferred):
            downloaded_bytes[0] += bytes_transferred
            # Calculate progress within our range
            download_fraction = min(downloaded_bytes[0] / total_size, 1.0)
            current_progress = int(progress_start + download_fraction * (progress_end - progress_start))

            # Send update every 2% or more
            if current_progress >= last_progress_sent[0] + 2:
                last_progress_sent[0] = current_progress
                mb_downloaded = downloaded_bytes[0] / (1024 * 1024)
                try:
                    asyncio.run_coroutine_threadsafe(
                        manager.send_progress(export_id, {
                            'progress': current_progress,
                            'message': f'Downloading... ({mb_downloaded:.0f} MB)',
                            'phase': 'downloading',
                            'status': 'processing',
                            'type': export_type,
                            **({"projectId": project_id} if project_id else {}),
                            **({"projectName": project_name} if project_name else {}),
                        }),
                        loop
                    )
                except Exception:
                    pass

        # Run sync download in thread pool
        if global_path:
            success = await asyncio.to_thread(
                download_from_r2_global, relative_path, local_path, download_callback
            )
        else:
            success = await asyncio.to_thread(
                download_from_r2, user_id, relative_path, local_path, download_callback
            )
    else:
        # No file size available - just do simple download
        if global_path:
            success = await asyncio.to_thread(
                download_from_r2_global, relative_path, local_path
            )
        else:
            success = await asyncio.to_thread(
                download_from_r2, user_id, relative_path, local_path
            )

    if success:
        # Send download complete
        complete_data = {
            'progress': progress_end,
            'message': 'Download complete',
            'phase': 'downloading',
            'status': 'processing',
            'type': export_type
        }
        if project_id is not None:
            complete_data['projectId'] = project_id
        if project_name is not None:
            complete_data['projectName'] = project_name
        await manager.send_progress(export_id, complete_data)

    return success


def upload_to_r2(user_id: str, relative_path: str, local_path: Path) -> bool:
    """
    Upload a file from local filesystem to R2.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Local path of the file to upload

    Returns:
        True if upload succeeded, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        client.upload_file(str(local_path), R2_BUCKET, key)
        logger.debug(f"Uploaded to R2: {local_path} -> {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to upload to R2: {local_path} - {e}")
        return False


def upload_bytes_to_r2(user_id: str, relative_path: str, data: bytes) -> bool:
    """
    Upload bytes directly to R2 without writing to disk.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        data: Bytes to upload

    Returns:
        True if upload succeeded, False otherwise
    """
    from io import BytesIO

    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        client.upload_fileobj(BytesIO(data), R2_BUCKET, key)
        logger.debug(f"Uploaded bytes to R2: {key} ({len(data)} bytes)")
        return True
    except Exception as e:
        logger.error(f"Failed to upload bytes to R2: {key} - {e}")
        return False


def delete_from_r2(user_id: str, relative_path: str) -> bool:
    """
    Delete a file from R2.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/

    Returns:
        True if delete succeeded, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        client.delete_object(Bucket=R2_BUCKET, Key=key)
        logger.debug(f"Deleted from R2: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete from R2: {key} - {e}")
        return False


async def copy_file_in_r2(user_id: str, source_path: str, dest_path: str) -> bool:
    """
    Copy a file within R2 (server-side copy, no download/upload).

    Args:
        user_id: User namespace
        source_path: Source path relative to user_data/<user_id>/
        dest_path: Destination path relative to user_data/<user_id>/

    Returns:
        True if copy succeeded, False otherwise
    """
    import asyncio

    client = get_r2_client()
    if not client:
        logger.error("R2 client not available for copy")
        return False

    source_key = r2_key(user_id, source_path)
    dest_key = r2_key(user_id, dest_path)

    try:
        # Use asyncio.to_thread for async compatibility
        def do_copy():
            client.copy_object(
                Bucket=R2_BUCKET,
                CopySource={'Bucket': R2_BUCKET, 'Key': source_key},
                Key=dest_key
            )

        await asyncio.to_thread(do_copy)
        logger.info(f"Copied in R2: {source_key} -> {dest_key}")
        return True
    except Exception as e:
        logger.error(f"Failed to copy in R2: {source_key} -> {dest_key} - {e}")
        return False


def file_exists_in_r2(user_id: str, relative_path: str) -> bool:
    """Check if a file exists in R2."""
    client = get_r2_client()
    if not client:
        return False

    key = r2_key(user_id, relative_path)
    try:
        client.head_object(Bucket=R2_BUCKET, Key=key)
        return True
    except:
        return False


# Thread-local storage for tracking database version and writes per request
_request_context = threading.local()


def get_db_version_from_r2(user_id: str, client=None) -> Optional[int]:
    """
    Get the version number of the database in R2.

    Version is stored as custom metadata 'x-amz-meta-db-version'.
    Returns None if R2 is disabled, file doesn't exist, or no version set.

    Args:
        user_id: User namespace
        client: Optional boto3 client override (e.g. fast-timeout sync client)
    """
    if client is None:
        client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, "database.sqlite")
    try:
        response = client.head_object(Bucket=R2_BUCKET, Key=key)
        metadata = response.get("Metadata", {})
        version_str = metadata.get("db-version")
        if version_str:
            return int(version_str)
        # No version metadata - treat as version 0 (legacy upload)
        return 0
    except client.exceptions.ClientError as e:
        if e.response['Error']['Code'] == '404':
            return None  # File doesn't exist
        logger.error(f"Failed to get DB version from R2: {e}")
        return None
    except Exception as e:
        logger.error(f"Failed to get DB version from R2: {e}")
        return None


def sync_database_from_r2_if_newer(
    user_id: str,
    local_db_path: Path,
    local_version: Optional[int]
) -> Tuple[bool, Optional[int]]:
    """
    Download the user's database from R2 only if R2 version is newer.

    Args:
        user_id: User namespace
        local_db_path: Local path for the database file
        local_version: Current local version (None if no local DB)

    Returns:
        Tuple of (was_downloaded, new_version)
        - (True, version) if downloaded newer version
        - (False, local_version) if local is current or newer
        - (False, None) if R2 disabled or error
    """
    if not R2_ENABLED:
        return False, local_version

    r2_version = get_db_version_from_r2(user_id)

    # If no DB in R2, nothing to sync
    if r2_version is None:
        logger.debug(f"No database in R2 for user: {user_id}")
        return False, local_version

    # If local version is same or newer, no need to download
    if local_version is not None and local_version >= r2_version:
        logger.debug(f"Local DB version {local_version} >= R2 version {r2_version}, skipping download")
        return False, local_version

    # Download the newer version
    if download_from_r2(user_id, "database.sqlite", local_db_path):
        logger.info(f"Downloaded DB from R2: version {r2_version} (was {local_version})")
        return True, r2_version

    return False, local_version


def sync_database_to_r2_with_version(
    user_id: str,
    local_db_path: Path,
    current_version: Optional[int]
) -> Tuple[bool, Optional[int]]:
    """
    Upload the user's database to R2 with version metadata.

    Uses optimistic locking - checks that R2 version hasn't changed since we loaded.

    Args:
        user_id: User namespace
        local_db_path: Local path of the database file
        current_version: Version we loaded from (for conflict detection)

    Returns:
        Tuple of (success, new_version)
        - (True, new_version) if upload succeeded
        - (False, None) if conflict or error
    """
    if not R2_ENABLED:
        return False, None

    if not local_db_path.exists():
        return False, None

    # Use the fast-timeout sync client so network failures are detected
    # quickly (~3s) instead of blocking the HTTP response for 20s+
    client = get_r2_sync_client()
    if not client:
        return False, None

    # Check for conflicts (another request may have written)
    r2_version = get_db_version_from_r2(user_id, client=client)

    # If R2 has a newer version than what we loaded, we have a conflict
    if r2_version is not None and current_version is not None and r2_version > current_version:
        logger.warning(
            f"DB sync conflict for {user_id}: loaded version {current_version}, "
            f"R2 has version {r2_version}. Using last-write-wins."
        )
        # For MVP: last-write-wins, but log the conflict

    # Calculate new version
    new_version = (max(r2_version or 0, current_version or 0)) + 1

    key = r2_key(user_id, "database.sqlite")
    try:
        # Upload with version metadata
        client.upload_file(
            str(local_db_path),
            R2_BUCKET,
            key,
            ExtraArgs={
                "Metadata": {"db-version": str(new_version)}
            }
        )
        logger.debug(f"Uploaded DB to R2: {user_id} version {new_version}")
        return True, new_version
    except Exception as e:
        logger.error(f"Failed to upload DB to R2: {e}")
        return False, None


# Legacy functions for backward compatibility
def sync_database_from_r2(user_id: str, local_db_path: Path) -> bool:
    """
    Download the user's database from R2 if it exists.
    DEPRECATED: Use sync_database_from_r2_if_newer for version-aware sync.

    Args:
        user_id: User namespace
        local_db_path: Local path for the database file

    Returns:
        True if database was synced from R2, False if using local
    """
    if not R2_ENABLED:
        return False

    return download_from_r2(user_id, "database.sqlite", local_db_path)


def sync_database_to_r2(user_id: str, local_db_path: Path) -> bool:
    """
    Upload the user's database to R2.
    DEPRECATED: Use sync_database_to_r2_with_version for version-aware sync.

    Args:
        user_id: User namespace
        local_db_path: Local path of the database file

    Returns:
        True if upload succeeded, False otherwise
    """
    if not R2_ENABLED:
        return False

    if not local_db_path.exists():
        return False

    return upload_to_r2(user_id, "database.sqlite", local_db_path)


def ensure_file_from_r2(user_id: str, relative_path: str, local_path: Path) -> bool:
    """
    Ensure a file exists locally, downloading from R2 if needed.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Expected local path

    Returns:
        True if file exists locally (either already or after download)
    """
    if local_path.exists():
        return True

    if R2_ENABLED:
        return download_from_r2(user_id, relative_path, local_path)

    return False


def sync_file_to_r2_after_create(user_id: str, relative_path: str, local_path: Path):
    """
    Upload a newly created file to R2.
    Call this after creating new video files, clips, etc.
    """
    if R2_ENABLED and local_path.exists():
        upload_to_r2(user_id, relative_path, local_path)


def ensure_local_file(local_path: Path, user_data_base: Path) -> bool:
    """
    Ensure a file exists locally, downloading from R2 if needed.
    Automatically extracts user_id and relative_path from the local_path.

    This is a convenience wrapper around ensure_file_from_r2 for use in routers.

    Args:
        local_path: Full local path to the file
        user_data_base: Base path for user data (typically USER_DATA_BASE from database.py)

    Returns:
        True if file exists locally (either already or after download)
    """
    if local_path.exists():
        return True

    if not R2_ENABLED:
        return False

    # Extract user_id and relative_path from local_path
    # local_path should be like: user_data_base/<user_id>/<relative_path>
    try:
        rel_to_base = local_path.relative_to(user_data_base)
        parts = rel_to_base.parts
        if len(parts) < 2:
            return False
        user_id = parts[0]
        relative_path = "/".join(parts[1:])
        return download_from_r2(user_id, relative_path, local_path)
    except ValueError:
        # local_path is not under user_data_base
        return False


def generate_presigned_url(
    user_id: str,
    relative_path: str,
    expires_in: int = 3600,
    content_type: Optional[str] = None
) -> Optional[str]:
    """
    Generate a presigned URL for direct browser access to R2 object.

    This allows the frontend to stream videos/images directly from R2
    without proxying through the backend.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        expires_in: URL expiration time in seconds (default 1 hour)
        content_type: Optional content type (ignored - R2 doesn't support ResponseContentType)

    Returns:
        Presigned URL string, or None if R2 is disabled or error occurs
    """
    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, relative_path)
    try:
        params = {
            "Bucket": R2_BUCKET,
            "Key": key,
        }

        # Note: R2 doesn't support ResponseContentType parameter in presigned URLs.
        # The browser will use the Content-Type from the object metadata instead.

        url = client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in
        )
        logger.debug(f"Generated presigned URL for: {key}")
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {key}: {e}")
        return None


def generate_presigned_upload_url(
    user_id: str,
    relative_path: str,
    expires_in: int = 3600,
    content_type: Optional[str] = None
) -> Optional[str]:
    """
    Generate a presigned URL for direct browser upload to R2.

    This allows the frontend to upload files directly to R2
    without proxying through the backend.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        expires_in: URL expiration time in seconds (default 1 hour)
        content_type: Content type for the upload

    Returns:
        Presigned URL string, or None if R2 is disabled or error occurs
    """
    client = get_r2_client()
    if not client:
        return None

    key = r2_key(user_id, relative_path)
    try:
        params = {
            "Bucket": R2_BUCKET,
            "Key": key,
        }

        if content_type:
            params["ContentType"] = content_type

        url = client.generate_presigned_url(
            "put_object",
            Params=params,
            ExpiresIn=expires_in
        )
        logger.debug(f"Generated presigned upload URL for: {key}")
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned upload URL for {key}: {e}")
        return None


def get_file_url(user_id: str, relative_path: str, local_fallback_url: str) -> str:
    """
    Get the best URL for accessing a file.

    If R2 is enabled, returns a presigned URL for direct R2 access.
    Otherwise, returns the local fallback URL.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_fallback_url: URL to use if R2 is disabled

    Returns:
        URL string (either presigned R2 URL or local fallback)
    """
    if R2_ENABLED:
        presigned = generate_presigned_url(user_id, relative_path)
        if presigned:
            return presigned
    return local_fallback_url


# List files in R2 (for debugging/admin)
def list_r2_files(user_id: str, prefix: str = "") -> list:
    """List files in R2 for a user."""
    client = get_r2_client()
    if not client:
        return []

    full_prefix = r2_key(user_id, prefix)
    try:
        response = client.list_objects_v2(Bucket=R2_BUCKET, Prefix=full_prefix)
        return [obj["Key"] for obj in response.get("Contents", [])]
    except Exception as e:
        logger.error(f"Failed to list R2 files: {e}")
        return []


# ==============================================================================
# Global Storage Functions (for deduplicated games)
# ==============================================================================

def r2_global_key(path: str) -> str:
    """
    Generate R2 object key for global storage (not user-scoped).
    Used for deduplicated game storage: {env}/games/{blake3_hash}.mp4
    """
    # Normalize path separators for R2
    path = path.replace("\\", "/")
    return f"{APP_ENV}/{path}"


def r2_user_key(user_id: str, path: str) -> str:
    """
    Generate R2 object key for user-level files (outside profiles).
    Used for profiles.json, selected-profile.json.
    Format: {env}/users/{user_id}/{path}
    """
    path = path.replace("\\", "/")
    return f"{APP_ENV}/users/{user_id}/{path}"


def r2_head_object_global(key: str) -> Optional[dict]:
    """
    Check if a global object exists in R2 and return its metadata.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        Dict with ContentLength, Metadata, etc. if exists, None otherwise
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        response = client.head_object(Bucket=R2_BUCKET, Key=key)
        return {
            'ContentLength': response.get('ContentLength'),
            'Metadata': response.get('Metadata', {}),
            'ContentType': response.get('ContentType'),
            'LastModified': response.get('LastModified'),
        }
    except Exception:
        return None


def r2_delete_object_global(key: str) -> bool:
    """
    Delete a global object from R2.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        True if deleted successfully, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        client.delete_object(Bucket=R2_BUCKET, Key=key)
        logger.info(f"Deleted global object from R2: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete global object from R2: {key} - {e}")
        return False


# ==============================================================================
# Profile Management Functions (user-level, outside profiles/)
# ==============================================================================

def read_selected_profile_from_r2(user_id: str) -> Optional[str]:
    """Read selected-profile.json from R2 for a user.

    Returns the profile_id string, or None if not found or R2 disabled.
    """
    client = get_r2_sync_client()
    if not client:
        return None

    import json
    import tempfile

    key = r2_user_key(user_id, "selected-profile.json")
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.json') as tmp:
            tmp_path = tmp.name
        client.download_file(R2_BUCKET, key, tmp_path)
        with open(tmp_path, 'r') as f:
            data = json.load(f)
        os.unlink(tmp_path)
        profile_id = data.get("profileId")
        if profile_id:
            logger.info(f"Loaded profile {profile_id} for user {user_id} from R2")
        return profile_id
    except client.exceptions.NoSuchKey:
        logger.debug(f"No selected-profile.json for user {user_id}")
        return None
    except Exception as e:
        logger.warning(f"Failed to read selected-profile.json for user {user_id}: {e}")
        return None
    finally:
        try:
            os.unlink(tmp_path)
        except (OSError, UnboundLocalError):
            pass


def read_profiles_json(user_id: str) -> Optional[dict]:
    """Read profiles.json from R2 for a user.

    Returns the parsed dict, or None if not found or R2 disabled.
    """
    client = get_r2_sync_client()
    if not client:
        return None

    import json
    import tempfile

    key = r2_user_key(user_id, "profiles.json")
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix='.json') as tmp:
            tmp_path = tmp.name
        client.download_file(R2_BUCKET, key, tmp_path)
        with open(tmp_path, 'r') as f:
            data = json.load(f)
        os.unlink(tmp_path)
        return data
    except client.exceptions.NoSuchKey:
        logger.debug(f"No profiles.json for user {user_id}")
        return None
    except Exception as e:
        logger.warning(f"Failed to read profiles.json for user {user_id}: {e}")
        return None
    finally:
        try:
            if tmp_path:
                os.unlink(tmp_path)
        except (OSError, UnboundLocalError):
            pass


def save_profiles_json(user_id: str, data: dict) -> bool:
    """Write profiles.json to R2 for a user.

    Replaces the full document with the provided dict.
    """
    client = get_r2_client()
    if not client:
        return False

    import json

    key = r2_user_key(user_id, "profiles.json")
    try:
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=json.dumps(data).encode('utf-8'),
            ContentType='application/json',
        )
        logger.info(f"Saved profiles.json for user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to save profiles.json for user {user_id}: {e}")
        return False


def upload_profiles_json(user_id: str, profile_id: str) -> bool:
    """Upload profiles.json to R2 for a user.

    Creates the initial profile manifest with one default profile.
    """
    data = {
        "default": profile_id,
        "profiles": {
            profile_id: {"name": None}
        }
    }
    return save_profiles_json(user_id, data)


def delete_profile_r2_data(user_id: str, profile_id: str) -> bool:
    """Delete all R2 objects under profiles/{profile_id}/ for a user.

    Used when deleting a profile — removes database, clips, videos, etc.
    """
    client = get_r2_client()
    if not client:
        return False

    prefix = r2_user_key(user_id, f"profiles/{profile_id}/")
    try:
        # List all objects with the prefix
        response = client.list_objects_v2(Bucket=R2_BUCKET, Prefix=prefix)
        objects = response.get("Contents", [])

        if not objects:
            logger.info(f"No R2 objects to delete for profile {profile_id}")
            return True

        # Batch delete (S3/R2 supports up to 1000 per request)
        delete_keys = [{"Key": obj["Key"]} for obj in objects]
        client.delete_objects(
            Bucket=R2_BUCKET,
            Delete={"Objects": delete_keys}
        )
        logger.info(f"Deleted {len(delete_keys)} R2 objects for profile {profile_id} of user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete R2 data for profile {profile_id}: {e}")
        return False


def delete_local_profile_data(user_id: str, profile_id: str) -> bool:
    """Delete local data directory for a profile.

    Removes user_data/{user_id}/profiles/{profile_id}/ entirely.
    """
    import shutil
    from .database import USER_DATA_BASE

    profile_path = USER_DATA_BASE / user_id / "profiles" / profile_id
    if not profile_path.exists():
        return True

    try:
        shutil.rmtree(profile_path)
        logger.info(f"Deleted local data for profile {profile_id} of user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete local data for profile {profile_id}: {e}")
        return False


def upload_selected_profile_json(user_id: str, profile_id: str) -> bool:
    """Upload selected-profile.json to R2 for a user."""
    client = get_r2_client()
    if not client:
        return False

    import json

    key = r2_user_key(user_id, "selected-profile.json")
    data = {"profileId": profile_id}
    try:
        client.put_object(
            Bucket=R2_BUCKET,
            Key=key,
            Body=json.dumps(data).encode('utf-8'),
            ContentType='application/json',
        )
        logger.info(f"Set selected profile to {profile_id} for user {user_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to upload selected-profile.json for user {user_id}: {e}")
        return False


# ==============================================================================
# R2 Multipart Upload Functions
# ==============================================================================

def r2_create_multipart_upload(key: str, content_type: str = "video/mp4") -> Optional[str]:
    """
    Initiate a multipart upload to R2.

    Args:
        key: R2 object key
        content_type: Content type for the object

    Returns:
        Upload ID string if successful, None otherwise
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        response = client.create_multipart_upload(
            Bucket=R2_BUCKET,
            Key=key,
            ContentType=content_type
        )
        upload_id = response.get('UploadId')
        logger.info(f"Created multipart upload: {key}, upload_id: {upload_id}")
        return upload_id
    except Exception as e:
        logger.error(f"Failed to create multipart upload: {key} - {e}")
        return None


def r2_complete_multipart_upload(
    key: str,
    upload_id: str,
    parts: list,
    metadata: Optional[dict] = None
) -> bool:
    """
    Complete a multipart upload to R2.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload
        parts: List of dicts with 'PartNumber' and 'ETag' for each part
        metadata: Optional metadata to set on the completed object

    Returns:
        True if successful, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        # Sort parts by part number
        sorted_parts = sorted(parts, key=lambda p: p['PartNumber'])

        response = client.complete_multipart_upload(
            Bucket=R2_BUCKET,
            Key=key,
            UploadId=upload_id,
            MultipartUpload={'Parts': sorted_parts}
        )
        logger.info(f"Completed multipart upload: {key}")

        # Set metadata if provided (R2 requires copy-in-place for metadata)
        if metadata:
            r2_set_object_metadata_global(key, metadata)

        return True
    except Exception as e:
        logger.error(f"Failed to complete multipart upload: {key} - {e}")
        return False


def r2_abort_multipart_upload(key: str, upload_id: str) -> bool:
    """
    Abort a multipart upload (cleanup incomplete uploads).

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload

    Returns:
        True if aborted successfully, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        client.abort_multipart_upload(
            Bucket=R2_BUCKET,
            Key=key,
            UploadId=upload_id
        )
        logger.info(f"Aborted multipart upload: {key}, upload_id: {upload_id}")
        return True
    except Exception as e:
        logger.error(f"Failed to abort multipart upload: {key} - {e}")
        return False


def r2_is_multipart_upload_valid(key: str, upload_id: str) -> bool:
    """
    Check if a multipart upload session is still valid.

    Uses list_parts to verify the upload exists. R2/S3 will return
    an error if the upload has expired or been aborted.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload

    Returns:
        True if upload is valid and can be resumed, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        # list_parts will fail if the upload doesn't exist
        client.list_parts(
            Bucket=R2_BUCKET,
            Key=key,
            UploadId=upload_id,
            MaxParts=1  # We just need to check if it exists
        )
        return True
    except client.exceptions.NoSuchUpload:
        logger.info(f"Multipart upload no longer exists: {key}, upload_id: {upload_id}")
        return False
    except Exception as e:
        # Any other error (network, etc.) - assume invalid to be safe
        logger.warning(f"Error checking multipart upload validity: {key} - {e}")
        return False


def generate_presigned_part_url(
    key: str,
    upload_id: str,
    part_number: int,
    expires_in: int = 14400  # 4 hours default
) -> Optional[str]:
    """
    Generate a presigned URL for uploading a specific part.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload
        part_number: Part number (1-indexed)
        expires_in: URL expiration in seconds (default 4 hours)

    Returns:
        Presigned URL string, or None if failed
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        url = client.generate_presigned_url(
            'upload_part',
            Params={
                'Bucket': R2_BUCKET,
                'Key': key,
                'UploadId': upload_id,
                'PartNumber': part_number
            },
            ExpiresIn=expires_in
        )
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned part URL: {key} part {part_number} - {e}")
        return None


def generate_multipart_urls(
    key: str,
    upload_id: str,
    file_size: int,
    part_size: int = 100 * 1024 * 1024,  # 100MB default
    expires_in: int = 14400  # 4 hours default
) -> list:
    """
    Generate presigned URLs for all parts of a multipart upload.

    Args:
        key: R2 object key
        upload_id: Upload ID from create_multipart_upload
        file_size: Total file size in bytes
        part_size: Size of each part in bytes (default 100MB)
        expires_in: URL expiration in seconds (default 4 hours)

    Returns:
        List of dicts with part_number, presigned_url, start_byte, end_byte
    """
    parts = []
    part_number = 1
    offset = 0

    while offset < file_size:
        end_byte = min(offset + part_size - 1, file_size - 1)

        presigned_url = generate_presigned_part_url(
            key, upload_id, part_number, expires_in
        )

        if presigned_url:
            parts.append({
                'part_number': part_number,
                'presigned_url': presigned_url,
                'start_byte': offset,
                'end_byte': end_byte
            })

        offset += part_size
        part_number += 1

    logger.info(f"Generated {len(parts)} presigned URLs for multipart upload: {key}")
    return parts


# ==============================================================================
# R2 Object Metadata Functions (for ref_count tracking)
# ==============================================================================

def r2_get_object_metadata_global(key: str) -> Optional[dict]:
    """
    Get metadata for a global R2 object.

    Args:
        key: Global R2 key

    Returns:
        Metadata dict if object exists, None otherwise
    """
    head_result = r2_head_object_global(key)
    if head_result:
        return head_result.get('Metadata', {})
    return None


def r2_set_object_metadata_global(key: str, metadata: dict) -> bool:
    """
    Set metadata on a global R2 object (using copy-in-place).

    R2/S3 doesn't support updating metadata directly - you must copy the object
    to itself with new metadata.

    Args:
        key: Global R2 key
        metadata: Dict of metadata to set (keys will be lowercased by S3)

    Returns:
        True if successful, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        # Copy object to itself with new metadata
        client.copy_object(
            Bucket=R2_BUCKET,
            CopySource={'Bucket': R2_BUCKET, 'Key': key},
            Key=key,
            Metadata=metadata,
            MetadataDirective='REPLACE'
        )
        logger.debug(f"Set metadata on global object: {key}")
        return True
    except Exception as e:
        logger.error(f"Failed to set metadata on global object: {key} - {e}")
        return False


def increment_ref_count(key: str) -> int:
    """
    Increment the ref_count metadata on a global R2 object.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        New ref_count value, or -1 if failed
    """
    metadata = r2_get_object_metadata_global(key)
    if metadata is None:
        logger.error(f"Cannot increment ref_count: object not found: {key}")
        return -1

    try:
        current_count = int(metadata.get('ref_count', '0'))
    except (ValueError, TypeError):
        current_count = 0

    new_count = current_count + 1

    # Copy all existing metadata and update ref_count
    new_metadata = dict(metadata)
    new_metadata['ref_count'] = str(new_count)

    if r2_set_object_metadata_global(key, new_metadata):
        logger.info(f"Incremented ref_count: {key} -> {new_count}")
        return new_count
    return -1


def decrement_ref_count(key: str) -> int:
    """
    Decrement the ref_count metadata on a global R2 object.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")

    Returns:
        New ref_count value (0 means object should be deleted), or -1 if failed
    """
    metadata = r2_get_object_metadata_global(key)
    if metadata is None:
        logger.warning(f"Cannot decrement ref_count: object not found: {key}")
        return 0  # Treat as 0 so caller can clean up

    try:
        current_count = int(metadata.get('ref_count', '1'))
    except (ValueError, TypeError):
        current_count = 1

    new_count = max(0, current_count - 1)

    # Copy all existing metadata and update ref_count
    new_metadata = dict(metadata)
    new_metadata['ref_count'] = str(new_count)

    if r2_set_object_metadata_global(key, new_metadata):
        logger.info(f"Decremented ref_count: {key} -> {new_count}")
        return new_count

    logger.error(f"Failed to decrement ref_count: {key}")
    return -1


def generate_presigned_url_global(
    key: str,
    expires_in: int = 14400  # 4 hours default
) -> Optional[str]:
    """
    Generate a presigned URL for a global R2 object (no user prefix).

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")
        expires_in: URL expiration in seconds (default 4 hours)

    Returns:
        Presigned URL string, or None if failed
    """
    client = get_r2_client()
    if not client:
        return None

    try:
        url = client.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET, "Key": key},
            ExpiresIn=expires_in
        )
        logger.debug(f"Generated presigned URL for global object: {key}")
        return url
    except Exception as e:
        logger.error(f"Failed to generate presigned URL for {key}: {e}")
        return None


def get_r2_file_size_global(key: str) -> Optional[int]:
    """Get the size of a global R2 object (no user prefix)."""
    client = get_r2_client()
    if not client:
        return None
    try:
        response = client.head_object(Bucket=R2_BUCKET, Key=key)
        return response.get('ContentLength')
    except Exception as e:
        logger.debug(f"Could not get global file size from R2: {key} - {e}")
        return None


def download_from_r2_global(key: str, local_path: Path, progress_callback=None) -> bool:
    """
    Download a global R2 object (no user prefix) to local filesystem.

    Args:
        key: Global R2 key (e.g., "games/{hash}.mp4")
        local_path: Local path to save the file
        progress_callback: Optional callback(bytes_transferred) for download progress

    Returns:
        True if download succeeded, False otherwise
    """
    client = get_r2_client()
    if not client:
        return False

    try:
        # Ensure parent directory exists
        local_path.parent.mkdir(parents=True, exist_ok=True)
        if progress_callback:
            client.download_file(R2_BUCKET, key, str(local_path), Callback=progress_callback)
        else:
            client.download_file(R2_BUCKET, key, str(local_path))
        logger.debug(f"Downloaded global object from R2: {key} -> {local_path}")
        return True
    except client.exceptions.NoSuchKey:
        logger.debug(f"Global file not found in R2: {key}")
        return False
    except Exception as e:
        logger.error(f"Failed to download global object from R2: {key} - {e}")
        return False
