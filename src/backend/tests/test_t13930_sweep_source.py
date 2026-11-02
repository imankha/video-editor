"""T13930: a sweep run's R2 calls count under source `sweep`.

The expiry-sweep hot loop (T13920) is the incident this attribution exists to catch.
T14140: the sweep no longer lists R2 at all -- it HEADs profile.sqlite for each
Postgres candidate. Real do_sweep, real HEAD, real botocore hook; only the HTTP
send is faked (tests/r2_fake_transport.py).

Run with: pytest tests/test_t13930_sweep_source.py -v
"""

import contextvars
import sys
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from r2_fake_transport import FakeR2Transport

from app import r2_usage, storage
from app.services import sweep_scheduler


def _counts_for(source: str, op_name: str) -> int:
    today = datetime.now(UTC).date().isoformat()
    return sum(
        n for (day, env, src, op_class, op), n in r2_usage.usage_buffer().peek().items()
        if day == today and env == storage.APP_ENV and src == source and op == op_name
    )


def test_do_sweep_heads_count_under_sweep_and_never_lists():
    fake = FakeR2Transport()
    candidates = [("t13930_sweep_u1", "p1"), ("t13930_sweep_u2", "p1")]
    heads_before = _counts_for("sweep", "HeadObject")
    untagged_before = _counts_for("untagged", "HeadObject")
    lists_before = _counts_for("sweep", "ListObjectsV2")

    with fake.patched_storage_clients(), \
         patch("app.database.R2_ENABLED", True), \
         patch.object(sweep_scheduler, "get_expiring_ref_profiles", return_value=candidates), \
         patch.object(sweep_scheduler, "get_expired_grace_deletions", return_value=[]):
        contextvars.Context().run(sweep_scheduler.do_sweep)

    heads = fake.ops().count("HeadObject")
    assert heads >= len(candidates)
    assert fake.ops().count("ListObjectsV2") == 0
    assert _counts_for("sweep", "HeadObject") - heads_before == heads
    assert _counts_for("untagged", "HeadObject") == untagged_before
    assert _counts_for("sweep", "ListObjectsV2") == lists_before
