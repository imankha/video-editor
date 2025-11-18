"""
Pytest configuration and shared fixtures for AI Upscaler tests
"""

import pytest
import numpy as np
from unittest.mock import Mock, MagicMock, patch


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
