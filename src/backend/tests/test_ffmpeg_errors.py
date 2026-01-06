"""
Tests for FFmpeg error handling module.
"""

import pytest
import subprocess
from unittest.mock import patch, MagicMock

from app.services.ffmpeg_errors import (
    FFmpegError,
    FFmpegErrorType,
    categorize_ffmpeg_error,
    extract_error_message,
    run_ffmpeg,
)


class TestFFmpegErrorType:
    """Tests for error type enumeration."""

    def test_all_error_types_have_string_values(self):
        """Each error type should have a meaningful string value."""
        for error_type in FFmpegErrorType:
            assert isinstance(error_type.value, str)
            assert len(error_type.value) > 0


class TestCategorizeFFmpegError:
    """Tests for error categorization logic."""

    def test_file_not_found(self):
        """Detects file not found errors."""
        stderr = "input.mp4: No such file or directory"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.FILE_NOT_FOUND

        stderr = "video.mp4 does not exist"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.FILE_NOT_FOUND

    def test_permission_denied(self):
        """Detects permission errors."""
        stderr = "Permission denied"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.PERMISSION_DENIED

    def test_disk_full(self):
        """Detects disk space errors."""
        stderr = "No space left on device"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.DISK_FULL

        stderr = "Disk quota exceeded"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.DISK_FULL

    def test_invalid_data(self):
        """Detects invalid data errors."""
        stderr = "Invalid data found when processing input"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.INVALID_DATA

        stderr = "Invalid argument"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.INVALID_DATA

    def test_corrupt_file(self):
        """Detects corrupt file errors."""
        stderr = "moov atom not found"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.CORRUPT_FILE

        stderr = "End of file"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.CORRUPT_FILE

        stderr = "Invalid NAL unit size"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.CORRUPT_FILE

    def test_unsupported_codec(self):
        """Detects codec errors."""
        stderr = "Decoder hevc not found"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.UNSUPPORTED_CODEC

        stderr = "Unknown decoder 'xyz'"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.UNSUPPORTED_CODEC

        stderr = "Encoder h264_nvenc not found"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.UNSUPPORTED_CODEC

    def test_filter_error(self):
        """Detects filter errors."""
        stderr = "Error initializing filter 'scale'"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.FILTER_ERROR

        stderr = "Cannot find a matching stream for input"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.FILTER_ERROR

    def test_encoder_error(self):
        """Detects encoder errors."""
        stderr = "Error while encoding frame 100"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.ENCODER_ERROR

        stderr = "Error initializing output stream"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.ENCODER_ERROR

    def test_out_of_memory(self):
        """Detects memory errors."""
        stderr = "Out of memory"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.OUT_OF_MEMORY

        stderr = "Cannot allocate memory"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.OUT_OF_MEMORY

    def test_unknown_error(self):
        """Falls back to unknown for unrecognized errors."""
        stderr = "Something completely unexpected happened"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.UNKNOWN

    def test_empty_stderr(self):
        """Handles empty stderr."""
        assert categorize_ffmpeg_error("") == FFmpegErrorType.UNKNOWN

    def test_case_insensitive(self):
        """Error matching is case-insensitive."""
        stderr = "NO SUCH FILE OR DIRECTORY"
        assert categorize_ffmpeg_error(stderr) == FFmpegErrorType.FILE_NOT_FOUND


class TestExtractErrorMessage:
    """Tests for error message extraction."""

    def test_extracts_error_line(self):
        """Finds and returns error lines."""
        stderr = """ffmpeg version 4.4
Input #0, mov,mp4
Stream #0:0: Video: h264
Error: Invalid data found when processing input"""
        msg = extract_error_message(stderr)
        assert "Invalid data" in msg

    def test_prefers_last_error(self):
        """Returns the most recent error line."""
        stderr = """Error: First error
Processing...
Error: Second error"""
        msg = extract_error_message(stderr)
        assert "Second error" in msg

    def test_fallback_to_last_line(self):
        """Falls back to last line if no error keyword."""
        stderr = """Some output
More output
Final line"""
        msg = extract_error_message(stderr)
        assert "Final line" in msg

    def test_empty_stderr(self):
        """Handles empty stderr gracefully."""
        msg = extract_error_message("")
        assert "FFmpeg command failed" in msg

    def test_strips_whitespace(self):
        """Cleans up whitespace in messages."""
        stderr = "   Error: Some issue   \n\n"
        msg = extract_error_message(stderr)
        assert msg.strip() == msg
        assert "Some issue" in msg


