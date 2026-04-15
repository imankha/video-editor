"""
Tests for save_raw_clip endpoint and modal_queue service.

These tests verify that:
1. Imports are properly scoped (no shadowing issues)
2. The modal queue service can be imported and used correctly
"""

import pytest
from unittest.mock import patch, MagicMock


class TestModalQueueImports:
    """Test that modal queue service imports work correctly."""

    def test_modal_queue_imports_without_errors(self):
        """
        Verify modal_queue.py imports work correctly.
        """
        from app.services.modal_queue import (
            process_modal_queue,
        )

        assert callable(process_modal_queue)

    def test_modal_client_imports_without_errors(self):
        """
        Verify modal_client.py imports work correctly.
        """
        from app.services.modal_client import modal_enabled

        assert callable(modal_enabled)

    def test_clips_router_imports_without_errors(self):
        """
        Verify clips.py router imports work correctly.

        This catches circular import issues between routers and services.
        """
        from app.routers.clips import (
            save_raw_clip,
            update_raw_clip,
            RawClipCreate,
        )

        assert callable(save_raw_clip)
        assert callable(update_raw_clip)
        assert RawClipCreate is not None
