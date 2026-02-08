"""
WebSocket connection management for real-time export progress updates.

This module handles WebSocket connections and progress tracking for video export operations.
"""

from fastapi import WebSocket, WebSocketDisconnect
from typing import Dict, List, Optional
import logging

from app.constants import ExportStatus

logger = logging.getLogger(__name__)

# Global progress tracking for exports
# Format: {export_id: {"progress": 0-100, "message": "...", "status": "processing|complete|error"}}
export_progress: Dict[str, dict] = {}


def make_progress_data(
    current: int,
    total: int,
    phase: str,
    message: str,
    export_type: str,
    done: bool = False,
    project_id: Optional[int] = None,
    project_name: Optional[str] = None,
    game_id: Optional[int] = None,
    game_name: Optional[str] = None,
) -> dict:
    """
    Create a properly formatted progress data object for WebSocket updates.

    This is the single source of truth for progress data formatting across all export types.
    Ensures correct status handling: 'error' phase → ERROR status, done → COMPLETE status.

    Args:
        current: Current progress value (0-100)
        total: Total progress value (usually 100)
        phase: Processing phase (init, download, processing, upload, done, error)
        message: Human-readable progress message
        export_type: Type of export (annotate, framing, overlay)
        done: Whether the export is complete
        project_id: Project ID (for framing/overlay exports)
        project_name: Project name (for framing/overlay exports)
        game_id: Game ID (for annotate exports)
        game_name: Game name (for annotate exports)

    Returns:
        Properly formatted progress data dict ready for WebSocket transmission
    """
    # Determine status - error phase means error status
    if phase == 'error':
        status = ExportStatus.ERROR
    elif done:
        status = ExportStatus.COMPLETE
    else:
        status = 'processing'

    return {
        'current': current,
        'total': total,
        'phase': phase,
        'message': message,
        'done': done,
        'progress': int((current / total) * 100) if total > 0 else 0,
        'status': status,
        'type': export_type,
        'projectId': project_id,
        'projectName': project_name,
        'gameId': game_id,
        'gameName': game_name,
        'error': message if phase == 'error' else None,
    }


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
            logger.debug(f"[WS Progress] No clients for {export_id}, dropping update: {data.get('progress', 0):.1f}%")
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

        # Progress logged at DEBUG level - summary logged by frontend at end
        if success_count > 0:
            logger.debug(f"[WS] {export_id[-8:]} {data.get('progress', 0):.0f}%")


# Global instance of the connection manager
manager = ConnectionManager()


class ExtractionConnectionManager:
    """
    Manages WebSocket connections for extraction status updates.

    Unlike exports, this is a broadcast channel - all clients receive all events.
    """

    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        """Accept a WebSocket connection"""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"[WS/Extraction] Client connected (now {len(self.active_connections)} clients)")

    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket connection"""
        try:
            self.active_connections.remove(websocket)
            logger.info(f"[WS/Extraction] Client disconnected ({len(self.active_connections)} clients remaining)")
        except ValueError:
            pass

    async def broadcast(self, data: dict):
        """Broadcast event to all connected clients"""
        if not self.active_connections:
            return

        failed = []
        for ws in self.active_connections:
            try:
                await ws.send_json(data)
            except Exception as e:
                logger.debug(f"[WS/Extraction] Client send failed: {e}")
                failed.append(ws)

        for ws in failed:
            self.disconnect(ws)

        if self.active_connections:
            logger.debug(f"[WS/Extraction] Broadcast to {len(self.active_connections)} client(s): {data.get('type')}")


# Global instance of the extraction connection manager
extraction_manager = ExtractionConnectionManager()


async def websocket_extractions(websocket: WebSocket):
    """
    WebSocket endpoint handler for extraction status updates.

    Clients connect here to receive notifications when extractions complete.
    """
    logger.info("[WS/Extraction] WebSocket endpoint hit")
    await extraction_manager.connect(websocket)
    try:
        while True:
            try:
                message = await websocket.receive_text()
                if message == 'ping':
                    try:
                        await websocket.send_text('pong')
                    except Exception:
                        break
            except WebSocketDisconnect:
                logger.info("[WS/Extraction] Client disconnected gracefully")
                break
    except Exception as e:
        logger.error(f"[WS/Extraction] WebSocket error: {e}")
    finally:
        extraction_manager.disconnect(websocket)


async def broadcast_extraction_event(event_type: str, clip_id: int, project_id: int = None, error: str = None):
    """
    Broadcast an extraction event to all listening clients.

    Called from modal_queue when extractions complete or fail.
    """
    data = {
        "type": event_type,  # extraction_complete, extraction_failed
        "clip_id": clip_id,
        "project_id": project_id,
    }
    if error:
        data["error"] = error

    await extraction_manager.broadcast(data)


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