class TestFFmpegError:
    """Tests for FFmpegError exception class."""

    def test_basic_creation(self):
        """Creates error with all fields."""
        err = FFmpegError(
            message="Test error",
            error_type=FFmpegErrorType.FILE_NOT_FOUND,
            stderr="full stderr output",
            returncode=1,
            command=["ffmpeg", "-i", "input.mp4"]
        )
        assert str(err) == "Test error (type=file_not_found, code=1)"
        assert err.error_type == FFmpegErrorType.FILE_NOT_FOUND
        assert err.stderr == "full stderr output"
        assert err.returncode == 1
        assert err.command == ["ffmpeg", "-i", "input.mp4"]

    def test_from_stderr(self):
        """Creates error from stderr analysis."""
        stderr = "input.mp4: No such file or directory"
        err = FFmpegError.from_stderr(stderr, returncode=1)

        assert err.error_type == FFmpegErrorType.FILE_NOT_FOUND
        assert err.stderr == stderr
        assert err.returncode == 1
        assert "No such file" in str(err)

    def test_from_stderr_with_command(self):
        """Preserves command in from_stderr."""
        cmd = ["ffmpeg", "-i", "input.mp4", "output.mp4"]
        err = FFmpegError.from_stderr(
            stderr="Error",
            returncode=1,
            command=cmd
        )
        assert err.command == cmd

    def test_is_exception(self):
        """FFmpegError is a proper exception."""
        err = FFmpegError("Test")
        assert isinstance(err, Exception)

        with pytest.raises(FFmpegError):
            raise err


class TestRunFFmpeg:
    """Tests for run_ffmpeg helper function."""

    @patch('subprocess.run')
    def test_successful_command(self, mock_run):
        """Successful commands return CompletedProcess."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=['ffmpeg'],
            returncode=0,
            stdout="",
            stderr=""
        )

        result = run_ffmpeg(['ffmpeg', '-version'])

        assert result.returncode == 0
        mock_run.assert_called_once()

    @patch('subprocess.run')
    def test_failed_command_raises(self, mock_run):
        """Failed commands raise FFmpegError when check=True."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=['ffmpeg'],
            returncode=1,
            stdout="",
            stderr="No such file or directory"
        )

        with pytest.raises(FFmpegError) as exc_info:
            run_ffmpeg(['ffmpeg', '-i', 'missing.mp4', 'out.mp4'])

        assert exc_info.value.error_type == FFmpegErrorType.FILE_NOT_FOUND
        assert exc_info.value.returncode == 1

    @patch('subprocess.run')
    def test_check_false_no_raise(self, mock_run):
        """Failed commands don't raise when check=False."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=['ffmpeg'],
            returncode=1,
            stdout="",
            stderr="Error"
        )

        result = run_ffmpeg(['ffmpeg', '-i', 'input.mp4'], check=False)

        assert result.returncode == 1
        # No exception raised

    @patch('subprocess.run')
    def test_command_not_found(self, mock_run):
        """Handles missing ffmpeg executable."""
        mock_run.side_effect = FileNotFoundError()

        with pytest.raises(FFmpegError) as exc_info:
            run_ffmpeg(['ffmpeg', '-version'])

        assert exc_info.value.error_type == FFmpegErrorType.COMMAND_NOT_FOUND
        assert "not found" in str(exc_info.value).lower()

    @patch('subprocess.run')
    def test_timeout_handling(self, mock_run):
        """Handles command timeout."""
        mock_run.side_effect = subprocess.TimeoutExpired(cmd=['ffmpeg'], timeout=10)

        with pytest.raises(FFmpegError) as exc_info:
            run_ffmpeg(['ffmpeg', '-i', 'input.mp4'], timeout=10)

        assert "timed out" in str(exc_info.value).lower()

    @patch('subprocess.run')
    def test_passes_timeout(self, mock_run):
        """Passes timeout to subprocess."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=['ffmpeg'],
            returncode=0,
            stdout="",
            stderr=""
        )

        run_ffmpeg(['ffmpeg', '-version'], timeout=30)

        call_kwargs = mock_run.call_args[1]
        assert call_kwargs['timeout'] == 30

    @patch('subprocess.run')
    def test_string_command(self, mock_run):
        """Accepts command as string."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=['ffmpeg'],
            returncode=0,
            stdout="",
            stderr=""
        )

        run_ffmpeg('ffmpeg -version')

        # Should have been split
        call_args = mock_run.call_args[0][0]
        assert call_args == ['ffmpeg', '-version']

    @patch('subprocess.run')
    def test_preserves_command_in_error(self, mock_run):
        """Command is preserved in raised error."""
        mock_run.return_value = subprocess.CompletedProcess(
            args=['ffmpeg'],
            returncode=1,
            stdout="",
            stderr="Error"
        )
        cmd = ['ffmpeg', '-i', 'input.mp4', 'output.mp4']

        with pytest.raises(FFmpegError) as exc_info:
            run_ffmpeg(cmd)

        assert exc_info.value.command == cmd


class TestIntegration:
    """Integration tests with real FFmpeg (if available)."""

    @pytest.mark.skipif(True, reason="Requires FFmpeg installed")
    def test_real_ffmpeg_version(self):
        """Test with real FFmpeg."""
        result = run_ffmpeg(['ffmpeg', '-version'])
        assert result.returncode == 0
        assert 'ffmpeg version' in result.stdout.lower() or 'ffmpeg version' in result.stderr.lower()

    @pytest.mark.skipif(True, reason="Requires FFmpeg installed")
    def test_real_missing_file(self):
        """Test real error with missing file."""
        with pytest.raises(FFmpegError) as exc_info:
            run_ffmpeg(['ffmpeg', '-i', '/nonexistent/file.mp4', 'output.mp4'])

        assert exc_info.value.error_type == FFmpegErrorType.FILE_NOT_FOUND
