"""T15590: two concurrent finalize-upload calls each take ~1x a lone call's
R2 time, not ~2x.

finalize_upload is `async def` but called the boto3 R2 calls directly (no
asyncio.to_thread), so each one blocked the single event loop for its full
network duration. Two concurrent finalizes for two DIFFERENT uploads (same
user, two browser tabs -- the staging QA repro) then ran their R2 calls
back-to-back instead of in parallel.

Run with: pytest src/backend/tests/test_t15590_concurrent_finalize.py -v
"""
import asyncio
import sys
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest

from tests.test_t15090_lock_queue import _env_with_user_db
from tests.test_t15090_parts_light_write import FILE_SIZE, GU, _hash, _prepare, _settle

SLEEP = 0.4


def _finalize(env, session_id, h):
    return env.client.post("/api/games/finalize-upload", json={
        "upload_session_id": session_id, "parts": [{"part_number": 1, "etag": "e"}],
        "blake3_hash": h, "kind": "game"})


def _slow_r2_seams():
    """Each call blocks for SLEEP, like a real R2 round-trip -- synchronously,
    the way the real boto3 calls do."""
    completed_hashes = set()

    def complete(key, upload_id, parts, metadata=None):
        time.sleep(SLEEP)
        completed_hashes.add(key)
        return True

    def head(key):
        if key in completed_hashes:
            return {"ContentLength": FILE_SIZE}
        return None

    return patch(GU + "r2_complete_multipart_upload", complete), patch(GU + "r2_head_object_global", head)


@pytest.mark.asyncio
async def test_two_concurrent_finalizes_do_not_serialize_their_r2_calls():
    async with _env_with_user_db() as env:
        p1, p2 = _slow_r2_seams()
        with p1, p2:
            h1, h2 = _hash(), _hash()
            session1 = (await _prepare(env, h1))["upload_session_id"]
            await _settle(env)
            session2 = (await _prepare(env, h2))["upload_session_id"]
            await _settle(env)

            started = time.perf_counter()
            r1, r2 = await asyncio.gather(
                _finalize(env, session1, h1),
                _finalize(env, session2, h2),
            )
            elapsed = time.perf_counter() - started

            assert r1.status_code == 200, r1.text
            assert r2.status_code == 200, r2.text
            # Serialized (the bug): ~2x SLEEP. Concurrent (fixed): ~1x SLEEP.
            assert elapsed < SLEEP * 1.5, f"finalizes serialized their R2 calls: {elapsed:.2f}s"
