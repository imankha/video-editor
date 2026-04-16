"""
Profiling infrastructure — attribute slow calls at function level.

Design (T1530 / T1531):
  - Request-scoped cProfile middleware captures a call tree for every request
    when `PROFILE_ON_BREACH_ENABLED=true`. The profile is dumped to disk only
    when the request exceeds `PROFILE_ON_BREACH_MS` (default 1000) — fast
    requests discard their profile with no I/O. Header `X-Profile-Request: 1`
    forces a dump regardless of duration or env flag.
  - Every dump produces TWO files in `/tmp/profiles/`:
      {stem}.prof — binary, for snakeviz / pstats
      {stem}.txt  — top 50 by cumtime + top 50 by tottime, AI-readable
    The paired `.txt` means a reviewer (human or AI) can diagnose without any
    tooling beyond `cat`.
  - Profile directory is rotated to `PROFILE_KEEP_LAST` entries (default 100)
    on each dump. Disk usage is bounded.
  - SQLite connections can install a `set_trace_callback` that logs slow
    statements (`[SLOW SQL]`). This attributes `write_ms`/`read_ms` without
    opening a profile.
  - `[R2_CALL]` botocore event hook is registered in `storage.py`; covers
    S3 operation wall time (HEAD/GET/PUT, including retry-sleep).

Env vars:
  PROFILE_ON_BREACH_ENABLED  false | true   (default false; staging=true)
  PROFILE_ON_BREACH_MS       int ms         (default 1000)
  PROFILE_KEEP_LAST          int files      (default 100)
  SLOW_SQL_MS                int ms         (default 200)
  DEBUG_ENDPOINTS_ENABLED    false | true   (default false) — gates _debug router
"""

from __future__ import annotations

import cProfile
import io
import logging
import os
import pstats
import re
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, "true" if default else "false").lower() == "true"


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


PROFILE_DIR = Path("/tmp/profiles")


def profile_on_breach_enabled() -> bool:
    """Read fresh each call — allows runtime flips via env without restart."""
    return _env_bool("PROFILE_ON_BREACH_ENABLED", False)


def profile_breach_ms() -> int:
    return _env_int("PROFILE_ON_BREACH_MS", 1000)


def profile_keep_last() -> int:
    return _env_int("PROFILE_KEEP_LAST", 100)


def slow_sql_ms() -> int:
    return _env_int("SLOW_SQL_MS", 200)


def debug_endpoints_enabled() -> bool:
    return _env_bool("DEBUG_ENDPOINTS_ENABLED", False)


_PATH_SANITIZE = re.compile(r"[^a-zA-Z0-9]+")


def _slug(s: str, max_len: int = 60) -> str:
    cleaned = _PATH_SANITIZE.sub("_", s).strip("_")
    return cleaned[:max_len] or "root"


def ensure_profile_dir() -> Path:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    return PROFILE_DIR


def _format_pstats(prof: cProfile.Profile, top: int = 50) -> str:
    """Produce a human/AI-readable summary of a cProfile.Profile."""
    buf = io.StringIO()
    try:
        stats = pstats.Stats(prof, stream=buf)
    except TypeError:
        # Empty profile (never enabled or no samples). Return a minimal marker.
        return "[profile empty]\n"
    buf.write("=== Top by cumulative time ===\n")
    stats.sort_stats("cumulative").print_stats(top)
    buf.write("\n=== Top by total (self) time ===\n")
    stats.sort_stats("tottime").print_stats(top)
    return buf.getvalue()


def dump_profile(
    prof: cProfile.Profile,
    *,
    tag: str,
    elapsed_ms: float,
    extra: Optional[str] = None,
) -> Optional[Path]:
    """Write `{dir}/{ts}_{tag}_{ms}ms[.{extra}].prof` plus a sibling .txt.

    Returns the .prof path (absolute) or None on failure. Errors are logged
    but never raised — profiling must never break the caller.
    """
    try:
        d = ensure_profile_dir()
        ts = int(time.time())
        tag_slug = _slug(tag)
        extra_slug = f"_{_slug(extra, 24)}" if extra else ""
        stem = f"{ts}_{tag_slug}_{int(elapsed_ms)}ms{extra_slug}"
        prof_path = d / f"{stem}.prof"
        txt_path = d / f"{stem}.txt"
        prof.dump_stats(str(prof_path))
        txt_path.write_text(_format_pstats(prof), encoding="utf-8")
        _rotate(d, profile_keep_last())
        return prof_path.resolve()
    except Exception as e:
        logger.warning(f"[PROFILE] dump failed tag={tag}: {e}")
        return None


def _rotate(d: Path, keep: int) -> None:
    try:
        files = sorted(d.glob("*.prof"), key=lambda p: p.stat().st_mtime, reverse=True)
        for stale in files[keep:]:
            try:
                stale.unlink()
                sibling = stale.with_suffix(".txt")
                if sibling.exists():
                    sibling.unlink()
            except OSError:
                pass
    except Exception:
        pass


def list_profiles() -> list[dict]:
    if not PROFILE_DIR.exists():
        return []
    out = []
    for p in sorted(PROFILE_DIR.glob("*.prof"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            st = p.stat()
            out.append({
                "name": p.name,
                "size_bytes": st.st_size,
                "mtime": st.st_mtime,
                "has_text": p.with_suffix(".txt").exists(),
            })
        except OSError:
            continue
    return out


def read_profile_text(name: str) -> Optional[str]:
    """Read the human-readable .txt sibling for a given .prof filename.

    Path traversal protection: only basenames matching our dump pattern are
    accepted, and the resolved path must remain inside PROFILE_DIR.
    """
    if not re.fullmatch(r"[A-Za-z0-9._-]+", name):
        return None
    p = PROFILE_DIR / name
    if not p.suffix == ".prof":
        p = PROFILE_DIR / f"{name}.prof"
    txt = p.with_suffix(".txt")
    try:
        resolved = txt.resolve()
        if PROFILE_DIR.resolve() not in resolved.parents:
            return None
        if not resolved.exists():
            return None
        return resolved.read_text(encoding="utf-8")
    except OSError:
        return None


# SQL-level attribution is handled by the existing [SLOW QUERY] log in
# TrackedCursor.execute/executemany (see app/database.py). Threshold is
# SLOW_QUERY_THRESHOLD (100ms). No wrapper needed here.
