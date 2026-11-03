"""T14510: the OTP email heading is white, so the container must set its own dark background."""
import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services import email as email_mod


async def _capture_html() -> str:
    resp = MagicMock(status_code=200, text="ok")
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=client)
    cm.__aexit__ = AsyncMock(return_value=False)
    with patch.dict("os.environ", {"RESEND_API_KEY": "k"}), \
         patch.object(email_mod.httpx, "AsyncClient", return_value=cm):
        await email_mod.send_otp_email("a@b.com", "123456")
    return client.post.call_args.kwargs["json"]["html"]


@pytest.mark.asyncio
async def test_otp_email_sets_dark_background_behind_white_heading():
    html = await _capture_html()
    assert "#ffffff" in html  # heading is white...
    container = re.search(r'<div style="([^"]*)"', html).group(1)
    assert re.search(r"background(-color)?:\s*#(1f2937|111827)", container), container
