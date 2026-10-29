"""T13930: a sweep run's R2 lists count under source `sweep`.

The expiry-sweep hot loop (T13920) is the incident this attribution exists to catch.
Real do_sweep, real _get_profile_ids ListObjectsV2, real botocore hook; only the HTTP
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


def _counts_for(source: str) -> int:
    today = datetime.now(UTC).date().isoformat()
    return sum(
        n for (day, env, src, op_class, op), n in r2_usage.usage_buffer().peek().items()
        if day == today and env == storage.APP_ENV and src == source and op == "ListObjectsV2"
    )


def test_do_sweep_lists_count_under_sweep():
    fake = FakeR2Transport()
    users = [{"user_id": "t13930_sweep_u1"}, {"user_id": "t13930_sweep_u2"}]
    sweep_before, untagged_before = _counts_for("sweep"), _counts_for("untagged")

    with fake.patched_storage_clients(), \
         patch("app.services.auth_db.get_all_users_for_admin", return_value=users), \
         patch.object(sweep_scheduler, "get_expired_grace_deletions", return_value=[]):
        contextvars.Context().run(sweep_scheduler.do_sweep)

    lists = fake.ops().count("ListObjectsV2")
    assert lists >= 1
    assert _counts_for("sweep") - sweep_before == lists
    assert _counts_for("untagged") == untagged_before
