"""T8440: download filenames carry the ReelBallers brand suffix."""
import pytest

from app.routers.downloads import generate_download_filename


@pytest.mark.parametrize("name,expected", [
    ("My Project", "My_Project_ReelBallers.mp4"),
    ("Goal!! vs. Team #2", "Goal_vs_Team_2_ReelBallers.mp4"),
    ("a-b_c", "a-b_c_ReelBallers.mp4"),
    (None, "video_ReelBallers.mp4"),
    ("!!!", "video_ReelBallers.mp4"),
])
def test_filename_branded_and_sanitized(name, expected):
    assert generate_download_filename(name) == expected
