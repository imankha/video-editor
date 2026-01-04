"""
FFmpeg Error Handling - Standardized error handling for FFmpeg operations.

This module provides:
- FFmpegError: Exception class with categorized error types
- run_ffmpeg(): Helper function for running FFmpeg commands with proper error handling
- Error categorization based on common FFmpeg error patterns

USAGE:
    from app.services.ffmpeg_errors import run_ffmpeg, FFmpegError, FFmpegErrorType

    # Run FFmpeg command with standardized error handling
    result = run_ffmpeg(['ffmpeg', '-i', 'input.mp4', 'output.mp4'])

    # Handle specific error types
    try:
        run_ffmpeg(cmd)
    except FFmpegError as e:
        if e.error_type == FFmpegErrorType.FILE_NOT_FOUND:
            # Handle missing file
        elif e.error_type == FFmpegErrorType.INVALID_DATA:
            # Handle corrupt input
"""

import subprocess
import logging
import re
from enum import Enum
from typing import List, Optional, Union
from pathlib import Path

logger = logging.getLogger(__name__)


class FFmpegErrorType(Enum):
    """Categorized FFmpeg error types for programmatic handling."""

    # File/path errors
    FILE_NOT_FOUND = "file_not_found"
    PERMISSION_DENIED = "permission_denied"
    DISK_FULL = "disk_full"

    # Input errors
    INVALID_DATA = "invalid_data"
    UNSUPPORTED_CODEC = "unsupported_codec"
    CORRUPT_FILE = "corrupt_file"

    # Processing errors
    FILTER_ERROR = "filter_error"
    ENCODER_ERROR = "encoder_error"
    OUT_OF_MEMORY = "out_of_memory"

    # General
    UNKNOWN = "unknown"
    COMMAND_NOT_FOUND = "command_not_found"


# Patterns to categorize FFmpeg errors
ERROR_PATTERNS = [
    # File errors
    (r"No such file or directory", FFmpegErrorType.FILE_NOT_FOUND),
    (r"does not exist", FFmpegErrorType.FILE_NOT_FOUND),
    (r"Permission denied", FFmpegErrorType.PERMISSION_DENIED),
    (r"No space left on device", FFmpegErrorType.DISK_FULL),
    (r"Disk quota exceeded", FFmpegErrorType.DISK_FULL),

    # Input errors
    (r"Invalid data found", FFmpegErrorType.INVALID_DATA),
    (r"Invalid argument", FFmpegErrorType.INVALID_DATA),
    (r"moov atom not found", FFmpegErrorType.CORRUPT_FILE),
    (r"End of file", FFmpegErrorType.CORRUPT_FILE),
    (r"Invalid NAL unit size", FFmpegErrorType.CORRUPT_FILE),
    (r"Decoder .* not found", FFmpegErrorType.UNSUPPORTED_CODEC),
    (r"Unknown decoder", FFmpegErrorType.UNSUPPORTED_CODEC),
    (r"Encoder .* not found", FFmpegErrorType.UNSUPPORTED_CODEC),
    (r"Unknown encoder", FFmpegErrorType.UNSUPPORTED_CODEC),

    # Processing errors
    (r"Error .* filter", FFmpegErrorType.FILTER_ERROR),
    (r"Filter .* error", FFmpegErrorType.FILTER_ERROR),
    (r"Cannot find a matching stream", FFmpegErrorType.FILTER_ERROR),
    (r"Error while encoding", FFmpegErrorType.ENCODER_ERROR),
    (r"Error initializing output", FFmpegErrorType.ENCODER_ERROR),
    (r"Out of memory", FFmpegErrorType.OUT_OF_MEMORY),
    (r"Cannot allocate memory", FFmpegErrorType.OUT_OF_MEMORY),
]


class FFmpegError(Exception):
    """
    Exception for FFmpeg command failures.

    Provides structured error information including:
    - error_type: Categorized error type for programmatic handling
    - stderr: Raw stderr output from FFmpeg
    - returncode: Exit code from FFmpeg process
    - command: The command that failed (optional, for debugging)

    Example:
        try:
            run_ffmpeg(cmd)
        except FFmpegError as e:
            if e.error_type == FFmpegErrorType.FILE_NOT_FOUND:
                return {"error": "Input file not found"}
            logger.error(f"FFmpeg failed: {e}")
    """

    def __init__(
        self,
        message: str,
        error_type: FFmpegErrorType = FFmpegErrorType.UNKNOWN,
        stderr: str = "",
        returncode: int = 1,
        command: Optional[List[str]] = None
    ):
        super().__init__(message)
        self.error_type = error_type
        self.stderr = stderr
        self.returncode = returncode
        self.command = command

    def __str__(self) -> str:
        return f"{self.args[0]} (type={self.error_type.value}, code={self.returncode})"

    @classmethod
    def from_stderr(
        cls,
        stderr: str,
        returncode: int = 1,
        command: Optional[List[str]] = None
    ) -> "FFmpegError":
        """
        Create an FFmpegError by analyzing stderr output.

        Automatically categorizes the error based on known patterns.
        """
        error_type = categorize_ffmpeg_error(stderr)
        message = extract_error_message(stderr)
        return cls(
            message=message,
            error_type=error_type,
            stderr=stderr,
            returncode=returncode,
            command=command
        )


