"""
Integration tests for Modal video ingest (T2625).

Tests both dedup and fresh-upload paths for Veo (direct) and Trace (HLS).
Cleans up R2 objects between tests to exercise both code paths.

Run with:
    cd src/backend && MODAL_ENABLED=true .venv/Scripts/python.exe -m pytest tests/test_modal_ingest.py -v -s

Requires:
    - R2 credentials in .env
    - MODAL_ENABLED=true + Modal tokens for remote tests
"""

import os
import pytest
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

from app.storage import R2_ENABLED, r2_head_object_global, r2_delete_object_global

TEST_VEO_URL = "https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/"
TEST_TRACE_URL = "https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/players"

MODAL_ENABLED = os.getenv("MODAL_ENABLED", "false").lower() == "true"

requires_modal = pytest.mark.skipif(not MODAL_ENABLED, reason="MODAL_ENABLED not set")
requires_r2 = pytest.mark.skipif(not R2_ENABLED, reason="R2 not enabled")


def _delete_game_from_r2(blake3_hash: str):
    """Delete a game video from R2 by its blake3 hash."""
    key = f"games/{blake3_hash}.mp4"
    if r2_head_object_global(key):
        r2_delete_object_global(key)
        print(f"  Deleted R2 object: {key}")
        return True
    return False


class TestModalVeoIngest:
    """Test Veo (direct download) via Modal — dedup and fresh paths."""

    @requires_modal
    @requires_r2
    @pytest.mark.asyncio
    async def test_veo_dedup_then_fresh(self):
        """
        1. Run ingest → expect dedup=True (file exists from prior test)
        2. Delete R2 object
        3. Run ingest again → expect dedup=False (fresh upload)
        4. Verify file exists in R2
        """
        from app.services.veo_import import resolve_veo_download_url
        from app.services.modal_client import call_modal_ingest

        info = await resolve_veo_download_url(TEST_VEO_URL)
        assert info.download_url

        progress_updates = []

        async def track_progress(pct, msg, phase):
            progress_updates.append((pct, msg, phase))

        # --- Pass 1: Dedup path ---
        print("\n  --- Pass 1: Dedup path ---")
        result1 = await call_modal_ingest(
            source_url=info.download_url,
            source_type="direct",
            progress_callback=track_progress,
        )
        assert result1["status"] == "success", f"Pass 1 failed: {result1.get('error')}"
        blake3_hash = result1["blake3_hash"]
        assert len(blake3_hash) == 64
        assert result1["dedup"] is True, "Expected dedup=True (file should already exist)"
        print(f"  Dedup OK: hash={blake3_hash[:16]}..., size={result1['file_size'] / (1024*1024):.1f}MB")

        # --- Delete R2 object ---
        print("  --- Deleting R2 object ---")
        deleted = _delete_game_from_r2(blake3_hash)
        assert deleted, f"Expected to find and delete games/{blake3_hash}.mp4"

        # --- Pass 2: Fresh upload path ---
        print("  --- Pass 2: Fresh upload ---")
        progress_updates.clear()
        result2 = await call_modal_ingest(
            source_url=info.download_url,
            source_type="direct",
            progress_callback=track_progress,
        )
        assert result2["status"] == "success", f"Pass 2 failed: {result2.get('error')}"
        assert result2["blake3_hash"] == blake3_hash
        assert result2["dedup"] is False, "Expected dedup=False (fresh upload)"
        assert result2["file_size"] > 0
        assert len(progress_updates) > 0
        print(f"  Fresh upload OK: size={result2['file_size'] / (1024*1024):.1f}MB, "
              f"progress updates={len(progress_updates)}")

        # --- Verify file in R2 ---
        r2_key = f"games/{blake3_hash}.mp4"
        exists = r2_head_object_global(r2_key)
        assert exists, f"Expected {r2_key} to exist in R2 after fresh upload"
        print(f"  Verified: {r2_key} exists in R2")


