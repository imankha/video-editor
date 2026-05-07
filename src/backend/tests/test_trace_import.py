"""
Integration tests for Trace server-to-server import.

Tests the full pipeline: URL parsing -> GraphQL query (anon) -> HLS discovery
-> ffmpeg remux -> upload to R2. Uses real Trace URLs (no mocks).

Run with: cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_trace_import.py -v
"""

import pytest

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

from app.services.trace_import import (
    parse_trace_url,
    resolve_trace_videos,
    resolve_best_variant,
    remux_hls_to_mp4,
    upload_file_to_r2,
    TraceImportError,
    TraceGameRef,
    TraceGameInfo,
)
from app.storage import (
    r2_head_object_global,
    r2_global_key,
    R2_ENABLED,
)

# Real Trace game URL for testing (verified 2026-05-06)
TEST_TRACE_URL = "https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/players"

requires_r2 = pytest.mark.skipif(
    not R2_ENABLED,
    reason="R2 not enabled"
)


class TestParseTraceUrl:

    def test_standard_url(self):
        ref = parse_trace_url(TEST_TRACE_URL)
        assert ref.hash_key == "SD3TRsE6-"
        assert ref.game_id == 10046397

    def test_landing_variant(self):
        ref = parse_trace_url("https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/landing")
        assert ref.hash_key == "SD3TRsE6-"
        assert ref.game_id == 10046397

    def test_with_query_params(self):
        ref = parse_trace_url("https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/10046397/players?mtm_campaign=test")
        assert ref.game_id == 10046397

    def test_invalid_url_raises(self):
        with pytest.raises(TraceImportError, match="Invalid Trace URL"):
            parse_trace_url("https://youtube.com/watch?v=abc123")

    def test_empty_string_raises(self):
        with pytest.raises(TraceImportError, match="Invalid Trace URL"):
            parse_trace_url("")

    def test_veo_url_raises(self):
        with pytest.raises(TraceImportError, match="Invalid Trace URL"):
            parse_trace_url("https://app.veo.co/matches/some-match/")


class TestResolveTraceVideos:

    @pytest.mark.asyncio
    async def test_resolves_real_game(self):
        info = await resolve_trace_videos(TEST_TRACE_URL)

        assert isinstance(info, TraceGameInfo)
        assert info.game_id == 10046397
        assert len(info.videos) >= 2  # at least 2 halves

        for v in info.videos:
            assert v.m3u8_url.startswith("https://go.traceup.com/")
            assert "game_video.m3u8" in v.m3u8_url
            assert "superfly" not in v.m3u8_url

    @pytest.mark.asyncio
    async def test_extracts_metadata(self):
        info = await resolve_trace_videos(TEST_TRACE_URL)

        assert info.home_team is not None
        assert info.away_team is not None
        assert info.full_date is not None

    @pytest.mark.asyncio
    async def test_halves_sorted(self):
        info = await resolve_trace_videos(TEST_TRACE_URL)

        halves = [v.half for v in info.videos]
        assert halves == sorted(halves)

    @pytest.mark.asyncio
    async def test_invalid_game_id(self):
        with pytest.raises(TraceImportError, match="not found|private|error"):
            await resolve_trace_videos(
                "https://go.traceup.com/traceid/athlete/SD3TRsE6-/watch/99999999/players"
            )


class TestResolveBestVariant:

    @pytest.mark.asyncio
    async def test_picks_highest_quality(self):
        info = await resolve_trace_videos(TEST_TRACE_URL)
        variant_url = await resolve_best_variant(info.videos[0].m3u8_url)

        # Should pick the 1080p variant (video_3000k.m3u8)
        assert "video_" in variant_url
        assert variant_url.endswith(".m3u8")


class TestRemuxAndUpload:

    @pytest.mark.asyncio
    async def test_remux_first_10_segments(self, tmp_path):
        """Remux first ~20s of a half to MP4 to prove ffmpeg pipeline works."""
        info = await resolve_trace_videos(TEST_TRACE_URL)
        variant_url = await resolve_best_variant(info.videos[0].m3u8_url)

        output_path = str(tmp_path / "test_trace_half1.mp4")

        remux_hls_to_mp4(
            m3u8_url=variant_url,
            output_path=output_path,
            max_segments=10,  # ~20s of video
            timeout=120,
        )

        output = Path(output_path)
        assert output.exists()
        assert output.stat().st_size > 1_000_000  # >1MB for 20s of 1080p

    @requires_r2
    @pytest.mark.asyncio
    async def test_remux_and_upload_to_r2(self, tmp_path):
        """Full pipeline: HLS -> MP4 -> R2."""
        info = await resolve_trace_videos(TEST_TRACE_URL)
        variant_url = await resolve_best_variant(info.videos[0].m3u8_url)

        output_path = str(tmp_path / "test_trace_upload.mp4")
        test_r2_key = "games/_test_trace_import_poc.mp4"

        remux_hls_to_mp4(
            m3u8_url=variant_url,
            output_path=output_path,
            max_segments=5,  # ~10s, smaller for upload test
            timeout=120,
        )

        try:
            blake3_hash = upload_file_to_r2(output_path, test_r2_key)

            assert len(blake3_hash) == 64
            assert all(c in "0123456789abcdef" for c in blake3_hash)

            full_key = r2_global_key(test_r2_key)
            head = r2_head_object_global(full_key)
            assert head is not None
            assert head["ContentLength"] > 0
        finally:
            _cleanup_r2_object(test_r2_key)


def _cleanup_r2_object(r2_key: str):
    from app.storage import get_r2_client, R2_BUCKET, r2_global_key

    client = get_r2_client()
    if client:
        try:
            full_key = r2_global_key(r2_key)
            client.delete_object(Bucket=R2_BUCKET, Key=full_key)
        except Exception:
            pass
