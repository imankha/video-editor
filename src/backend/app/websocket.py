"""
WebSocket connection management for real-time export progress updates.

This module handles WebSocket connections and progress tracking for video export operations.
"""

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List
import logging

logger = logging.getLogger(__name__)

# Global progress tracking for exports
# Format: {export_id: {"progress": 0-100, "message": "...", "status": "processing|complete|error"}}
export_progress: Dict[str, dict] = {}


class ConnectionManager:
    """
    Manages WebSocket connections for export progress updates.

    Stores active connections by export_id and provides methods for:
    - Connecting new WebSocket clients (supports multiple clients per export)
    - Disconnecting clients
    - Broadcasting progress updates to all clients
    """

    def __init__(self):
        # Store active connections by export_id (multiple connections per export supported)
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, export_id: str, websocket: WebSocket):
        """Accept a WebSocket connection and add it to the list for this export_id"""
        await websocket.accept()
        if export_id not in self.active_connections:
            self.active_connections[export_id] = []
        self.active_connections[export_id].append(websocket)
        logger.info(f"[WS] WebSocket CONNECTED for export_id: {export_id} (now {len(self.active_connections[export_id])} clients)")

    def disconnect(self, export_id: str, websocket: WebSocket = None):
        """Remove a WebSocket connection"""
        if export_id in self.active_connections:
            if websocket:
                # Remove specific websocket
                try:
                    self.active_connections[export_id].remove(websocket)
                    logger.info(f"WebSocket disconnected for export_id: {export_id} ({len(self.active_connections[export_id])} clients remaining)")
                except ValueError:
                    pass  # WebSocket not in list
                # Clean up empty lists
                if not self.active_connections[export_id]:
                    del self.active_connections[export_id]
            else:
                # Remove all connections for this export_id
                del self.active_connections[export_id]
                logger.info(f"All WebSockets disconnected for export_id: {export_id}")

    async def send_progress(self, export_id: str, data: dict):
        """
        Broadcast progress update to all WebSocket connections for this export.

        This is fire-and-forget: if no clients are connected, the update is
        silently dropped. This is expected behavior - the export continues
        regardless of whether anyone is watching.
        """
        if export_id not in self.active_connections:
            # No one listening - that's fine, export continues silently
            return

        connections = self.active_connections[export_id]
        failed_connections = []
        success_count = 0

        for ws in connections:
            try:
                await ws.send_json(data)
                success_count += 1
            except Exception as e:
                # Client disconnected, will be cleaned up
                logger.debug(f"[WS] Client disconnected for {export_id}: {e}")
                failed_connections.append(ws)

        # Remove failed connections
        for ws in failed_connections:
            self.disconnect(export_id, ws)

        if success_count > 0:
            logger.debug(f"[WS] Sent progress to {success_count} client(s) for {export_id}: {data.get('progress', 0):.1f}%")


# Global instance of the connection manager
manager = ConnectionManager()


async def websocket_export_progress(websocket: WebSocket, export_id: str):
    """
    WebSocket endpoint handler for real-time export progress updates.

    This function should be registered as a WebSocket endpoint in the main app
    or a router.

    Features:
    - Responds to client 'ping' messages with 'pong' to keep connection alive
    - Handles graceful disconnection
    """
    logger.info(f"[WS] WebSocket endpoint HIT for export_id: {export_id}")
    await manager.connect(export_id, websocket)
    try:
        # Keep connection alive and wait for messages
        while True:
            # Wait for any message from client (ping/pong)
            try:
                message = await websocket.receive_text()
                # Respond to ping with pong to keep connection alive
                if message == 'ping':
                    try:
                        await websocket.send_text('pong')
                        logger.debug(f"[WS] Responded to ping from {export_id}")
                    except Exception as e:
                        logger.warning(f"[WS] Failed to send pong to {export_id}: {e}")
                        break
            except WebSocketDisconnect:
                logger.info(f"[WS] Client disconnected gracefully for {export_id}")
                break
    except Exception as e:
        logger.error(f"[WS] WebSocket error for {export_id}: {e}")
    finally:
        manager.disconnect(export_id, websocket)
