"""
Tests for MessagePack encode/decode helpers (T1180).

Tests verify:
- encode_data produces msgpack bytes
- decode_data auto-detects JSON vs msgpack by first byte
- Round-trip: encode then decode preserves data exactly
- Backward compatibility: old JSON strings decode correctly
- Edge cases: None, empty structures, nested data
"""

import json
import pytest


class TestEncodeData:
    """Test encode_data helper."""

    def test_encode_dict(self):
        from app.utils.encoding import encode_data
        result = encode_data({"key": "value", "num": 42})
        assert isinstance(result, bytes)
        assert result[0:1] not in (b'{', b'[')

    def test_encode_list(self):
        from app.utils.encoding import encode_data
        result = encode_data([1, 2, 3])
        assert isinstance(result, bytes)

    def test_encode_none_returns_none(self):
        from app.utils.encoding import encode_data
        assert encode_data(None) is None

    def test_encode_complex_nested(self):
        from app.utils.encoding import encode_data
        data = {
            "keyframes": [
                {"frame": 0, "x": 100, "y": 50, "width": 640, "height": 360, "origin": "permanent"},
                {"frame": 150, "x": 120, "y": 60, "width": 640, "height": 360, "origin": "user"},
            ],
        }
        result = encode_data(data)
        assert isinstance(result, bytes)
        assert len(result) < len(json.dumps(data))

    def test_encode_empty_dict(self):
        from app.utils.encoding import encode_data
        result = encode_data({})
        assert isinstance(result, bytes)

    def test_encode_empty_list(self):
        from app.utils.encoding import encode_data
        result = encode_data([])
        assert isinstance(result, bytes)


class TestDecodeData:
    """Test decode_data helper."""

    def test_decode_none_returns_none(self):
        from app.utils.encoding import decode_data
        assert decode_data(None) is None

    def test_decode_json_string_dict(self):
        from app.utils.encoding import decode_data
        result = decode_data('{"key": "value"}')
        assert result == {"key": "value"}

    def test_decode_json_string_list(self):
        from app.utils.encoding import decode_data
        result = decode_data('[1, 2, 3]')
        assert result == [1, 2, 3]

    def test_decode_json_bytes_dict(self):
        from app.utils.encoding import decode_data
        result = decode_data(b'{"key": "value"}')
        assert result == {"key": "value"}

    def test_decode_json_bytes_list(self):
        from app.utils.encoding import decode_data
        result = decode_data(b'[1, 2, 3]')
        assert result == [1, 2, 3]

    def test_decode_msgpack_bytes(self):
        from app.utils.encoding import encode_data, decode_data
        original = {"key": "value", "num": 42}
        encoded = encode_data(original)
        result = decode_data(encoded)
        assert result == original

    def test_decode_empty_bytes(self):
        from app.utils.encoding import decode_data
        result = decode_data(b'')
        assert result is None


