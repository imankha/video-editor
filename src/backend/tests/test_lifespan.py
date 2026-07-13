"""T5060: verify the fastapi lifespan= handler still runs the startup/shutdown
work the old @app.on_event handlers did.

The only runtime-behavior change in T5060 was moving app startup/shutdown from
the deprecated @app.on_event("startup"/"shutdown") decorators to a lifespan
context manager. This test drives the lifespan via TestClient's context-manager
protocol and asserts the shutdown branch still closes the Postgres pool and
stops the background loops.
"""

from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.main import app


def test_lifespan_shutdown_closes_pg_pool():
    """Entering/exiting the TestClient context runs lifespan startup then
    shutdown; the shutdown branch must close the PG pool (was on_event before)."""
    with patch("app.services.sweep_scheduler.start_sweep_loop", new_callable=AsyncMock), \
         patch("app.services.sweep_scheduler.stop_sweep_loop", new_callable=AsyncMock) as mock_stop_sweep, \
         patch("app.services.pg.close_pg_pool") as mock_close_pool:
        # Context-manager entry runs startup, exit runs shutdown.
        with TestClient(app):
            pass

    mock_close_pool.assert_called_once()
    mock_stop_sweep.assert_called_once()
