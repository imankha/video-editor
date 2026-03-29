"""Tests for the R2 retry utility."""
import asyncio
import time
from unittest.mock import MagicMock, patch
import pytest

from app.utils.retry import (
    is_transient_error,
    retry_r2_call,
    retry_async_call,
    TIER_1,
    TIER_2,
    TIER_3,
)


# ---------------------------------------------------------------------------
# is_transient_error
# ---------------------------------------------------------------------------

class TestIsTransientError:
    def test_connection_error_is_transient(self):
        assert is_transient_error(ConnectionError("connection reset"))

    def test_connection_reset_error_is_transient(self):
        assert is_transient_error(ConnectionResetError("reset by peer"))

    def test_timeout_keyword_is_transient(self):
        assert is_transient_error(Exception("request timed out"))

    def test_endpoint_connection_error_is_transient(self):
        """Simulate botocore EndpointConnectionError by type name."""
        exc = type("EndpointConnectionError", (Exception,), {})("Could not connect")
        assert is_transient_error(exc)

    def test_connect_timeout_error_is_transient(self):
        exc = type("ConnectTimeoutError", (Exception,), {})("connect timed out")
        assert is_transient_error(exc)

    def test_read_timeout_error_is_transient(self):
        exc = type("ReadTimeoutError", (Exception,), {})("read timed out")
        assert is_transient_error(exc)

    def test_nosuchkey_is_not_transient(self):
        exc = type("NoSuchKey", (Exception,), {})("key not found")
        assert not is_transient_error(exc)

    def test_access_denied_is_not_transient(self):
        exc = type("AccessDenied", (Exception,), {})("forbidden")
        assert not is_transient_error(exc)

    def test_client_error_404_is_not_transient(self):
        exc = type("ClientError", (Exception,), {})(
            "Not Found"
        )
        exc.response = {"Error": {"Code": "404"}}
        assert not is_transient_error(exc)

    def test_client_error_403_is_not_transient(self):
        exc = type("ClientError", (Exception,), {})(
            "Forbidden"
        )
        exc.response = {"Error": {"Code": "403"}}
        assert not is_transient_error(exc)

    def test_client_error_500_is_transient(self):
        exc = type("ClientError", (Exception,), {})(
            "Internal Server Error"
        )
        exc.response = {"Error": {"Code": "500"}}
        assert is_transient_error(exc)

    def test_client_error_429_is_transient(self):
        exc = type("ClientError", (Exception,), {})(
            "Too Many Requests"
        )
        exc.response = {"Error": {"Code": "429"}}
        assert is_transient_error(exc)

    def test_client_error_503_is_transient(self):
        exc = type("ClientError", (Exception,), {})(
            "Service Unavailable"
        )
        exc.response = {"Error": {"Code": "503"}}
        assert is_transient_error(exc)

    def test_generic_value_error_is_not_transient(self):
        assert not is_transient_error(ValueError("bad value"))

    def test_could_not_connect_endpoint_url_is_transient(self):
        assert is_transient_error(
            Exception("Could not connect to the endpoint URL")
        )

    def test_httpx_timeout_types_are_transient(self):
        for name in ("TimeoutException", "ConnectTimeout", "ReadTimeout", "ConnectError"):
            exc = type(name, (Exception,), {})("timed out")
            assert is_transient_error(exc), f"{name} should be transient"


# ---------------------------------------------------------------------------
# retry_r2_call (sync)
# ---------------------------------------------------------------------------

class TestRetryR2Call:
    def test_succeeds_on_first_try(self):
        func = MagicMock(return_value="ok")
        result = retry_r2_call(func, "a", "b", max_attempts=3, initial_delay=0.01)
        assert result == "ok"
        assert func.call_count == 1

    def test_retries_on_transient_error(self):
        func = MagicMock(
            side_effect=[ConnectionError("reset"), "ok"]
        )
        result = retry_r2_call(func, max_attempts=3, initial_delay=0.01)
        assert result == "ok"
        assert func.call_count == 2

    def test_no_retry_on_non_transient_error(self):
        exc = type("NoSuchKey", (Exception,), {})("not found")
        func = MagicMock(side_effect=exc)
        with pytest.raises(type(exc)):
            retry_r2_call(func, max_attempts=3, initial_delay=0.01)
        assert func.call_count == 1

    def test_exhausts_all_attempts(self):
        func = MagicMock(
            side_effect=ConnectionError("always fails")
        )
        with pytest.raises(ConnectionError):
            retry_r2_call(func, max_attempts=3, initial_delay=0.01)
        assert func.call_count == 3

    def test_backoff_increases_delay(self):
        func = MagicMock(
            side_effect=[ConnectionError("fail"), ConnectionError("fail"), "ok"]
        )
        start = time.monotonic()
        # initial_delay=0.05, backoff=2.0 → delays ~0.05s and ~0.1s (with jitter)
        result = retry_r2_call(
            func, max_attempts=3, initial_delay=0.05, backoff=2.0
        )
        elapsed = time.monotonic() - start
        assert result == "ok"
        # Should take at least ~0.05s (with jitter reducing to 50%)
        assert elapsed >= 0.025

    def test_passes_kwargs(self):
        func = MagicMock(return_value="ok")
        retry_r2_call(func, "pos_arg", max_attempts=2, initial_delay=0.01, Bucket="test")
        func.assert_called_once_with("pos_arg", Bucket="test")

    def test_tier_presets(self):
        assert TIER_1 == {"max_attempts": 4, "initial_delay": 1.0}
        assert TIER_2 == {"max_attempts": 3, "initial_delay": 0.5}
        assert TIER_3 == {"max_attempts": 2, "initial_delay": 0.5}


# ---------------------------------------------------------------------------
# retry_async_call
# ---------------------------------------------------------------------------

class TestRetryAsyncCall:
    @pytest.mark.asyncio
    async def test_succeeds_on_first_try(self):
        async def func():
            return "ok"
        result = await retry_async_call(func, max_attempts=3, initial_delay=0.01)
        assert result == "ok"

    @pytest.mark.asyncio
    async def test_retries_on_transient_error(self):
        call_count = 0

        async def func():
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise ConnectionError("reset")
            return "ok"

        result = await retry_async_call(func, max_attempts=3, initial_delay=0.01)
        assert result == "ok"
        assert call_count == 2

    @pytest.mark.asyncio
    async def test_no_retry_on_non_transient_error(self):
        call_count = 0

        async def func():
            nonlocal call_count
            call_count += 1
            raise ValueError("bad")

        with pytest.raises(ValueError):
            await retry_async_call(func, max_attempts=3, initial_delay=0.01)
        assert call_count == 1

    @pytest.mark.asyncio
    async def test_exhausts_all_attempts(self):
        call_count = 0

        async def func():
            nonlocal call_count
            call_count += 1
            raise ConnectionError("always fails")

        with pytest.raises(ConnectionError):
            await retry_async_call(func, max_attempts=3, initial_delay=0.01)
        assert call_count == 3