def categorize_ffmpeg_error(stderr: str) -> FFmpegErrorType:
    """
    Analyze FFmpeg stderr and return a categorized error type.

    Args:
        stderr: The stderr output from FFmpeg

    Returns:
        FFmpegErrorType indicating the category of error
    """
    for pattern, error_type in ERROR_PATTERNS:
        if re.search(pattern, stderr, re.IGNORECASE):
            return error_type
    return FFmpegErrorType.UNKNOWN


def extract_error_message(stderr: str) -> str:
    """
    Extract a human-readable error message from FFmpeg stderr.

    FFmpeg stderr contains lots of verbose output. This function
    extracts the most relevant error line.

    Args:
        stderr: The stderr output from FFmpeg

    Returns:
        A concise error message
    """
    if not stderr:
        return "FFmpeg command failed"

    lines = stderr.strip().split('\n')

    # Look for explicit error lines
    for line in reversed(lines):
        line_lower = line.lower()
        if 'error' in line_lower or 'invalid' in line_lower:
            # Clean up the line
            clean_line = line.strip()
            if clean_line:
                return clean_line

    # Fall back to last non-empty line
    for line in reversed(lines):
        clean_line = line.strip()
        if clean_line:
            return clean_line

    return "FFmpeg command failed"


def run_ffmpeg(
    cmd: Union[List[str], str],
    timeout: Optional[int] = None,
    capture_output: bool = True,
    check: bool = True
) -> subprocess.CompletedProcess:
    """
    Run an FFmpeg command with standardized error handling.

    This is the preferred way to run FFmpeg commands in this codebase.
    It provides consistent error handling and logging.

    Args:
        cmd: Command as list or string
        timeout: Optional timeout in seconds
        capture_output: Whether to capture stdout/stderr (default True)
        check: Whether to raise FFmpegError on non-zero exit (default True)

    Returns:
        subprocess.CompletedProcess with stdout/stderr

    Raises:
        FFmpegError: If command fails and check=True
        FileNotFoundError: If ffmpeg/ffprobe is not installed

    Example:
        # Simple usage
        result = run_ffmpeg(['ffmpeg', '-i', 'input.mp4', 'output.mp4'])

        # With error handling
        try:
            result = run_ffmpeg(cmd)
        except FFmpegError as e:
            logger.error(f"Export failed: {e}")
            if e.error_type == FFmpegErrorType.FILE_NOT_FOUND:
                return {"error": "Input file missing"}
    """
    # Convert string to list if needed
    if isinstance(cmd, str):
        cmd = cmd.split()

    cmd_list = list(cmd)  # Ensure it's a list
    cmd_str = ' '.join(cmd_list[:3]) + '...' if len(cmd_list) > 3 else ' '.join(cmd_list)
    logger.debug(f"Running FFmpeg: {cmd_str}")

    try:
        result = subprocess.run(
            cmd_list,
            capture_output=capture_output,
            text=True,
            timeout=timeout
        )

        if check and result.returncode != 0:
            raise FFmpegError.from_stderr(
                stderr=result.stderr,
                returncode=result.returncode,
                command=cmd_list
            )

        return result

    except FileNotFoundError:
        # FFmpeg not installed
        exe = cmd_list[0] if cmd_list else "ffmpeg"
        raise FFmpegError(
            message=f"{exe} not found. Is FFmpeg installed?",
            error_type=FFmpegErrorType.COMMAND_NOT_FOUND,
            stderr="",
            returncode=-1,
            command=cmd_list
        )
    except subprocess.TimeoutExpired as e:
        raise FFmpegError(
            message=f"FFmpeg command timed out after {timeout}s",
            error_type=FFmpegErrorType.UNKNOWN,
            stderr=str(e),
            returncode=-1,
            command=cmd_list
        )


def run_ffmpeg_with_progress(
    cmd: List[str],
    progress_callback: Optional[callable] = None,
    timeout: Optional[int] = None
) -> subprocess.CompletedProcess:
    """
    Run FFmpeg with progress reporting via stderr parsing.

    For long-running exports, this allows progress tracking.
    Note: For real-time progress, consider using subprocess.Popen
    with the FFmpegProgressMonitor class instead.

    Args:
        cmd: FFmpeg command as list
        progress_callback: Optional callback(percent: float) for progress
        timeout: Optional timeout in seconds

    Returns:
        subprocess.CompletedProcess

    Raises:
        FFmpegError: If command fails
    """
    # For now, just run without progress (progress requires Popen + threading)
    # This is a placeholder for future enhancement
    return run_ffmpeg(cmd, timeout=timeout)
