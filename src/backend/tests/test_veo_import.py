"""
Integration tests for Veo server-to-server import.

Tests the full pipeline: URL parsing → HTML fetch → CDN URL extraction →
download verification → stream to R2. Uses real Veo URLs (no mocks).

Run with: cd src/backend && .venv/Scripts/python.exe -m pytest tests/test_veo_import.py -v
"""

import pytest

# Load .env before any app imports (other tests get this via `from app.main import app`)
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).parent.parent.parent.parent / ".env")

from app.services.veo_import import (
    parse_veo_url,
    resolve_veo_download_url,
    stream_to_r2,
    VeoImportError,
    VeoVideoInfo,
)
from app.storage import (
    r2_head_object_global,
    r2_global_key,
    R2_ENABLED,
)

# Real Veo match URL for testing (verified 2026-05-04)
TEST_VEO_URL = "https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/"

requires_r2 = pytest.mark.skipif(
    not R2_ENABLED,
    reason="R2 not enabled — set R2_ENABLED=true with valid credentials"
)


class TestParseVeoUrl:
    """Unit tests for URL parsing (no network)."""

    def test_standard_url(self):
        slug = parse_veo_url("https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/")
        assert slug == "20260502-may-2-2026-42640-pm-v09accc3"

    def test_no_trailing_slash(self):
        slug = parse_veo_url("https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3")
        assert slug == "20260502-may-2-2026-42640-pm-v09accc3"

    def test_with_query_params(self):
        slug = parse_veo_url("https://app.veo.co/matches/20260502-may-2-2026-42640-pm-v09accc3/?utm_source=email")
        assert slug == "20260502-may-2-2026-42640-pm-v09accc3"

    def test_invalid_url_raises(self):
        with pytest.raises(VeoImportError, match="Invalid Veo URL"):
            parse_veo_url("https://youtube.com/watch?v=abc123")

    def test_empty_string_raises(self):
        with pytest.raises(VeoImportError, match="Invalid Veo URL"):
            parse_veo_url("")

    def test_veo_non_match_url_raises(self):
        with pytest.raises(VeoImportError, match="Invalid Veo URL"):
            parse_veo_url("https://app.veo.co/clubs/some-club/")


class TestResolveVeoDownloadUrl:
    """Integration tests — hits real Veo servers (no R2 needed)."""

    @pytest.mark.asyncio
    async def test_resolves_real_url(self):
        info = await resolve_veo_download_url(TEST_VEO_URL)

        assert isinstance(info, VeoVideoInfo)
        assert "download.veocdn.com" in info.download_url
        assert info.download_url.endswith("/video.mp4")
        assert info.file_size > 100_000_000  # >100MB (game videos are 500MB-3GB)

    @pytest.mark.asyncio
    async def test_extracts_title(self):
        info = await resolve_veo_download_url(TEST_VEO_URL)

        # og:title contains team names (e.g. "WCFC vs Rebels SC")
        assert info.title is not None
        assert len(info.title) > 0

    @pytest.mark.asyncio
    async def test_invalid_match_url(self):
        with pytest.raises(VeoImportError, match="not found|private|unexpected"):
            await resolve_veo_download_url("https://app.veo.co/matches/nonexistent-match-id-12345/")


@requires_r2
class TestStreamToR2:
    """Integration tests — downloads from Veo CDN and uploads to R2."""

    @pytest.mark.asyncio
    async def test_stream_first_10mb(self):
        """Stream first 10MB to R2 to verify the pipeline works end-to-end."""
        info = await resolve_veo_download_url(TEST_VEO_URL)

        # Use a test-specific R2 key that we'll clean up
        test_r2_key = "games/_test_veo_import_poc.mp4"

        try:
            blake3_hash = await stream_to_r2(
                download_url=info.download_url,
                r2_key=test_r2_key,
                expected_size=info.file_size,
                max_bytes=10 * 1024 * 1024,  # Only download 10MB for testing
            )

            # Verify hash is valid format
            assert len(blake3_hash) == 64
            assert all(c in "0123456789abcdef" for c in blake3_hash)

            # Verify object exists in R2
            full_key = r2_global_key(test_r2_key)
            head = r2_head_object_global(full_key)
            assert head is not None
            assert head["ContentLength"] > 0

        finally:
            # Cleanup: delete test object from R2
            _cleanup_r2_object(test_r2_key)


def _cleanup_r2_object(r2_key: str):
    """Delete a test object from R2."""
    from app.storage import get_r2_client, R2_BUCKET, r2_global_key

    client = get_r2_client()
    if client:
        try:
            full_key = r2_global_key(r2_key)
            client.delete_object(Bucket=R2_BUCKET, Key=full_key)
        except Exception:
            pass
