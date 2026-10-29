"""T13930: in-memory R2 behind a REAL boto3 client.

The existing R2 doubles (FakeR2 in test_t4050_durable_sync.py and friends) replace the
client object, so botocore's event hooks never fire. This fake keeps the whole botocore
pipeline (serialize, sign, before-call/after-call hooks, response parse, s3transfer
threads) and replaces only the HTTP send, via a `before-send.s3` handler that answers
from an in-memory object map. Use it when a test must observe the production
`[R2_CALL]` hook (source tags, usage counts).

    fake = FakeR2Transport()
    with fake.patched_storage_clients():
        storage.upload_bytes_to_r2_global("k", b"x")
    assert fake.requests == [("PutObject", "k")]
"""

import hashlib
import io
import threading
from contextlib import contextmanager
from datetime import UTC, datetime
from email.utils import format_datetime
from unittest.mock import patch
from urllib.parse import parse_qs, unquote, urlsplit
from xml.sax.saxutils import escape

from botocore.awsrequest import AWSResponse

FAKE_ENDPOINT = "https://fake-r2.test"


class _RawBody:
    """The minimal urllib3-response surface botocore reads a body through."""

    def __init__(self, data: bytes):
        self._buf = io.BytesIO(data)

    def read(self, amt=None):
        return self._buf.read() if amt is None else self._buf.read(amt)

    def stream(self, amt=65536, decode_content=None):
        while True:
            chunk = self._buf.read(amt)
            if not chunk:
                return
            yield chunk

    def close(self):
        pass


class FakeR2Transport:
    def __init__(self):
        self.objects: dict[str, dict] = {}
        self.requests: list[tuple[str, str]] = []
        # op name -> HTTP status to answer instead of the normal response
        self.fail_ops: dict[str, int] = {}
        self._lock = threading.Lock()

    # -- clients -------------------------------------------------------------

    def client(self, label: str = "default"):
        import boto3
        from botocore.config import Config

        from app import storage

        client = boto3.client(
            "s3",
            endpoint_url=FAKE_ENDPOINT,
            aws_access_key_id="fake",
            aws_secret_access_key="fake",
            region_name="auto",
            config=Config(
                signature_version="s3v4",
                s3={"addressing_style": "path"},
                retries={"max_attempts": 0},
            ),
        )
        storage._register_r2_timing(client, label)
        client.meta.events.register("before-send.s3", self._send)
        return client

    @contextmanager
    def patched_storage_clients(self):
        """Point storage's three client factories at fake-backed real clients."""
        from app import storage

        clients = {label: self.client(label) for label in ("default", "sync", "transfer")}
        with patch.object(storage, "get_r2_client", lambda: clients["default"]), \
             patch.object(storage, "get_r2_sync_client", lambda: clients["sync"]), \
             patch.object(storage, "get_r2_transfer_client", lambda: clients["transfer"]):
            yield clients

    # -- direct state access (no request logged) ------------------------------

    def put_foreign(self, key: str, body: bytes, metadata: dict | None = None) -> str:
        """Write an object as some OTHER writer would, bypassing the client."""
        with self._lock:
            return self._store(key, body, metadata or {})

    def ops(self) -> list[str]:
        with self._lock:
            return [op for op, _ in self.requests]

    # -- transport -----------------------------------------------------------

    def _store(self, key, body, metadata) -> str:
        etag = f'"{hashlib.md5(body).hexdigest()}"'
        self.objects[key] = {
            "body": body,
            "etag": etag,
            "metadata": dict(metadata),
            "last_modified": datetime.now(UTC),
        }
        return etag

    def _send(self, request, event_name, **kwargs):
        op = event_name.rsplit(".", 1)[-1]
        parts = urlsplit(request.url)
        # path-style: /{bucket}/{key}
        _, _, key = unquote(parts.path).lstrip("/").partition("/")
        query = parse_qs(parts.query)
        with self._lock:
            self.requests.append((op, key))
            if op in self.fail_ops:
                return self._error(request.url, self.fail_ops[op], "InternalError")
            return self._answer(op, key, query, request)

    def _answer(self, op, key, query, request):
        url = request.url
        if op == "PutObject":
            body = request.body
            data = body.read() if hasattr(body, "read") else (body or b"")
            if isinstance(data, str):
                data = data.encode()
            metadata = {
                name[len("x-amz-meta-"):]: value.decode() if isinstance(value, bytes) else value
                for name, value in request.headers.items()
                if name.lower().startswith("x-amz-meta-")
            }
            etag = self._store(key, data, metadata)
            return AWSResponse(url, 200, {"ETag": etag}, _RawBody(b""))
        if op in ("HeadObject", "GetObject"):
            obj = self.objects.get(key)
            if obj is None:
                if op == "HeadObject":
                    return AWSResponse(url, 404, {}, _RawBody(b""))
                return self._error(url, 404, "NoSuchKey")
            headers = {
                "ETag": obj["etag"],
                "Content-Length": str(len(obj["body"])),
                "Content-Type": "application/octet-stream",
                "Last-Modified": format_datetime(obj["last_modified"], usegmt=True),
            }
            headers.update({f"x-amz-meta-{k}": v for k, v in obj["metadata"].items()})
            body = b"" if op == "HeadObject" else obj["body"]
            return AWSResponse(url, 200, headers, _RawBody(body))
        if op == "ListObjectsV2":
            return AWSResponse(url, 200, {}, _RawBody(self._list_xml(query)))
        if op == "DeleteObject":
            self.objects.pop(key, None)
            return AWSResponse(url, 204, {}, _RawBody(b""))
        raise AssertionError(f"FakeR2Transport: unsupported operation {op}")

    def _list_xml(self, query) -> bytes:
        prefix = query.get("prefix", [""])[0]
        delimiter = query.get("delimiter", [""])[0]
        contents, common = [], set()
        for key in sorted(self.objects):
            if not key.startswith(prefix):
                continue
            rest = key[len(prefix):]
            if delimiter and delimiter in rest:
                common.add(prefix + rest.split(delimiter, 1)[0] + delimiter)
                continue
            obj = self.objects[key]
            contents.append(
                f"<Contents><Key>{escape(key)}</Key><ETag>{escape(obj['etag'])}</ETag>"
                f"<Size>{len(obj['body'])}</Size>"
                f"<LastModified>{obj['last_modified'].strftime('%Y-%m-%dT%H:%M:%S.000Z')}</LastModified>"
                f"</Contents>"
            )
        prefixes = "".join(
            f"<CommonPrefixes><Prefix>{escape(p)}</Prefix></CommonPrefixes>" for p in sorted(common)
        )
        return (
            '<?xml version="1.0" encoding="UTF-8"?>'
            '<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">'
            f"<Name>bucket</Name><Prefix>{escape(prefix)}</Prefix>"
            f"<KeyCount>{len(contents) + len(common)}</KeyCount><MaxKeys>1000</MaxKeys>"
            f"<IsTruncated>false</IsTruncated>{''.join(contents)}{prefixes}</ListBucketResult>"
        ).encode()

    @staticmethod
    def _error(url, status, code):
        body = (
            f'<?xml version="1.0" encoding="UTF-8"?><Error><Code>{code}</Code>'
            f"<Message>{code}</Message></Error>"
        ).encode()
        return AWSResponse(url, status, {"Content-Type": "application/xml"}, _RawBody(body))
