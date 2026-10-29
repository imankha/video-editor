"""T13930: every [R2_CALL] carries source=, and every call is counted by
(day, env, source, op_class, op).

Runs the PRODUCTION hook path: a real boto3 client with storage._register_r2_timing,
only the HTTP send replaced (tests/r2_fake_transport.py).

Run with: pytest tests/test_t13930_r2_source_tagging.py -v
"""

import contextvars
import logging
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import cv2
import numpy as np
import pytest
from botocore.exceptions import ClientError
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.routing import Mount

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app import r2_usage, storage
from app.main import app
from app.services.user_db import create_profile, ensure_user_database, set_selected_profile_id
from app.user_context import set_current_req_id

INTRO_TEMPLATE = "POST /api/profiles/{profile_id}/intro/image"
_SOURCE_RE = re.compile(r'source="([^"]*)"')


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _count(source: str, op_class: str, op: str) -> int:
    return r2_usage.usage_buffer().peek().get((_today(), storage.APP_ENV, source, op_class, op), 0)


def _r2_lines(caplog) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.getMessage().startswith("[R2_CALL]")]


@pytest.fixture
def fake_r2():
    fake = FakeR2Transport()
    with fake.patched_storage_clients():
        yield fake


def _jpeg_bytes() -> bytes:
    ok, buf = cv2.imencode(".jpg", np.full((48, 64, 3), 128, dtype=np.uint8))
    assert ok
    return buf.tobytes()


def _post_intro_image(caplog):
    uid, pid = f"t13930_{uuid4().hex[:8]}", uuid4().hex[:8]
    ensure_user_database(uid)
    create_profile(uid, pid, "Marcus", "#3B82F6", is_default=True)
    set_selected_profile_id(uid, pid)
    with caplog.at_level(logging.INFO, logger="app.storage"):
        caplog.clear()
        resp = TestClient(app).post(
            f"/api/profiles/{pid}/intro/image",
            headers={"X-User-ID": uid, "X-Profile-ID": pid},
            files={"image": ("photo.jpg", _jpeg_bytes(), "image/jpeg")},
        )
    assert resp.status_code == 200, resp.text
    return pid


def test_call_outside_any_context_logs_source_untagged(fake_r2, caplog):
    before = _count("untagged", "B", "HeadObject")

    def head_missing():
        with pytest.raises(ClientError):
            storage.get_r2_client().head_object(Bucket=storage.R2_BUCKET, Key="t13930/missing")

    with caplog.at_level(logging.INFO, logger="app.storage"):
        contextvars.Context().run(head_missing)

    lines = [line for line in _r2_lines(caplog) if "op=HeadObject" in line]
    assert lines, "expected an [R2_CALL] line for the HeadObject"
    assert all('source="untagged"' in line for line in lines), lines
    assert _count("untagged", "B", "HeadObject") == before + 1


def test_route_request_logs_route_template_not_raw_path(fake_r2, caplog):
    pid = _post_intro_image(caplog)
    lines = _r2_lines(caplog)
    assert any("op=PutObject" in line for line in lines), lines
    sources = {_SOURCE_RE.search(line).group(1) if _SOURCE_RE.search(line) else None for line in lines}
    assert sources == {INTRO_TEMPLATE}, sources
    assert all(pid not in s for s in sources)


def test_route_write_increments_template_putobject(fake_r2, caplog):
    put_before = _count(INTRO_TEMPLATE, "A", "PutObject")
    untagged_before = sum(
        n for (day, env, src, _c, _o), n in r2_usage.usage_buffer().peek().items()
        if src == "untagged" and day == _today()
    )
    puts_before = fake_r2.ops().count("PutObject")

    _post_intro_image(caplog)

    puts = fake_r2.ops().count("PutObject") - puts_before
    assert puts >= 1
    assert _count(INTRO_TEMPLATE, "A", "PutObject") - put_before == puts
    untagged_after = sum(
        n for (day, env, src, _c, _o), n in r2_usage.usage_buffer().peek().items()
        if src == "untagged" and day == _today()
    )
    assert untagged_after == untagged_before


