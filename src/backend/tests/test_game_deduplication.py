"""
Tests for T80: Global Game Deduplication

Tests for:
- BLAKE3 hash validation
- Multipart URL generation
- Reference count increment/decrement
- Prepare-upload endpoint logic
- Finalize-upload endpoint logic
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
import re


class TestBlake3HashValidation:
    """Test BLAKE3 hash format validation."""

    def test_valid_hash_lowercase(self):
        """Valid lowercase 64-char hex string should pass."""
        from app.routers.games_upload import validate_blake3_hash

        valid_hash = "a" * 64
        assert validate_blake3_hash(valid_hash) is True

    def test_valid_hash_mixed_hex(self):
        """Valid mixed hex characters should pass."""
        from app.routers.games_upload import validate_blake3_hash

        valid_hash = "0123456789abcdef" * 4
        assert validate_blake3_hash(valid_hash) is True

    def test_invalid_hash_too_short(self):
        """Hash shorter than 64 chars should fail."""
        from app.routers.games_upload import validate_blake3_hash

        short_hash = "a" * 63
        assert validate_blake3_hash(short_hash) is False

    def test_invalid_hash_too_long(self):
        """Hash longer than 64 chars should fail."""
        from app.routers.games_upload import validate_blake3_hash

        long_hash = "a" * 65
        assert validate_blake3_hash(long_hash) is False

    def test_invalid_hash_non_hex(self):
        """Non-hex characters should fail."""
        from app.routers.games_upload import validate_blake3_hash

        invalid_hash = "g" * 64  # 'g' is not valid hex
        assert validate_blake3_hash(invalid_hash) is False

    def test_valid_hash_uppercase_normalized(self):
        """Uppercase letters should pass (normalized to lowercase internally)."""
        from app.routers.games_upload import validate_blake3_hash

        # Implementation normalizes to lowercase before validation
        uppercase_hash = "A" * 64
        assert validate_blake3_hash(uppercase_hash) is True

        # Mixed case should also work
        mixed_hash = "AaBbCcDdEeFf" + "0" * 52
        assert validate_blake3_hash(mixed_hash) is True

    def test_valid_hash_with_numbers(self):
        """Hash with numbers and letters should pass."""
        from app.routers.games_upload import validate_blake3_hash

        valid_hash = "1234567890abcdef" * 4
        assert validate_blake3_hash(valid_hash) is True


class TestFileSizeValidation:
    """Test file size validation."""

    def test_valid_file_size(self):
        """Normal file sizes should pass."""
        from app.routers.games_upload import validate_file_size

        assert validate_file_size(1) is True
        assert validate_file_size(1024 * 1024) is True  # 1MB
        assert validate_file_size(1024 * 1024 * 1024) is True  # 1GB
        assert validate_file_size(4 * 1024 * 1024 * 1024) is True  # 4GB

    def test_invalid_file_size_zero(self):
        """Zero size should fail."""
        from app.routers.games_upload import validate_file_size

        assert validate_file_size(0) is False

    def test_invalid_file_size_negative(self):
        """Negative size should fail."""
        from app.routers.games_upload import validate_file_size

        assert validate_file_size(-1) is False

    def test_invalid_file_size_too_large(self):
        """Size over 10GB should fail."""
        from app.routers.games_upload import validate_file_size, MAX_FILE_SIZE

        assert validate_file_size(MAX_FILE_SIZE) is True
        assert validate_file_size(MAX_FILE_SIZE + 1) is False


class TestMultipartUrlGeneration:
    """Test multipart presigned URL generation."""

    @patch('app.storage.get_r2_client')
    def test_generates_correct_number_of_parts(self, mock_get_client):
        """Should generate correct number of parts based on file size."""
        from app.storage import generate_multipart_urls

        # Mock the client
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://example.com/upload"
        mock_get_client.return_value = mock_client

        # 250MB file with 100MB parts = 3 parts
        file_size = 250 * 1024 * 1024
        part_size = 100 * 1024 * 1024

        parts = generate_multipart_urls(
            key="games/test.mp4",
            upload_id="test-upload-id",
            file_size=file_size,
            part_size=part_size
        )

        assert len(parts) == 3
        assert parts[0]['part_number'] == 1
        assert parts[1]['part_number'] == 2
        assert parts[2]['part_number'] == 3

    @patch('app.storage.get_r2_client')
    def test_parts_have_correct_byte_ranges(self, mock_get_client):
        """Parts should have correct start_byte and end_byte."""
        from app.storage import generate_multipart_urls

        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://example.com/upload"
        mock_get_client.return_value = mock_client

        # 250MB file with 100MB parts
        file_size = 250 * 1024 * 1024
        part_size = 100 * 1024 * 1024

        parts = generate_multipart_urls(
            key="games/test.mp4",
            upload_id="test-upload-id",
            file_size=file_size,
            part_size=part_size
        )

        # Part 1: 0 to 99MB
        assert parts[0]['start_byte'] == 0
        assert parts[0]['end_byte'] == part_size - 1

        # Part 2: 100MB to 199MB
        assert parts[1]['start_byte'] == part_size
        assert parts[1]['end_byte'] == 2 * part_size - 1

        # Part 3: 200MB to 249MB (end of file)
        assert parts[2]['start_byte'] == 2 * part_size
        assert parts[2]['end_byte'] == file_size - 1

    @patch('app.storage.get_r2_client')
    def test_single_part_for_small_file(self, mock_get_client):
        """Small file should need only one part."""
        from app.storage import generate_multipart_urls

        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://example.com/upload"
        mock_get_client.return_value = mock_client

        # 50MB file with 100MB parts = 1 part
        file_size = 50 * 1024 * 1024
        part_size = 100 * 1024 * 1024

        parts = generate_multipart_urls(
            key="games/test.mp4",
            upload_id="test-upload-id",
            file_size=file_size,
            part_size=part_size
        )

        assert len(parts) == 1
        assert parts[0]['start_byte'] == 0
        assert parts[0]['end_byte'] == file_size - 1

    @patch('app.storage.get_r2_client')
    def test_returns_empty_when_no_client(self, mock_get_client):
        """Should return empty list when R2 client unavailable."""
        from app.storage import generate_multipart_urls

        mock_get_client.return_value = None

        parts = generate_multipart_urls(
            key="games/test.mp4",
            upload_id="test-upload-id",
            file_size=100 * 1024 * 1024,
            part_size=50 * 1024 * 1024
        )

        assert parts == []


class TestRefCountOperations:
    """Test reference count increment/decrement."""

    @patch('app.storage.r2_set_object_metadata_global')
    @patch('app.storage.r2_get_object_metadata_global')
    def test_increment_ref_count_new_object(self, mock_get_meta, mock_set_meta):
        """Incrementing ref_count on object with no metadata."""
        from app.storage import increment_ref_count

        # Object exists but has no ref_count metadata
        mock_get_meta.return_value = {}
        mock_set_meta.return_value = True

        result = increment_ref_count("games/test.mp4")

        assert result == 1
        mock_set_meta.assert_called_once()
        # Check that ref_count was set to "1"
        call_args = mock_set_meta.call_args
        assert call_args[0][1]['ref_count'] == '1'

    @patch('app.storage.r2_set_object_metadata_global')
    @patch('app.storage.r2_get_object_metadata_global')
    def test_increment_ref_count_existing(self, mock_get_meta, mock_set_meta):
        """Incrementing ref_count on object with existing count."""
        from app.storage import increment_ref_count

        # Object has ref_count = 5
        mock_get_meta.return_value = {'ref_count': '5'}
        mock_set_meta.return_value = True

        result = increment_ref_count("games/test.mp4")

        assert result == 6
        call_args = mock_set_meta.call_args
        assert call_args[0][1]['ref_count'] == '6'

    @patch('app.storage.r2_get_object_metadata_global')
    def test_increment_ref_count_missing_object(self, mock_get_meta):
        """Incrementing ref_count on non-existent object returns -1."""
        from app.storage import increment_ref_count

        mock_get_meta.return_value = None

        result = increment_ref_count("games/nonexistent.mp4")

        assert result == -1

    @patch('app.storage.r2_set_object_metadata_global')
    @patch('app.storage.r2_get_object_metadata_global')
    def test_decrement_ref_count(self, mock_get_meta, mock_set_meta):
        """Decrementing ref_count from 3 to 2."""
        from app.storage import decrement_ref_count

        mock_get_meta.return_value = {'ref_count': '3'}
        mock_set_meta.return_value = True

        result = decrement_ref_count("games/test.mp4")

        assert result == 2
        call_args = mock_set_meta.call_args
        assert call_args[0][1]['ref_count'] == '2'

    @patch('app.storage.r2_set_object_metadata_global')
    @patch('app.storage.r2_get_object_metadata_global')
    def test_decrement_ref_count_to_zero(self, mock_get_meta, mock_set_meta):
        """Decrementing ref_count from 1 to 0."""
        from app.storage import decrement_ref_count

        mock_get_meta.return_value = {'ref_count': '1'}
        mock_set_meta.return_value = True

        result = decrement_ref_count("games/test.mp4")

        assert result == 0
        call_args = mock_set_meta.call_args
        assert call_args[0][1]['ref_count'] == '0'

    @patch('app.storage.r2_set_object_metadata_global')
    @patch('app.storage.r2_get_object_metadata_global')
    def test_decrement_ref_count_never_negative(self, mock_get_meta, mock_set_meta):
        """Decrementing ref_count should never go below 0."""
        from app.storage import decrement_ref_count

        mock_get_meta.return_value = {'ref_count': '0'}
        mock_set_meta.return_value = True

        result = decrement_ref_count("games/test.mp4")

        assert result == 0
        call_args = mock_set_meta.call_args
        assert call_args[0][1]['ref_count'] == '0'

    @patch('app.storage.r2_get_object_metadata_global')
    def test_decrement_ref_count_missing_object(self, mock_get_meta):
        """Decrementing ref_count on non-existent object returns 0."""
        from app.storage import decrement_ref_count

        mock_get_meta.return_value = None

        result = decrement_ref_count("games/nonexistent.mp4")

        # Returns 0 so caller can clean up
        assert result == 0


class TestGlobalKeyHelpers:
    """Test global R2 key helper functions."""

    def test_r2_global_key_simple(self):
        """Simple path should have env prefix."""
        from app.storage import r2_global_key, APP_ENV

        assert r2_global_key("games/test.mp4") == f"{APP_ENV}/games/test.mp4"

    def test_r2_global_key_normalizes_backslashes(self):
        """Windows backslashes should be normalized to forward slashes."""
        from app.storage import r2_global_key, APP_ENV

        assert r2_global_key("games\\test.mp4") == f"{APP_ENV}/games/test.mp4"

    def test_r2_global_key_nested_path(self):
        """Nested paths should work."""
        from app.storage import r2_global_key, APP_ENV

        assert r2_global_key("games/2024/01/test.mp4") == f"{APP_ENV}/games/2024/01/test.mp4"


class TestHeadObjectGlobal:
    """Test r2_head_object_global function."""

    @patch('app.storage.get_r2_client')
    def test_returns_metadata_when_exists(self, mock_get_client):
        """Should return metadata dict when object exists."""
        from app.storage import r2_head_object_global

        mock_client = MagicMock()
        mock_client.head_object.return_value = {
            'ContentLength': 1024,
            'Metadata': {'ref_count': '1'},
            'ContentType': 'video/mp4',
            'LastModified': '2024-01-01T00:00:00Z'
        }
        mock_get_client.return_value = mock_client

        result = r2_head_object_global("games/test.mp4")

        assert result is not None
        assert result['ContentLength'] == 1024
        assert result['Metadata']['ref_count'] == '1'

    @patch('app.storage.get_r2_client')
    def test_returns_none_when_not_exists(self, mock_get_client):
        """Should return None when object doesn't exist."""
        from app.storage import r2_head_object_global

        mock_client = MagicMock()
        mock_client.head_object.side_effect = Exception("Not Found")
        mock_get_client.return_value = mock_client

        result = r2_head_object_global("games/nonexistent.mp4")

        assert result is None

    @patch('app.storage.get_r2_client')
    def test_returns_none_when_no_client(self, mock_get_client):
        """Should return None when R2 client unavailable."""
        from app.storage import r2_head_object_global

        mock_get_client.return_value = None

        result = r2_head_object_global("games/test.mp4")

        assert result is None


