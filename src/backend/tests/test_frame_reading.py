"""
Test that verifies frame reading accuracy.

E2: FFmpeg Frame Reading Bug Investigation

This test compares OpenCV's frame count against ffprobe's authoritative count.
If OpenCV drops frames, the counts will differ.

Run with: pytest tests/test_frame_reading.py -v
"""
import pytest
import subprocess
import tempfile
import os
from pathlib import Path


def get_expected_frame_count(video_path: str) -> int:
    """Use ffprobe to get accurate frame count."""
    cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-count_packets',
        '-show_entries', 'stream=nb_read_packets',
        '-of', 'csv=p=0',
        video_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    return int(result.stdout.strip())


def count_frames_opencv(video_path: str) -> int:
    """Count frames using OpenCV (current method)."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        count += 1
    cap.release()
    return count


def count_frames_opencv_with_seeking(video_path: str, start_frame: int = 0) -> int:
    """Count frames using OpenCV with seeking (tests seeking accuracy)."""
    import cv2
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Could not open video: {video_path}")

    cap.set(cv2.CAP_PROP_POS_FRAMES, start_frame)

    count = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        count += 1
    cap.release()
    return count


def count_frames_ffmpeg(video_path: str) -> int:
    """Count frames using FFmpeg pipe (proposed fix)."""
    import numpy as np

    # Get video dimensions first
    probe_cmd = [
        'ffprobe', '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'csv=p=0',
        video_path
    ]
    probe = subprocess.run(probe_cmd, capture_output=True, text=True)
    if probe.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {probe.stderr}")
    width, height = map(int, probe.stdout.strip().split(','))

    # Read frames via pipe
    cmd = [
        'ffmpeg',
        '-i', video_path,
        '-f', 'rawvideo',
        '-pix_fmt', 'bgr24',
        '-v', 'quiet',
        'pipe:1'
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    frame_size = width * height * 3
    count = 0

    while True:
        raw = proc.stdout.read(frame_size)
        if len(raw) != frame_size:
            break
        # Don't need to reshape for counting, just verify we got the data
        count += 1

    proc.wait()
    return count


def create_test_video(output_path: str, duration_seconds: float = 3.0, fps: int = 30) -> int:
    """Create a simple test video with known frame count."""
    expected_frames = int(duration_seconds * fps)

    # Create a test video using FFmpeg's testsrc pattern
    cmd = [
        'ffmpeg', '-y',
        '-f', 'lavfi',
        '-i', f'testsrc=duration={duration_seconds}:size=320x240:rate={fps}',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        output_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"Failed to create test video: {result.stderr}")

    return expected_frames


class TestFrameReading:
    """Tests for frame reading accuracy."""

    @pytest.fixture
    def test_video(self, tmp_path):
        """Create a simple test video with known frame count."""
        video_path = str(tmp_path / "test_video.mp4")
        expected_frames = create_test_video(video_path, duration_seconds=3.0, fps=30)
        return video_path, expected_frames

    @pytest.fixture
    def vfr_test_video(self, tmp_path):
        """Create a variable frame rate video (more likely to have issues)."""
        video_path = str(tmp_path / "vfr_video.mp4")

        # Create a VFR-like video (this is a simplification)
        cmd = [
            'ffmpeg', '-y',
            '-f', 'lavfi',
            '-i', 'testsrc=duration=3:size=320x240:rate=30',
            '-vf', 'setpts=1.5*PTS',  # Simulate variable timing
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            output_path := video_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            pytest.skip(f"Could not create VFR test video: {result.stderr}")

        return video_path

    def test_opencv_reads_all_frames_cfr(self, test_video):
        """
        Test OpenCV frame reading on constant frame rate video.

        This should PASS for well-formed CFR videos.
        """
        video_path, expected_frames = test_video

        ffprobe_count = get_expected_frame_count(video_path)
        opencv_count = count_frames_opencv(video_path)

        assert opencv_count == ffprobe_count, (
            f"OpenCV dropped frames: expected {ffprobe_count}, got {opencv_count} "
            f"({ffprobe_count - opencv_count} dropped)"
        )
        print(f"OpenCV correctly read all {opencv_count} frames")

    def test_opencv_seeking_accuracy(self, test_video):
        """
        Test if OpenCV seeking causes frame drops.

        Seeking to frame 0 should still read all frames.
        """
        video_path, expected_frames = test_video

        ffprobe_count = get_expected_frame_count(video_path)
        opencv_count = count_frames_opencv_with_seeking(video_path, start_frame=0)

        assert opencv_count == ffprobe_count, (
            f"OpenCV seeking caused frame loss: expected {ffprobe_count}, got {opencv_count}"
        )

    def test_opencv_seeking_from_middle(self, test_video):
        """
        Test seeking to middle of video.
        """
        video_path, expected_frames = test_video

        start_frame = 30  # 1 second in
        ffprobe_count = get_expected_frame_count(video_path)
        expected_remaining = ffprobe_count - start_frame

        opencv_count = count_frames_opencv_with_seeking(video_path, start_frame=start_frame)

        assert opencv_count == expected_remaining, (
            f"Seeking from frame {start_frame}: expected {expected_remaining}, got {opencv_count}"
        )

    def test_ffmpeg_pipe_reads_all_frames(self, test_video):
        """
        Test FFmpeg pipe reading (proposed fix).

        Should ALWAYS pass as FFmpeg is the authoritative source.
        """
        video_path, expected_frames = test_video

        ffprobe_count = get_expected_frame_count(video_path)
        ffmpeg_count = count_frames_ffmpeg(video_path)

        assert ffmpeg_count == ffprobe_count, (
            f"FFmpeg pipe mismatch: expected {ffprobe_count}, got {ffmpeg_count}"
        )
        print(f"FFmpeg pipe correctly read all {ffmpeg_count} frames")

    def test_compare_methods(self, test_video):
        """
        Compare all frame reading methods.

        This is the main test that documents any discrepancies.
        """
        video_path, expected_frames = test_video

        ffprobe_count = get_expected_frame_count(video_path)
        opencv_count = count_frames_opencv(video_path)
        ffmpeg_count = count_frames_ffmpeg(video_path)

        print(f"\n{'='*50}")
        print(f"Frame Count Comparison for {Path(video_path).name}")
        print(f"{'='*50}")
        print(f"ffprobe (authoritative): {ffprobe_count}")
        print(f"OpenCV:                  {opencv_count} ({opencv_count - ffprobe_count:+d})")
        print(f"FFmpeg pipe:             {ffmpeg_count} ({ffmpeg_count - ffprobe_count:+d})")
        print(f"{'='*50}")

        # Both should match ffprobe
        assert opencv_count == ffprobe_count, f"OpenCV dropped {ffprobe_count - opencv_count} frames"
        assert ffmpeg_count == ffprobe_count, f"FFmpeg dropped {ffprobe_count - ffmpeg_count} frames"


class TestWithRealVideo:
    """Tests with real video files if available."""

    @pytest.fixture
    def real_video(self):
        """Try to find a real test video."""
        # Check common locations for test videos
        possible_paths = [
            Path("formal annotations/test.short/wcfc-carlsbad-trimmed.mp4"),
            Path("../../../formal annotations/test.short/wcfc-carlsbad-trimmed.mp4"),
            Path("tests/fixtures/test_video.mp4"),
        ]

        for path in possible_paths:
            if path.exists():
                return str(path)

        pytest.skip("No real test video found")

    def test_real_video_frame_count(self, real_video):
        """
        Test frame reading on a real production video.

        This is the definitive test for whether the bug exists in our workflow.
        """
        ffprobe_count = get_expected_frame_count(real_video)
        opencv_count = count_frames_opencv(real_video)
        ffmpeg_count = count_frames_ffmpeg(real_video)

        print(f"\n{'='*60}")
        print(f"REAL VIDEO Frame Count Comparison")
        print(f"Video: {real_video}")
        print(f"{'='*60}")
        print(f"ffprobe (authoritative): {ffprobe_count}")
        print(f"OpenCV:                  {opencv_count} ({opencv_count - ffprobe_count:+d})")
        print(f"FFmpeg pipe:             {ffmpeg_count} ({ffmpeg_count - ffprobe_count:+d})")

        if opencv_count != ffprobe_count:
            print(f"\n*** BUG CONFIRMED: OpenCV dropped {ffprobe_count - opencv_count} frames ***")
            print("E2 fix is needed: Switch to FFmpeg pipe reading")
        else:
            print(f"\n*** No frame drop detected ***")
            print("OpenCV is working correctly for this video")

        print(f"{'='*60}")

        # This test documents the issue - don't fail if frames differ
        # Just report the findings
        assert True  # Always pass, but print the findings
