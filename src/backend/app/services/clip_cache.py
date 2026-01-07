"""
Central Clip Caching Service

Provides a unified caching system for processed video clips across all export modes.
Prevents redundant processing when clips haven't changed.

Usage:
    from app.services.clip_cache import clip_cache

    # Generate cache key
    cache_key = clip_cache.generate_key(
        cache_type='framing',
        video_id=clip_cache.get_video_identity(video_path),
        crop_keyframes=keyframes,
        ...
    )

    # Check cache
    cached_path = clip_cache.get(cache_key)
    if cached_path:
        # Use cached clip
    else:
        # Process clip
        clip_cache.put(output_path, cache_key)
"""

import hashlib
import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class CacheStats:
    """Statistics about cache usage."""
    total_entries: int
    total_size_bytes: int
    oldest_entry_age_days: float
    cache_types: Dict[str, int]  # Count per cache type


class ClipCache:
    """
    Central clip caching system for processed video clips.

    Cache types:
    - 'annotate': Clips with burned-in text (from annotate export)
    - 'framing': AI-upscaled clips (from framing export)

    Cache key is a hash of all parameters that affect the output.
    Files are stored as: {cache_dir}/{cache_key}.mp4
    """

    def __init__(self, cache_dir: Path):
        """
        Initialize clip cache.

        Args:
            cache_dir: Directory to store cached clips
        """
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"[ClipCache] Initialized with cache dir: {self.cache_dir}")

    def generate_key(self, cache_type: str, **params) -> str:
        """
        Generate a unique cache key from parameters.

        Args:
            cache_type: Type of cache ('annotate', 'framing', etc.)
            **params: All parameters that affect the output

        Returns:
            16-character hex hash string
        """
        # Include cache_type to prevent collisions between different processors
        key_data = {
            '_cache_type': cache_type,
            **params
        }

        # Serialize to JSON with sorted keys for consistency
        # Use custom serializer to handle non-JSON types
        hash_input = json.dumps(key_data, sort_keys=True, default=self._serialize_value)

        # Generate SHA256 hash, truncated to 16 chars
        cache_key = hashlib.sha256(hash_input.encode()).hexdigest()[:16]

        logger.debug(f"[ClipCache] Generated key {cache_key} for {cache_type}")
        return cache_key

    def _serialize_value(self, value: Any) -> Any:
        """Custom serializer for non-JSON types."""
        if isinstance(value, (list, tuple)):
            return [self._serialize_value(v) for v in value]
        elif isinstance(value, dict):
            return {k: self._serialize_value(v) for k, v in value.items()}
        elif isinstance(value, float):
            # Round floats to avoid precision issues
            return round(value, 6)
        elif isinstance(value, Path):
            return str(value)
        else:
            return str(value)

    def get_video_identity(self, video_path: str) -> str:
        """
        Get a stable identity for a video file.

        Uses path + modification time for fast identity checking.
        This means cache is invalidated if the source file changes.

        Args:
            video_path: Path to video file

        Returns:
            String identity for the video
        """
        try:
            mtime = os.path.getmtime(video_path)
            # Include file size for extra safety
            size = os.path.getsize(video_path)
            return f"{video_path}|{mtime}|{size}"
        except OSError:
            # File doesn't exist or can't be accessed
            return f"{video_path}|0|0"

    def get(self, cache_key: str) -> Optional[Path]:
        """
        Get cached clip path if it exists.

        Args:
            cache_key: Cache key from generate_key()

        Returns:
            Path to cached clip, or None if not cached
        """
        cache_path = self.cache_dir / f"{cache_key}.mp4"

        if cache_path.exists():
            logger.info(f"[ClipCache] Cache HIT: {cache_key}")
            return cache_path

        logger.debug(f"[ClipCache] Cache MISS: {cache_key}")
        return None

    def exists(self, cache_key: str) -> bool:
        """
        Check if a cache entry exists.

        Args:
            cache_key: Cache key from generate_key()

        Returns:
            True if cached, False otherwise
        """
        return (self.cache_dir / f"{cache_key}.mp4").exists()

    def put(self, source_path: str, cache_key: str) -> Path:
        """
        Store a processed clip in the cache.

        Args:
            source_path: Path to the processed clip file
            cache_key: Cache key from generate_key()

        Returns:
            Path to the cached file
        """
        cache_path = self.cache_dir / f"{cache_key}.mp4"

        # Copy file to cache
        shutil.copy2(source_path, cache_path)

        logger.info(f"[ClipCache] Cached: {cache_key} ({os.path.getsize(cache_path) / 1024 / 1024:.1f} MB)")
        return cache_path

    def invalidate(self, cache_key: str) -> bool:
        """
        Remove a specific cache entry.

        Args:
            cache_key: Cache key to invalidate

        Returns:
            True if entry was removed, False if it didn't exist
        """
        cache_path = self.cache_dir / f"{cache_key}.mp4"

        if cache_path.exists():
            cache_path.unlink()
            logger.info(f"[ClipCache] Invalidated: {cache_key}")
            return True

        return False

    def clear(self, cache_type: Optional[str] = None) -> int:
        """
        Clear cache entries.

        Args:
            cache_type: If provided, only clear entries of this type
                       (requires metadata tracking - for now clears all)

        Returns:
            Number of entries removed
        """
        count = 0
        for cache_file in self.cache_dir.glob("*.mp4"):
            cache_file.unlink()
            count += 1

        logger.info(f"[ClipCache] Cleared {count} entries")
        return count

    def cleanup(self, max_age_days: int = 30, max_size_gb: float = 10.0) -> int:
        """
        Clean up old or excess cache entries.

        Removes entries older than max_age_days, and if still over
        max_size_gb, removes oldest entries until under limit.

        Args:
            max_age_days: Maximum age in days for cache entries
            max_size_gb: Maximum total cache size in GB

        Returns:
            Number of entries removed
        """
        removed = 0
        now = time.time()
        max_age_seconds = max_age_days * 24 * 60 * 60
        max_size_bytes = max_size_gb * 1024 * 1024 * 1024

        # Get all cache files with their stats
        cache_files = []
        for cache_file in self.cache_dir.glob("*.mp4"):
            try:
                stat = cache_file.stat()
                cache_files.append({
                    'path': cache_file,
                    'size': stat.st_size,
                    'mtime': stat.st_mtime,
                    'age': now - stat.st_mtime
                })
            except OSError:
                continue

        # Sort by modification time (oldest first)
        cache_files.sort(key=lambda x: x['mtime'])

        # Remove entries older than max_age
        for entry in cache_files[:]:
            if entry['age'] > max_age_seconds:
                entry['path'].unlink()
                cache_files.remove(entry)
                removed += 1
                logger.debug(f"[ClipCache] Removed old entry: {entry['path'].name}")

        # Calculate total size
        total_size = sum(f['size'] for f in cache_files)

        # Remove oldest entries until under size limit
        while total_size > max_size_bytes and cache_files:
            entry = cache_files.pop(0)  # Remove oldest
            entry['path'].unlink()
            total_size -= entry['size']
            removed += 1
            logger.debug(f"[ClipCache] Removed for size: {entry['path'].name}")

        if removed > 0:
            logger.info(f"[ClipCache] Cleanup removed {removed} entries, "
                       f"remaining size: {total_size / 1024 / 1024:.1f} MB")

        return removed

    def get_stats(self) -> CacheStats:
        """
        Get cache statistics.

        Returns:
            CacheStats with cache information
        """
        total_entries = 0
        total_size = 0
        oldest_age = 0
        now = time.time()

        for cache_file in self.cache_dir.glob("*.mp4"):
            try:
                stat = cache_file.stat()
                total_entries += 1
                total_size += stat.st_size
                age = now - stat.st_mtime
                if age > oldest_age:
                    oldest_age = age
            except OSError:
                continue

        return CacheStats(
            total_entries=total_entries,
            total_size_bytes=total_size,
            oldest_entry_age_days=oldest_age / (24 * 60 * 60),
            cache_types={}  # Would need metadata to track this
        )


# Per-user cache instances - initialized lazily
_clip_caches: Dict[str, ClipCache] = {}


def get_clip_cache() -> ClipCache:
    """
    Get the clip cache instance for the current user.

    Lazily initializes the cache on first access per user.
    """
    from app.database import get_clip_cache_path
    from app.user_context import get_current_user_id

    user_id = get_current_user_id()

    if user_id not in _clip_caches:
        cache_path = get_clip_cache_path()
        cache_path.mkdir(parents=True, exist_ok=True)
        _clip_caches[user_id] = ClipCache(cache_path)

    return _clip_caches[user_id]
