"""
Tests for debug log endpoints (T2020).

Run with: pytest tests/test_debug_endpoints.py -v
"""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
AUTH = {"X-User-ID": "a", "X-Profile-ID": "testdefault"}

LOG_DIR = Path("/tmp/logs")


@pytest.fixture(autouse=True)
def _ensure_log_dir(tmp_path):
    """Patch LOG_DIR to a temp directory for test isolation."""
    test_log_dir = tmp_path / "logs"
    test_log_dir.mkdir()
    with patch("app.routers._debug.LOG_DIR", test_log_dir):
        yield test_log_dir


@pytest.fixture
def enable_debug():
    with patch("app.routers._debug.debug_endpoints_enabled", return_value=True):
        yield


@pytest.fixture
def disable_debug():
    with patch("app.routers._debug.debug_endpoints_enabled", return_value=False):
        yield


class TestListLogs:
    def test_returns_log_list(self, _ensure_log_dir, enable_debug):
        log_file = _ensure_log_dir / "app.log"
        log_file.write_text("line1\nline2\n")
        resp = client.get("/api/_debug/logs", headers=AUTH)
        assert resp.status_code == 200
        data = resp.json()
        assert "logs" in data
        assert len(data["logs"]) == 1
        entry = data["logs"][0]
        assert entry["name"] == "app.log"
        assert entry["size"] > 0
        assert "last_modified" in entry

    def test_empty_when_no_files(self, enable_debug):
        resp = client.get("/api/_debug/logs", headers=AUTH)
        assert resp.status_code == 200
        assert resp.json()["logs"] == []

    def test_404_when_disabled(self, disable_debug):
        resp = client.get("/api/_debug/logs", headers=AUTH)
        assert resp.status_code == 404


class TestReadLog:
    def test_tail_default(self, _ensure_log_dir, enable_debug):
        log_file = _ensure_log_dir / "app.log"
        lines = [f"line {i}" for i in range(300)]
        log_file.write_text("\n".join(lines))
        resp = client.get("/api/_debug/logs/app.log", headers=AUTH)
        assert resp.status_code == 200
        returned_lines = resp.text.split("\n")
        assert len(returned_lines) == 200
        assert returned_lines[-1] == "line 299"

    def test_tail_param(self, _ensure_log_dir, enable_debug):
        log_file = _ensure_log_dir / "app.log"
        lines = [f"line {i}" for i in range(50)]
        log_file.write_text("\n".join(lines))
        resp = client.get("/api/_debug/logs/app.log?tail=10", headers=AUTH)
        assert resp.status_code == 200
        returned_lines = resp.text.split("\n")
        assert len(returned_lines) == 10
        assert returned_lines[-1] == "line 49"

    def test_grep_filter(self, _ensure_log_dir, enable_debug):
        log_file = _ensure_log_dir / "app.log"
        log_file.write_text("INFO normal\nERROR bad thing\nINFO ok\nERROR another\n")
        resp = client.get("/api/_debug/logs/app.log?grep=ERROR", headers=AUTH)
        assert resp.status_code == 200
        returned_lines = resp.text.strip().split("\n")
        assert len(returned_lines) == 2
        assert all("ERROR" in l for l in returned_lines)

    def test_path_traversal_dotdot(self, enable_debug):
        resp = client.get("/api/_debug/logs/..%2Fetc%2Fpasswd", headers=AUTH)
        assert resp.status_code in (400, 404)

    def test_path_traversal_slash(self, enable_debug):
        resp = client.get("/api/_debug/logs/etc%2Fpasswd", headers=AUTH)
        assert resp.status_code in (400, 404)

    def test_path_traversal_backslash(self, enable_debug):
        resp = client.get("/api/_debug/logs/..%5Cetc%5Cpasswd", headers=AUTH)
        assert resp.status_code == 400

    def test_file_not_found(self, enable_debug):
        resp = client.get("/api/_debug/logs/nonexistent.log", headers=AUTH)
        assert resp.status_code == 404

    def test_404_when_disabled(self, disable_debug):
        resp = client.get("/api/_debug/logs/app.log", headers=AUTH)
        assert resp.status_code == 404
