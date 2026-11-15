"""T2580: does a finalized upload have its MP4 index (moov) at the front?

A file whose moov sits after its media data (mdat) cannot start playing until
it has fully downloaded. The browser relocates moov before uploading
(utils/mp4Faststart.js) but skips some files (overflow fallback, fragmented or
index-less files) without saying so. This module reads the head of the landed
object with ONE ranged GET (never the whole file), walks the top-level box
headers, and stores the verdict in Postgres `upload_index_checks`, read by the
admin upload panel (GET /api/admin/upload-failures `index_checks`).

Verdict: True when a moov box appears before any mdat/moof box. Everything
else is False -- mdat/moof first, a non-MP4 file, or no moov inside the bytes
read -- because none of those can be shown to start at once. `boxes` records
the walked headers so an admin can tell those cases apart.
"""

import logging

from app.services.pg import get_pg
from app.storage import R2_BUCKET, get_r2_client

logger = logging.getLogger(__name__)

# One ranged read. A faststart file's ftyp + moov header sit in the first few
# hundred bytes; 64 KiB also covers the wide/free/skip boxes some encoders add.
HEAD_BYTES = 64 * 1024
_MEDIA_BOXES = (b"mdat", b"moof")


def index_at_front(head: bytes) -> bool:
    return walk_boxes(head)[0]


def walk_boxes(head: bytes) -> tuple[bool, list[str]]:
    """Walk top-level box headers in `head`; return (verdict, boxes walked)."""
    boxes: list[str] = []
    offset = 0
    while offset + 8 <= len(head):
        size = int.from_bytes(head[offset:offset + 4], "big")
        btype = head[offset + 4:offset + 8]
        if size == 1:
            if offset + 16 > len(head):
                break
            size = int.from_bytes(head[offset + 8:offset + 16], "big")
        elif size == 0:
            # Box runs to end of file: nothing can follow it.
            size = None
        boxes.append(f"{btype.decode('ascii', errors='replace')}@{offset}")
        if btype == b"moov":
            return True, boxes
        if btype in _MEDIA_BOXES:
            return False, boxes
        if size is None or size < 8:
            break
        offset += size
    boxes.append("?")
    return False, boxes


def _read_head(r2_key: str) -> bytes:
    client = get_r2_client()
    resp = client.get_object(Bucket=R2_BUCKET, Key=r2_key, Range=f"bytes=0-{HEAD_BYTES - 1}")
    return resp["Body"].read()


def check_and_record(*, r2_key: str, user_id: str, kind: str, blake3_hash: str) -> bool:
    """Blocking (boto3 + psycopg2): call through asyncio.to_thread. Returns the verdict."""
    verdict, boxes = walk_boxes(_read_head(r2_key))
    box_text = ",".join(boxes)
    if verdict:
        logger.info(f"[UPLOAD_INDEX] at_front user={user_id} kind={kind} hash={blake3_hash} boxes={box_text}")
    else:
        logger.warning(f"[UPLOAD_INDEX] NOT_at_front user={user_id} kind={kind} hash={blake3_hash} boxes={box_text}")
    with get_pg() as conn:
        conn.cursor().execute(
            "INSERT INTO upload_index_checks (user_id, kind, blake3_hash, index_at_front, boxes) "
            "VALUES (%s, %s, %s, %s, %s)",
            (user_id, kind, blake3_hash, verdict, box_text),
        )
    return verdict
