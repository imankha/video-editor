"""T13934: server-side fetches of presigned R2 URLs (httpx) are counted in the R2 usage
attribution, like boto3 calls (T13930).

- A presigned GET made while serving a request is counted under that request's route
  template as Class B GetObject (the real httpx client runs; only its transport is faked).
- The method maps to the S3 op (HEAD -> HeadObject, PUT -> PutObject), streamed responses
  included.
- Grep proof: every httpx.AsyncClient under app/ that is not a known non-R2 caller is
  built by storage.presigned_r2_http_client, so none bypasses the counting hook.
"""

import re
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

from app import r2_usage
from app.storage import APP_ENV

APP_DIR = Path(__file__).resolve().parent.parent / "app"
_RealAsyncClient = httpx.AsyncClient


def _r2_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, content=b"\xff\xd8jpegbytes")


class _MockTransportClient(_RealAsyncClient):
    """The real httpx.AsyncClient (event hooks and all) with R2 swapped for a MockTransport."""

    def __init__(self, *args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(_r2_handler)
        super().__init__(*args, **kwargs)


@pytest.fixture(autouse=True)
def _fresh_buffer():
    r2_usage.usage_buffer().drain()
    yield
    r2_usage.usage_buffer().drain()


def _today() -> str:
    return datetime.now(UTC).date().isoformat()


def _counts_for(source: str) -> dict[tuple[str, str], int]:
    return {
        (op_cls, op): n
        for (day, env, src, op_cls, op), n in r2_usage.usage_buffer().peek().items()
        if src == source and day == _today() and env == APP_ENV
    }


def test_presigned_get_counted_under_route_template_as_class_b():
    from app.main import app
    from app.routers import shares

    share = {"share_token": "tok123", "sharer_user_id": "u13934", "sharer_profile_id": "p13934",
             "video_filename": "reel_z.mp4", "revoked_at": None}
    with patch.object(shares, "get_share_by_token", return_value=share), \
         patch.object(shares, "r2_head_object_global", return_value={"Metadata": {}}), \
         patch.object(shares, "generate_presigned_url_global",
                      return_value="https://r2.example/p.jpg?X-Amz-Signature=1"), \
         patch.object(httpx, "AsyncClient", _MockTransportClient):
        resp = TestClient(app).get("/api/shared/tok123/poster.jpg")

    assert resp.status_code == 200, resp.text
    assert resp.content == b"\xff\xd8jpegbytes"
    counts = _counts_for("GET /api/shared/{share_token}/poster.jpg")
    assert counts == {("B", "GetObject"): 1}


@pytest.mark.asyncio
async def test_method_maps_to_op_including_streamed_responses():
    from app.storage import presigned_r2_http_client

    with patch.object(httpx, "AsyncClient", _MockTransportClient), \
         r2_usage.r2_source_scope("t13934_probe"):
        async with presigned_r2_http_client(timeout=httpx.Timeout(5.0)) as client:
            await client.head("https://r2.example/a?sig=1")
            await client.put("https://r2.example/b?sig=1", content=b"x")
            async with client.stream("GET", "https://r2.example/c?sig=1",
                                     headers={"Range": "bytes=0-0"}) as response:
                await response.aread()

    assert _counts_for("t13934_probe") == {
        ("B", "HeadObject"): 1, ("A", "PutObject"): 1, ("B", "GetObject"): 1,
    }


# Callers of httpx.AsyncClient that never talk to R2 (OAuth token exchange, Resend email).
_NON_R2_HTTPX_FILES = {"routers/auth.py", "services/email.py"}


def test_no_presigned_httpx_client_bypasses_the_counting_hook():
    constructors: dict[str, int] = {}
    for path in APP_DIR.rglob("*.py"):
        rel = path.relative_to(APP_DIR).as_posix()
        n = len(re.findall(r"httpx\.AsyncClient\(", path.read_text(encoding="utf-8")))
        if n:
            constructors[rel] = n
    assert {k: v for k, v in constructors.items() if k not in _NON_R2_HTTPX_FILES} == {"storage.py": 1}

    storage_src = (APP_DIR / "storage.py").read_text(encoding="utf-8")
    factory = storage_src.split("def presigned_r2_http_client(", 1)
    assert len(factory) == 2, "storage.presigned_r2_http_client is missing"
    body = factory[1].split("\ndef ", 1)[0]
    assert "httpx.AsyncClient(" in body and "event_hooks" in body
