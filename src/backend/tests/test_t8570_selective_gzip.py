"""
T8570 — SelectiveGZipMiddleware compresses text/JSON but never touches byte-range
video/media streams.

Background: the API shipped JSON uncompressed (measured: GET /api/bootstrap 13KB,
no Content-Encoding even with Accept-Encoding: gzip). Stock starlette GZipMiddleware
would fix that but also gzip the 206 Partial Content StreamingResponse video/media
endpoints — deleting Content-Length while leaving Content-Range describing the
UNCOMPRESSED range, which corrupts video seeking. SelectiveGZipMiddleware only
compresses HTTP 200 text-ish responses with no Content-Range.

These tests exercise the middleware in isolation (a tiny app with representative
routes) plus one assertion that it is actually wired into the real app stack.
"""

import asyncio

import httpx
from starlette.applications import Starlette
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from app.middleware.compression import SelectiveGZipMiddleware

# A JSON payload comfortably over the 500-byte minimum_size threshold.
_BIG_JSON = {"items": [{"i": i, "name": f"game-{i}"} for i in range(200)]}
_SMALL_JSON = {"ok": True}
_VIDEO_BYTES = b"\x00\x01\x02\x03" * 500  # 2000 bytes of "video"


async def _big_json(request):
    return JSONResponse(_BIG_JSON)


async def _small_json(request):
    return JSONResponse(_SMALL_JSON)


async def _range_stream(request):
    # Mimics the games/downloads/clips byte-range video path: 206 + Content-Range.
    async def gen():
        yield _VIDEO_BYTES

    return StreamingResponse(
        gen(),
        status_code=206,
        media_type="video/mp4",
        headers={
            "Content-Range": f"bytes 0-{len(_VIDEO_BYTES) - 1}/100000",
            "Content-Length": str(len(_VIDEO_BYTES)),
            "Accept-Ranges": "bytes",
        },
    )


async def _full_video(request):
    # A 200 video/mp4 body (not a range request) must also be left uncompressed.
    return Response(_VIDEO_BYTES, media_type="video/mp4")


def _make_app():
    app = Starlette(routes=[
        Route("/big.json", _big_json),
        Route("/small.json", _small_json),
        Route("/range", _range_stream),
        Route("/video", _full_video),
    ])
    app.add_middleware(SelectiveGZipMiddleware, minimum_size=500)
    return app


def _get(app, path, accept_gzip=True):
    async def _run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://t") as c:
            headers = {"Accept-Encoding": "gzip"} if accept_gzip else {"Accept-Encoding": "identity"}
            return await c.get(path, headers=headers)
    return asyncio.run(_run())


def test_large_json_is_gzipped():
    resp = _get(_make_app(), "/big.json")
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"
    # httpx transparently decompresses -> body must still be the original JSON.
    assert resp.json() == _BIG_JSON


def test_small_json_not_gzipped():
    # Under minimum_size -> starlette passes it through uncompressed.
    resp = _get(_make_app(), "/small.json")
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") != "gzip"
    assert resp.json() == _SMALL_JSON


def test_no_accept_encoding_not_gzipped():
    resp = _get(_make_app(), "/big.json", accept_gzip=False)
    assert resp.headers.get("content-encoding") != "gzip"
    assert resp.json() == _BIG_JSON


def test_206_range_stream_never_gzipped():
    resp = _get(_make_app(), "/range")
    assert resp.status_code == 206
    # The load-bearing guarantee: a 206 must NOT be gzipped...
    assert resp.headers.get("content-encoding") != "gzip"
    # ...and Content-Range must survive intact (byte offsets unchanged).
    assert resp.headers.get("content-range") == f"bytes 0-{len(_VIDEO_BYTES) - 1}/100000"
    assert resp.content == _VIDEO_BYTES


def test_full_video_200_not_gzipped():
    resp = _get(_make_app(), "/video")
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") != "gzip"
    assert resp.content == _VIDEO_BYTES


def test_middleware_is_wired_into_real_app():
    from app.main import app
    assert any(m.cls is SelectiveGZipMiddleware for m in app.user_middleware), (
        "SelectiveGZipMiddleware must be registered in the real app middleware stack"
    )
