"""
Pytest configuration and shared fixtures for backend tests.
"""

import pytest
import numpy as np
from unittest.mock import Mock, MagicMock, patch


@pytest.fixture(autouse=True, scope="session")
def _set_default_profile_context():
    """Set a default profile context for all tests.

    T85a: All code paths that use r2_key() or get_user_data_path() now require
    a profile ID. This fixture ensures tests don't fail with "Profile ID not set"
    unless they explicitly reset_profile_id() to test that error case.

    Also pre-populates user_session_init's cache so middleware auto-resolve
    returns "testdefault" instead of doing R2 lookups for test users.
    """
    from app.profile_context import set_current_profile_id
    from app.session_init import _init_cache
    set_current_profile_id("testdefault")
    # Pre-populate the init cache for common test user IDs so middleware
    # auto-resolve doesn't create random profiles via R2
    for user_id in ("a", "testdefault"):
        _init_cache[user_id] = {"profile_id": "testdefault", "is_new_user": False}
    yield
    from app.profile_context import reset_profile_id
    reset_profile_id()
    _init_cache.clear()


@pytest.fixture
def mock_torch_cuda():
    """Mock torch.cuda to avoid requiring GPU"""
    with patch('torch.cuda.is_available', return_value=False), \
         patch('torch.cuda.device_count', return_value=0):
        yield


@pytest.fixture
def sample_frame():
    """Create a sample video frame for testing"""
    return np.random.randint(0, 255, (480, 640, 3), dtype=np.uint8)


@pytest.fixture
def sample_keyframes():
    """Create sample keyframes for testing"""
    return [
        {'time': 0.0, 'x': 0, 'y': 0, 'width': 640, 'height': 360},
        {'time': 5.0, 'x': 50, 'y': 50, 'width': 800, 'height': 450},
        {'time': 10.0, 'x': 100, 'y': 100, 'width': 1280, 'height': 720}
    ]


@pytest.fixture
def sample_highlight_keyframes():
    """Create sample highlight keyframes for testing"""
    return [
        {
            'time': 0.0,
            'highlights': [
                {'x': 100, 'y': 100, 'width': 200, 'height': 150, 'label': 'Player 1'}
            ]
        },
        {
            'time': 5.0,
            'highlights': [
                {'x': 200, 'y': 150, 'width': 250, 'height': 180, 'label': 'Player 1'}
            ]
        }
    ]