def test_managed_transfer_carries_source_into_transfer_threads(fake_r2, caplog, tmp_path):
    """upload_fileobj / upload_file / download_file run their S3 requests on
    s3transfer worker threads; the source (and req_id) must survive the hop."""
    src = tmp_path / "in.bin"
    src.write_bytes(b"file-body")

    def work():
        set_current_req_id("rq-t13930")
        with r2_usage.r2_source_scope("probe_source"):
            assert storage.upload_bytes_to_r2_global("t13930/a.bin", b"bytes-body")
            assert storage.upload_file_to_r2_global("t13930/b.bin", src)
            assert storage.download_from_r2_global("t13930/b.bin", tmp_path / "out.bin")

    with caplog.at_level(logging.INFO, logger="app.storage"):
        contextvars.Context().run(work)

    assert (tmp_path / "out.bin").read_bytes() == b"file-body"
    lines = _r2_lines(caplog)
    for op in ("PutObject", "HeadObject", "GetObject"):
        op_lines = [line for line in lines if f"op={op}" in line]
        assert op_lines, (op, lines)
        assert all('source="probe_source"' in line and "req_id=rq-t13930" in line for line in op_lines), op_lines


def test_managed_helpers_preserve_exception_types(fake_r2, tmp_path):
    """Characterization: the context-propagating transfer methods raise exactly what
    boto3's injected ones do (utils/retry.py classifies on these types)."""
    from boto3.exceptions import S3UploadFailedError

    client = storage.get_r2_client()
    src = tmp_path / "in.bin"
    src.write_bytes(b"x")
    fake_r2.fail_ops = {"PutObject": 500}
    with pytest.raises(S3UploadFailedError):
        client.upload_file(str(src), storage.R2_BUCKET, "t13930/fail")
    with pytest.raises(ClientError):
        from io import BytesIO
        client.upload_fileobj(BytesIO(b"x"), storage.R2_BUCKET, "t13930/fail")
    fake_r2.fail_ops = {}
    with pytest.raises(ClientError) as exc:
        client.download_file(storage.R2_BUCKET, "t13930/absent", str(tmp_path / "o"))
    assert exc.value.response["Error"]["Code"] == "404"


def _scope(method: str, path: str) -> dict:
    return {"type": "http", "method": method, "path": path, "root_path": "", "headers": [], "query_string": b""}


def test_route_source_full_partial_mount_unmatched():
    mini = FastAPI()

    @mini.get("/items/{item_id}")
    def get_item(item_id: str):
        return {}

    @mini.post("/items/{item_id}")
    def post_item(item_id: str):
        return {}

    mini.router.routes.append(Mount("/static", app=FastAPI()))

    assert r2_usage.route_source(mini, _scope("GET", "/items/42")) == "GET /items/{item_id}"
    assert r2_usage.route_source(mini, _scope("POST", "/items/42")) == "POST /items/{item_id}"
    # 405: path matches, method doesn't -> the template, never the raw path
    assert r2_usage.route_source(mini, _scope("DELETE", "/items/42")) == "DELETE /items/{item_id}"
    assert r2_usage.route_source(mini, _scope("GET", "/static/app.css")) == "GET /static/*"
    assert r2_usage.route_source(mini, _scope("GET", "/nope/123")) == "unmatched"
    # the real app resolves the intro route to its template
    assert r2_usage.route_source(app, _scope("POST", "/api/profiles/abc123/intro/image")) == INTRO_TEMPLATE


def test_op_class_table_and_unclassified_warns(caplog):
    assert r2_usage.op_class("PutObject") == "A"
    assert r2_usage.op_class("ListObjectsV2") == "A"
    assert r2_usage.op_class("CopyObject") == "A"
    assert r2_usage.op_class("UploadPart") == "A"
    assert r2_usage.op_class("HeadObject") == "B"
    assert r2_usage.op_class("GetObject") == "B"
    assert r2_usage.op_class("DeleteObject") == "free"
    assert r2_usage.op_class("AbortMultipartUpload") == "free"
    with caplog.at_level(logging.WARNING, logger="app.r2_usage"):
        assert r2_usage.op_class("FrobnicateObjectT13930") == "unclassified"
        assert r2_usage.op_class("FrobnicateObjectT13930") == "unclassified"
    warnings = [r for r in caplog.records if "FrobnicateObjectT13930" in r.getMessage()]
    assert len(warnings) == 1
