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

        This catches import issues where modal_enabled or call_modal_extract_clip
        might have circular imports or other import problems.
        """
        # This import should work without any errors
        from app.services.modal_queue import (
            enqueue_clip_extraction,
            process_modal_queue,
        )

        # Verify the functions are callable
        assert callable(enqueue_clip_extraction)
        assert callable(process_modal_queue)

    def test_modal_client_imports_without_errors(self):
        """
        Verify modal_client.py imports work correctly.
        """
        from app.services.modal_client import (
            modal_enabled,
            call_modal_extract_clip,
        )

        assert callable(modal_enabled)
        assert callable(call_modal_extract_clip)

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


class TestEnqueueClipExtraction:
    """Test the enqueue_clip_extraction function."""

    def test_enqueue_creates_pending_task(self):
        """
        Verify enqueue_clip_extraction creates a task in the database.
        """
        from app.services.modal_queue import enqueue_clip_extraction

        # Mock the database
        mock_cursor = MagicMock()
        mock_cursor.lastrowid = 42

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        with patch('app.services.modal_queue.get_db_connection', return_value=mock_conn):
            task_id = enqueue_clip_extraction(
                clip_id=1,
                project_id=10,
                game_id=100,
                video_filename="test_game.mp4",
                start_time=10.0,
                end_time=25.0,
                user_id="test_user"
            )

        assert task_id == 42

        # Verify the INSERT was called
        mock_cursor.execute.assert_called_once()
        call_args = mock_cursor.execute.call_args
        assert "INSERT INTO modal_tasks" in call_args[0][0]
        assert "'pending'" in call_args[0][0] or 'pending' in str(call_args[0][1])
