"""T8570: content-type/status-guarded gzip for API JSON responses.

The FastAPI API historically shipped every JSON response uncompressed (measured
2026-09-09: `GET /api/bootstrap` returned 13KB with no `Content-Encoding` even
when the client sent `Accept-Encoding: gzip`; the body scales with account size —
~7KB per game, ~1.6KB per project). Compressing text/JSON saves ~65-70% on the wire.

Starlette's stock `GZipMiddleware` is NOT safe to apply blanket here: it engages on
`Accept-Encoding: gzip` alone and compresses ANY response body, including the many
`StreamingResponse` byte-range video/media endpoints (games/downloads/collections/
clips serve `206 Partial Content` with `Content-Range`). Gzipping a 206 deletes
`Content-Length`, leaves `Content-Range` describing the UNCOMPRESSED range, and wastes
CPU on already-compressed mp4 — corrupting video seeking. (Verified against the
installed starlette 0.37.2 `GZipResponder`, which has no content-type/status guard.)

`SelectiveGZipMiddleware` reuses starlette's tested compression path but only engages
it for compressible representations: HTTP 200, a text-ish `Content-Type`, and no
`Content-Range`. Everything else (206 range streams, video/*, images, octet-stream,
responses that already set `Content-Encoding`) passes through byte-for-byte untouched.
"""

from starlette.datastructures import Headers
from starlette.middleware.gzip import GZipMiddleware, GZipResponder
from starlette.types import Message, Receive, Scope, Send

# Text-ish content types worth compressing. Prefix-matched against Content-Type.
_COMPRESSIBLE_PREFIXES = (
    "application/json",
    "application/manifest+json",
    "application/javascript",
    "text/",
    "image/svg+xml",
)


def _is_compressible(status: int, headers: Headers) -> bool:
    # 206 range responses (and anything carrying Content-Range) must never be
    # gzipped — the range metadata describes uncompressed bytes.
    if status != 200 or "content-range" in headers:
        return False
    ctype = headers.get("content-type", "")
    return any(ctype.startswith(p) for p in _COMPRESSIBLE_PREFIXES)


class _SelectiveGZipResponder(GZipResponder):
    """GZipResponder that skips non-compressible responses.

    The base class compresses unless `content_encoding_set` is True (its signal for
    "response already encoded, pass through"). We reuse that pass-through branch by
    deciding compressibility from the response start headers and, when the response
    is not compressible, flipping the same flag — so the base body handling forwards
    every chunk verbatim.
    """

    async def send_with_gzip(self, message: Message) -> None:
        if message["type"] == "http.response.start":
            self.initial_message = message
            headers = Headers(raw=message["headers"])
            already_encoded = "content-encoding" in headers
            self.content_encoding_set = already_encoded or not _is_compressible(
                message["status"], headers
            )
            return
        await super().send_with_gzip(message)


class SelectiveGZipMiddleware(GZipMiddleware):
    """GZipMiddleware variant that only compresses text/JSON 200 responses."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = Headers(scope=scope)
            if "gzip" in headers.get("Accept-Encoding", ""):
                responder = _SelectiveGZipResponder(
                    self.app, self.minimum_size, compresslevel=self.compresslevel
                )
                await responder(scope, receive, send)
                return
        await self.app(scope, receive, send)
