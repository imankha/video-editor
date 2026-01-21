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


def r2_key(user_id: str, path: str) -> str:
    """Generate R2 object key from user ID and relative path."""
    # Normalize path separators for R2
    path = path.replace("\\", "/")
    return f"{user_id}/{path}"


def download_from_r2(user_id: str, relative_path: str, local_path: Path) -> bool:
    """
    Download a file from R2 to local filesystem.

    Args:
        user_id: User namespace
        relative_path: Path relative to user_data/<user_id>/
        local_path: Local path to save the file

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

        client.download_file(R2_BUCKET, key, str(local_path))
        logger.debug(f"Downloaded from R2: {key} -> {local_path}")
        return True
    except client.exceptions.NoSuchKey:
        logger.debug(f"File not found in R2: {key}")
        return False
    except Exception as e:
        logger.error(f"Failed to download from R2: {key} - {e}")
        return False


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


def get_db_version_from_r2(user_id: str) -> Optional[int]:
    """
    Get the version number of the database in R2.

    Version is stored as custom metadata 'x-amz-meta-db-version'.
    Returns None if R2 is disabled, file doesn't exist, or no version set.
    """
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

    client = get_r2_client()
    if not client:
        return False, None

    # Check for conflicts (another request may have written)
    r2_version = get_db_version_from_r2(user_id)

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
