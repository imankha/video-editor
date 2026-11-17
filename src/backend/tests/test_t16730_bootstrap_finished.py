"""T16730: the returning-parent card must read `finished` from bootstrap too.

useExportRecovery takes the unacknowledged exports from /api/bootstrap whenever it
arrives within 2 s (the usual case) and only falls back to GET /api/exports/unacknowledged
when it does not. Both lists must say whether the server finished the sharpen (T16520),
or a parent who returns quickly is shown the old "ready" text instead of "Your highlight
is in Highlights" (T16525:C2 failed intermittently on dev and staging).
"""

import pytest

from tests.test_t4050_publish_restore_roundtrip import env  # noqa: F401  (fixture)
from tests.test_t16510_record_finish import user_actions  # noqa: F401  (fixture)
from tests.test_t16520_server_finish import _seed_project, _sharpen, r2  # noqa: F401


@pytest.mark.asyncio
async def test_t16730_bootstrap_unacknowledged_reports_finished_like_the_endpoint(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.bootstrap import _read_profile_misc
    from app.routers.exports import list_unacknowledged_exports

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-ok")
    # A re-sharpen whose automatic finish fails: not finished.
    r2["fail_copy"] = True
    await _sharpen(db_path, project_id, "job-failed")

    endpoint = {j.job_id: j.finished for j in list_unacknowledged_exports().exports}
    boot = {j["job_id"]: j.get("finished") for j in _read_profile_misc()["exports"]["unacknowledged"]}
    assert endpoint == {"job-ok": True, "job-failed": False}
    assert boot == endpoint