class TestModalTraceIngest:
    """Test Trace (HLS remux) via Modal — dedup and fresh paths."""

    @requires_modal
    @requires_r2
    @pytest.mark.asyncio
    async def test_trace_dedup_then_fresh(self):
        """
        1. Run ingest for first half → may be dedup or fresh
        2. If fresh, run again → expect dedup=True
        3. Delete R2 object
        4. Run ingest → expect dedup=False (fresh upload)
        5. Verify file exists in R2
        """
        from app.services.trace_import import resolve_trace_videos, resolve_best_variant
        from app.services.modal_client import call_modal_ingest

        info = await resolve_trace_videos(TEST_TRACE_URL)
        assert len(info.videos) > 0

        video = info.videos[0]
        variant_url = await resolve_best_variant(video.m3u8_url)
        assert variant_url

        # --- Pass 1: First ingest (could be dedup or fresh) ---
        print(f"\n  --- Pass 1: Initial ingest (half {video.half}) ---")
        result1 = await call_modal_ingest(
            source_url=variant_url,
            source_type="hls",
        )
        assert result1["status"] == "success", f"Pass 1 failed: {result1.get('error')}"
        blake3_hash = result1["blake3_hash"]
        assert len(blake3_hash) == 64
        print(f"  hash={blake3_hash[:16]}..., size={result1['file_size'] / (1024*1024):.1f}MB, "
              f"dedup={result1['dedup']}")

        # If first pass was fresh, verify dedup works on second pass
        if not result1["dedup"]:
            print("  --- Pass 1b: Verify dedup ---")
            result1b = await call_modal_ingest(
                source_url=variant_url,
                source_type="hls",
            )
            assert result1b["status"] == "success"
            assert result1b["blake3_hash"] == blake3_hash
            assert result1b["dedup"] is True, "Expected dedup=True on second run"
            print(f"  Dedup confirmed")

        # --- Delete R2 object ---
        print("  --- Deleting R2 object ---")
        deleted = _delete_game_from_r2(blake3_hash)
        assert deleted, f"Expected to find and delete games/{blake3_hash}.mp4"

        # --- Pass 2: Fresh upload ---
        print("  --- Pass 2: Fresh upload ---")
        result2 = await call_modal_ingest(
            source_url=variant_url,
            source_type="hls",
        )
        assert result2["status"] == "success", f"Pass 2 failed: {result2.get('error')}"
        assert result2["blake3_hash"] == blake3_hash
        assert result2["dedup"] is False, "Expected dedup=False (fresh upload)"
        assert result2["file_size"] > 0
        print(f"  Fresh upload OK: size={result2['file_size'] / (1024*1024):.1f}MB")

        # --- Verify file in R2 ---
        r2_key = f"games/{blake3_hash}.mp4"
        exists = r2_head_object_global(r2_key)
        assert exists, f"Expected {r2_key} to exist in R2 after fresh upload"
        print(f"  Verified: {r2_key} exists in R2")


class TestLocalIngestFallback:
    """Test local fallback path (no Modal)."""

    @requires_r2
    @pytest.mark.asyncio
    async def test_local_veo_ingest(self):
        """Local fallback: resolve Veo → local download → blake3 → R2 upload."""
        from app.services.veo_import import resolve_veo_download_url
        from app.services.local_processors import local_ingest

        info = await resolve_veo_download_url(TEST_VEO_URL)

        progress_updates = []

        async def track_progress(pct, msg, phase):
            progress_updates.append((pct, msg, phase))

        result = await local_ingest(
            source_url=info.download_url,
            source_type="direct",
            progress_callback=track_progress,
        )

        assert result["status"] == "success", f"Local ingest failed: {result.get('error')}"
        assert result["blake3_hash"]
        assert len(result["blake3_hash"]) == 64
        assert result["file_size"] > 0
        assert len(progress_updates) > 0

        print(f"\n  Local Veo ingest OK: hash={result['blake3_hash'][:16]}..., "
              f"size={result['file_size'] / (1024*1024):.1f}MB, "
              f"dedup={result.get('dedup', False)}")
