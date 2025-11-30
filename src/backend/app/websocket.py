"""
WebSocket connection management for real-time export progress updates.

This module handles WebSocket connections and progress tracking for video export operations.
"""

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict
import logging

logger = logging.getLogger(__name__)

# Global progress tracking for exports
# Format: {export_id: {"progress": 0-100, "message": "...", "status": "processing|complete|error"}}
export_progress: Dict[str, dict] = {}


class ConnectionManager:
    """
    Manages WebSocket connections for export progress updates.

    Stores active connections by export_id and provides methods for:
    - Connecting new WebSocket clients
    - Disconnecting clients
    - Sending progress updates
    """

    def __init__(self):
        # Store active connections by export_id
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, export_id: str, websocket: WebSocket):
        """Accept a WebSocket connection and store it by export_id"""
        await websocket.accept()
        self.active_connections[export_id] = websocket
        logger.info(f"WebSocket connected for export_id: {export_id}")

    def disconnect(self, export_id: str):
        """Remove a WebSocket connection"""
        if export_id in self.active_connections:
            del self.active_connections[export_id]
            logger.info(f"WebSocket disconnected for export_id: {export_id}")

    async def send_progress(self, export_id: str, data: dict):
        """Send progress update to a specific export's WebSocket connection"""
        if export_id in self.active_connections:
            try:
                await self.active_connections[export_id].send_json(data)
            except Exception as e:
                logger.error(f"Error sending progress to {export_id}: {e}")
                self.disconnect(export_id)


# Global instance of the connection manager
manager = ConnectionManager()


async def websocket_export_progress(websocket: WebSocket, export_id: str):
    """
    WebSocket endpoint handler for real-time export progress updates.

    This function should be registered as a WebSocket endpoint in the main app
    or a router.
    """
    await manager.connect(export_id, websocket)
    try:
        # Keep connection alive and wait for messages
        while True:
            # Wait for any message from client (ping/pong)
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
    except Exception as e:
        logger.error(f"WebSocket error for {export_id}: {e}")
    finally:
        manager.disconnect(export_id)
