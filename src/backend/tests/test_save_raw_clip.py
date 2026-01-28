"""
Tests for save_raw_clip endpoint - specifically testing that imports are properly scoped.

This test catches the bug where a local import inside a function shadows the module-level
import, causing UnboundLocalError for functions used before the local import line.
"""

import pytest
from unittest.mock import patch, MagicMock, AsyncMock
import json


class TestSaveRawClipImports:
    """Test that save_raw_clip doesn't have import shadowing issues."""

    @pytest.mark.asyncio
    async def test_save_raw_clip_with_modal_enabled_no_import_error(self):
        """
        Verify save_raw_clip works with Modal enabled.

        This catches the bug where:
            from app.services.modal_client import call_modal_extract_clip
        inside a function shadows the module-level import for the entire function,
        causing UnboundLocalError when call_modal_extract_clip is used before that line.
        """
        from app.routers.clips import save_raw_clip, RawClipCreate

        clip_data = RawClipCreate(
            game_id=13,
            start_time=100.0,
            end_time=115.0,
            rating=4,
            tags=["Dribble"],
            name="Test Clip",
            notes=""
        )

        # Mock the database connection
        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [
            # First call: check existing clip - none exists
            None,
            # Second call: get game info
            {'video_filename': 'test_video.mp4'}
        ]
        mock_cursor.lastrowid = 999

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        # Mock Modal as enabled and successful
        mock_modal_result = {"status": "success", "output_key": "raw_clips/test.mp4"}

        with patch('app.routers.clips.get_db_connection', return_value=mock_conn), \
             patch('app.routers.clips.modal_enabled', return_value=True), \
             patch('app.routers.clips.call_modal_extract_clip', new_callable=AsyncMock, return_value=mock_modal_result), \
             patch('app.routers.clips.get_current_user_id', return_value='test_user'):

            # This should NOT raise UnboundLocalError
            try:
                result = await save_raw_clip(clip_data)
                # If we get here without UnboundLocalError, the import shadowing bug is fixed
                assert result is not None
            except UnboundLocalError as e:
                if 'call_modal_extract_clip' in str(e):
                    pytest.fail(
                        "UnboundLocalError for call_modal_extract_clip - "
                        "likely caused by a local import shadowing the module-level import. "
                        "Remove any 'from app.services.modal_client import call_modal_extract_clip' "
                        "statements inside functions."
                    )
                raise


    @pytest.mark.asyncio
    async def test_update_raw_clip_with_modal_enabled_no_import_error(self):
        """
        Verify update_raw_clip works with Modal enabled (re-extraction path).
        """
        from app.routers.clips import update_raw_clip, RawClipCreate

        clip_data = RawClipCreate(
            game_id=13,
            start_time=50.0,  # Different start time triggers re-extraction
            end_time=115.0,
            rating=5,
            tags=["Pass"],
            name="Updated Clip",
            notes=""
        )

        # Mock existing clip with different start_time
        existing_clip = {
            'id': 100,
            'start_time': 100.0,  # Original was 100, new is 50
            'end_time': 115.0,
            'filename': 'existing.mp4',
            'game_id': 13,
            'rating': 4,
            'tags': '["Dribble"]',
            'name': 'Old Name',
            'notes': '',
            'auto_project_id': None
        }

        mock_cursor = MagicMock()
        mock_cursor.fetchone.side_effect = [
            existing_clip,  # Get existing clip
            {'video_filename': 'test_video.mp4'}  # Get game info
        ]

        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        mock_conn.__enter__ = MagicMock(return_value=mock_conn)
        mock_conn.__exit__ = MagicMock(return_value=False)

        mock_modal_result = {"status": "success"}

        with patch('app.routers.clips.get_db_connection', return_value=mock_conn), \
             patch('app.routers.clips.modal_enabled', return_value=True), \
             patch('app.routers.clips.call_modal_extract_clip', new_callable=AsyncMock, return_value=mock_modal_result), \
             patch('app.routers.clips.get_current_user_id', return_value='test_user'):

            try:
                result = await update_raw_clip(100, clip_data)
                assert result is not None
            except UnboundLocalError as e:
                if 'call_modal_extract_clip' in str(e):
                    pytest.fail(
                        "UnboundLocalError for call_modal_extract_clip in update_raw_clip - "
                        "remove local import that shadows module-level import."
                    )
                raise
