"""T16400: a paused Postgres answers a signed-in request within 5 s, never signs it out.

On 2026-11-13 the owner sat on "Connecting to server..." on prod. Two waits had no
limit: the server's session check against Postgres, and the connect to Postgres.
These tests put a pausable TCP proxy between the real pool and the dev Postgres.
Pausing it behaves like ``docker pause`` on the database: the socket stays open,
the kernel accepts bytes, and nothing ever answers. A server-side limit
(``statement_timeout``) cannot fire then; only a limit in the app can.
"""

import os
import socket
import threading
import time
from unittest.mock import patch

import psycopg2
import psycopg2.extensions
import pytest

from app.services import auth_db, pg

# conftest stubs pg.get_pg / pg.init_pg_pool; capture the real ones at collection.
_real_get_pg = pg.get_pg
_real_init_pg_pool = pg.init_pg_pool

pytestmark = pytest.mark.skipif(
    not os.environ.get("DATABASE_URL"), reason="needs a real Postgres (DATABASE_URL)"
)

USER_ID = "t16400-user"
LIMIT_S = 5.0
WATCHDOG_S = 15.0  # a red run hangs until the proxy resumes; resume after this


class PausableProxy:
    """TCP proxy to the dev Postgres whose forwarding can be paused and resumed."""

    def __init__(self, host, port):
        self.upstream = (host, port)
        self.running = threading.Event()
        self.running.set()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(64)
        self.port = self.listener.getsockname()[1]
        self.sockets = []
        self.closed = False
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while not self.closed:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            upstream = socket.create_connection(self.upstream)
            self.sockets += [client, upstream]
            threading.Thread(target=self._pump, args=(client, upstream), daemon=True).start()
            threading.Thread(target=self._pump, args=(upstream, client), daemon=True).start()

    def _pump(self, src, dst):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                self.running.wait()  # paused: hold the bytes, answer nothing
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def pause(self):
        self.running.clear()

    def resume(self):
        self.running.set()

    def close(self):
        self.closed = True
        self.running.set()
        self.listener.close()
        for s in self.sockets:
            try:
                s.close()
            except OSError:
                pass


@pytest.fixture
def proxy():
    params = psycopg2.extensions.parse_dsn(os.environ["DATABASE_URL"])
    p = PausableProxy(params["host"], int(params.get("port", 5432)))
    yield p
    p.close()


@pytest.fixture
def pool_via_proxy(pg_conn, proxy, monkeypatch):
    """The real pool, opened through the proxy as at server start."""
    from tests.conftest import register_test_user_ids
    register_test_user_ids(USER_ID)
    auth_db.create_user(USER_ID, email="t16400@example.com")
    session_id = auth_db.create_session(USER_ID)

    params = psycopg2.extensions.parse_dsn(os.environ["DATABASE_URL"])
    params.update(host="127.0.0.1", port=str(proxy.port))
    monkeypatch.setenv("DATABASE_URL", psycopg2.extensions.make_dsn(**params))
    saved = (pg._pool, pg._checkout_gate, dict(pg._last_returned))
    pg._pool = None
    pg._last_returned.clear()
    _real_init_pg_pool()
    monkeypatch.setattr(auth_db, "get_pg", _real_get_pg)
    try:
        yield session_id
    finally:
        proxy.resume()
        pg.close_pg_pool()
        pg._pool, pg._checkout_gate = saved[0], saved[1]
        pg._last_returned.clear()
        pg._last_returned.update(saved[2])


@pytest.fixture
def client(tmp_path):
    """The app served by a real uvicorn server, as in production.

    TestClient runs each request on its own event loop and joins that loop's worker
    threads when the request ends, so a thread still waiting on the paused database
    would hold the response; uvicorn answers as soon as the handler returns.
    """
    import httpx
    import uvicorn

    with patch("app.database.USER_DATA_BASE", tmp_path), \
         patch("app.services.user_db.USER_DATA_BASE", tmp_path), \
         patch.dict(os.environ, {"APP_ENV": "production"}):
        from app.main import app
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(
            app, host="127.0.0.1", port=port, lifespan="off", log_level="warning",
        ))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.05)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=60) as c:
            yield c
        server.should_exit = True
        thread.join(30)


def _timed_get(client, path, proxy):
    """GET path; if it is still waiting after WATCHDOG_S, resume the proxy so it ends."""
    out = {}

    def run():
        t0 = time.monotonic()
        out["resp"] = client.get(path)
        out["elapsed"] = time.monotonic() - t0

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(WATCHDOG_S)
    if worker.is_alive():
        proxy.resume()
        worker.join(30)
    return out["resp"], out["elapsed"]


def _assert_unavailable_not_signed_out(resp, elapsed, path):
    assert resp.status_code == 503, f"{path}: {resp.status_code} after {elapsed:.1f}s: {resp.text}"
    assert elapsed < LIMIT_S, f"{path}: answered after {elapsed:.1f}s (limit {LIMIT_S}s)"
    assert resp.headers.get("Retry-After"), f"{path}: 503 without Retry-After"
    assert "rb_session" not in resp.headers.get("set-cookie", ""), f"{path}: cookie touched"


@pytest.mark.parametrize("path", ["/api/auth/me", "/api/projects"])
def test_c1_paused_postgres_answers_503_within_5s(pool_via_proxy, proxy, client, path):
    client.cookies.set("rb_session", pool_via_proxy)
    proxy.pause()
    auth_db.clear_session_cache()  # a remembered session never asks Postgres (T16380)
    resp, elapsed = _timed_get(client, path, proxy)
    _assert_unavailable_not_signed_out(resp, elapsed, path)


def test_c1_new_connection_to_paused_postgres_gives_up(pool_via_proxy, proxy):
    """A fresh connect (pool refilling after a discard) must not wait forever."""
    proxy.pause()
    t0 = time.monotonic()
    out = {}

    def run():
        try:
            pg._pool._connect().close()
            out["error"] = None
        except psycopg2.OperationalError as e:
            out["error"] = e

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(WATCHDOG_S)
    elapsed = time.monotonic() - t0
    alive = worker.is_alive()
    proxy.resume()
    worker.join(30)
    assert not alive and isinstance(out["error"], psycopg2.OperationalError), (
        f"connect to a paused Postgres still waiting after {elapsed:.1f}s"
    )
    assert elapsed < LIMIT_S


def test_c2_after_resume_next_request_succeeds(pool_via_proxy, proxy, client):
    client.cookies.set("rb_session", pool_via_proxy)
    proxy.pause()
    auth_db.clear_session_cache()
    resp, elapsed = _timed_get(client, "/api/auth/me", proxy)
    _assert_unavailable_not_signed_out(resp, elapsed, "/api/auth/me")

    proxy.resume()
    deadline = time.monotonic() + 10
    while True:
        resp = client.get("/api/auth/me")
        if resp.status_code == 200 or time.monotonic() > deadline:
            break
        time.sleep(0.5)
    assert resp.status_code == 200, resp.text
    assert resp.json()["user_id"] == USER_ID