class TestRoundTrip:
    """Test encode → decode round trips."""

    def test_roundtrip_crop_data(self):
        from app.utils.encoding import encode_data, decode_data
        crop_data = [
            {"frame": 0, "x": 100, "y": 50, "width": 640, "height": 360, "origin": "permanent"},
            {"frame": 150, "x": 120, "y": 60, "width": 640, "height": 360, "origin": "user"},
            {"frame": 300, "x": 100, "y": 50, "width": 640, "height": 360, "origin": "permanent"},
        ]
        encoded = encode_data(crop_data)
        decoded = decode_data(encoded)
        assert decoded == crop_data

    def test_roundtrip_timing_data(self):
        from app.utils.encoding import encode_data, decode_data
        timing_data = {
            "trimRange": [0.5, 12.3],
            "playbackRate": 1.0,
        }
        encoded = encode_data(timing_data)
        decoded = decode_data(encoded)
        assert decoded == timing_data

    def test_roundtrip_segments_data(self):
        from app.utils.encoding import encode_data, decode_data
        segments_data = {
            "boundaries": [0, 3.5, 7.2, 10.0],
            "userSplits": [3.5, 7.2],
            "trimRange": [0, 10.0],
        }
        encoded = encode_data(segments_data)
        decoded = decode_data(encoded)
        assert decoded == segments_data

    def test_roundtrip_highlights_data(self):
        from app.utils.encoding import encode_data, decode_data
        highlights_data = [
            {
                "startFrame": 0,
                "endFrame": 90,
                "keyframes": [
                    {"frame": 0, "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.5},
                    {"frame": 90, "x": 0.15, "y": 0.25, "width": 0.5, "height": 0.5},
                ],
            },
        ]
        encoded = encode_data(highlights_data)
        decoded = decode_data(encoded)
        assert decoded == highlights_data

    def test_roundtrip_input_data(self):
        from app.utils.encoding import encode_data, decode_data
        input_data = {
            "project_id": 42,
            "job_type": "framing",
            "clips": [{"id": 1, "filename": "test.mp4"}],
            "settings": {"resolution": "1080p", "fps": 30},
        }
        encoded = encode_data(input_data)
        decoded = decode_data(encoded)
        assert decoded == input_data

    def test_roundtrip_preserves_float_precision(self):
        from app.utils.encoding import encode_data, decode_data
        data = {"trimRange": [0.123456789, 99.987654321]}
        encoded = encode_data(data)
        decoded = decode_data(encoded)
        assert decoded["trimRange"][0] == pytest.approx(0.123456789)
        assert decoded["trimRange"][1] == pytest.approx(99.987654321)


class TestBackwardCompatibility:
    """Test that old JSON data from DB is read correctly."""

    def test_old_json_string_from_db(self):
        """Simulate reading a TEXT column that contains a JSON string."""
        from app.utils.encoding import decode_data
        old_data = '[{"frame": 0, "x": 100}]'
        result = decode_data(old_data)
        assert result == [{"frame": 0, "x": 100}]

    def test_old_json_bytes_from_db(self):
        """Simulate reading bytes that are actually JSON (edge case)."""
        from app.utils.encoding import decode_data
        old_data = b'{"trimRange": [0, 10]}'
        result = decode_data(old_data)
        assert result == {"trimRange": [0, 10]}

    def test_new_msgpack_bytes_from_db(self):
        """Simulate reading msgpack bytes from BLOB column."""
        from app.utils.encoding import encode_data, decode_data
        original = [{"frame": 0, "x": 100}]
        msgpack_bytes = encode_data(original)
        result = decode_data(msgpack_bytes)
        assert result == original

    def test_first_byte_detection_dict(self):
        """Msgpack dict does NOT start with 0x7B."""
        from app.utils.encoding import encode_data
        encoded = encode_data({"a": 1})
        assert encoded[0:1] != b'{'

    def test_first_byte_detection_list(self):
        """Msgpack list does NOT start with 0x5B."""
        from app.utils.encoding import encode_data
        encoded = encode_data([1, 2])
        assert encoded[0:1] != b'['


class TestSizeReduction:
    """Verify msgpack produces smaller output than JSON."""

    def test_crop_data_smaller(self):
        from app.utils.encoding import encode_data
        crop_data = [
            {"frame": 0, "x": 100, "y": 50, "width": 640, "height": 360, "origin": "permanent"},
            {"frame": 150, "x": 120, "y": 60, "width": 640, "height": 360, "origin": "user"},
            {"frame": 300, "x": 100, "y": 50, "width": 640, "height": 360, "origin": "permanent"},
        ]
        json_size = len(json.dumps(crop_data).encode())
        msgpack_size = len(encode_data(crop_data))
        assert msgpack_size < json_size

    def test_highlights_data_smaller(self):
        from app.utils.encoding import encode_data
        highlights_data = [
            {
                "startFrame": i * 90,
                "endFrame": (i + 1) * 90,
                "keyframes": [
                    {"frame": i * 90, "x": 0.1, "y": 0.2, "width": 0.5, "height": 0.5},
                    {"frame": (i + 1) * 90, "x": 0.15, "y": 0.25, "width": 0.5, "height": 0.5},
                ],
            }
            for i in range(5)
        ]
        json_size = len(json.dumps(highlights_data).encode())
        msgpack_size = len(encode_data(highlights_data))
        assert msgpack_size < json_size