class TestMultipartUploadLifecycle:
    """Test multipart upload create/complete/abort functions."""

    @patch('app.storage.get_r2_client')
    def test_create_multipart_upload_returns_id(self, mock_get_client):
        """Should return upload ID on success."""
        from app.storage import r2_create_multipart_upload

        mock_client = MagicMock()
        mock_client.create_multipart_upload.return_value = {
            'UploadId': 'test-upload-id-123'
        }
        mock_get_client.return_value = mock_client

        result = r2_create_multipart_upload("games/test.mp4")

        assert result == 'test-upload-id-123'

    @patch('app.storage.get_r2_client')
    def test_create_multipart_upload_returns_none_on_error(self, mock_get_client):
        """Should return None on error."""
        from app.storage import r2_create_multipart_upload

        mock_client = MagicMock()
        mock_client.create_multipart_upload.side_effect = Exception("Error")
        mock_get_client.return_value = mock_client

        result = r2_create_multipart_upload("games/test.mp4")

        assert result is None

    @patch('app.storage.r2_set_object_metadata_global')
    @patch('app.storage.get_r2_client')
    def test_complete_multipart_upload_success(self, mock_get_client, mock_set_meta):
        """Should return True on successful completion."""
        from app.storage import r2_complete_multipart_upload

        mock_client = MagicMock()
        mock_client.complete_multipart_upload.return_value = {}
        mock_get_client.return_value = mock_client

        parts = [
            {'PartNumber': 1, 'ETag': '"abc"'},
            {'PartNumber': 2, 'ETag': '"def"'}
        ]

        result = r2_complete_multipart_upload(
            "games/test.mp4",
            "upload-id",
            parts
        )

        assert result is True

    @patch('app.storage.get_r2_client')
    def test_abort_multipart_upload_success(self, mock_get_client):
        """Should return True on successful abort."""
        from app.storage import r2_abort_multipart_upload

        mock_client = MagicMock()
        mock_get_client.return_value = mock_client

        result = r2_abort_multipart_upload("games/test.mp4", "upload-id")

        assert result is True
        mock_client.abort_multipart_upload.assert_called_once()
