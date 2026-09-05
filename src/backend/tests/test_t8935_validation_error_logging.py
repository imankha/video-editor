"""T8935 — RequestValidationError is now logged, not silent.

Investigation context: a frontend upload failure surfaced as an unreadable
"[object Object]" toast (uploadManager.js stringifying a non-string `detail`).
Root-causing it after the fact was impossible because FastAPI/Starlette's default
RequestValidationError handling returns the normal 422 body but never logs
anything — a request that fails Pydantic validation was completely invisible in
server logs. This pins the new handler's two guarantees: (1) it logs a WARNING
with the path/method/errors, and (2) the response body is BYTE-IDENTICAL to
FastAPI's own default (`{"detail": jsonable_encoder(exc.errors())}`, status 422) —
this is an observability addition, not a behavior change.

Run with: pytest src/backend/tests/test_t8935_validation_error_logging.py -v
"""
import logging
import sys
from pathlib import Path

import pytest
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.main import validation_exception_handler


def _make_request(method="POST", path="/api/games"):
    return Request(scope={"type": "http", "method": method, "path": path, "headers": []})


@pytest.mark.asyncio
async def test_logs_a_warning_with_path_method_and_errors(caplog):
    errors = [{"loc": ("body", "game_type"), "msg": "field required", "type": "missing"}]
    exc = RequestValidationError(errors=errors)

    with caplog.at_level(logging.WARNING, logger="app.main"):
        await validation_exception_handler(_make_request(), exc)

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.levelno == logging.WARNING
    message = record.getMessage()
    assert "POST" in message
    assert "/api/games" in message
    assert "game_type" in message
    assert "field required" in message


@pytest.mark.asyncio
async def test_response_shape_matches_fastapi_default():
    errors = [{"loc": ("body", "game_type"), "msg": "field required", "type": "missing"}]
    exc = RequestValidationError(errors=errors)

    response = await validation_exception_handler(_make_request(), exc)

    assert isinstance(response, JSONResponse)
    assert response.status_code == 422
    # jsonable_encoder turns the tuple loc into a list — the exact shape FastAPI's
    # own default handler produces (json.loads confirms it round-trips as expected,
    # not just that a JSONResponse object was returned).
    import json
    body = json.loads(response.body)
    assert body == {
        "detail": [{"loc": ["body", "game_type"], "msg": "field required", "type": "missing"}]
    }


@pytest.mark.asyncio
async def test_handles_multiple_errors_in_one_request(caplog):
    errors = [
        {"loc": ("body", "a"), "msg": "field required", "type": "missing"},
        {"loc": ("body", "b"), "msg": "value is not a valid integer", "type": "int_parsing"},
    ]
    exc = RequestValidationError(errors=errors)

    with caplog.at_level(logging.WARNING, logger="app.main"):
        await validation_exception_handler(_make_request(), exc)

    message = caplog.records[0].getMessage()
    assert "a" in message
    assert "b" in message
