"""T16525: the API tells the browser whether the server finished this sharpen.

The panels (Focus ready panel, the returning-parent card, the Spotlight completion) branch
on it: finished -> "It's in your Highlights" with no Finish tap; not finished (the
automatic finish failed) -> today's panel with its Finish button.

`finished` means a PUBLISHED final video was made from the project's CURRENT working
video (final_videos.source_working_video_id, T16520). An older published version made
from an earlier sharpen does not count: that sharpen's finish is what the parent is told about.
"""

import pytest

from tests.test_t4050_publish_restore_roundtrip import env  # noqa: F401  (fixture)
from tests.test_t16510_record_finish import user_actions  # noqa: F401  (fixture)
from tests.test_t16520_server_finish import _rows, _seed_project, _sharpen, r2  # noqa: F401


@pytest.mark.asyncio
async def test_t16525_project_detail_reports_the_server_finish(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.projects import get_project

    project_id = _seed_project(db_path)
    assert (await get_project(project_id)).is_finished is False

    await _sharpen(db_path, project_id, "job-ok")
    assert (await get_project(project_id)).is_finished is True


@pytest.mark.asyncio
async def test_t16525_a_failed_finish_reports_not_finished(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.exports import list_unacknowledged_exports
    from app.routers.projects import get_project

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-1")
    # A re-sharpen whose automatic finish fails: the published version is the OLD one.
    r2["fail_copy"] = True
    await _sharpen(db_path, project_id, "job-2")

    assert (await get_project(project_id)).is_finished is False
    jobs = {j.job_id: j for j in list_unacknowledged_exports().exports}
    assert jobs["job-1"].finished is True
    assert jobs["job-2"].finished is False


@pytest.mark.asyncio
async def test_t16525_returning_parent_job_reports_finished(env, user_actions, r2):  # noqa: F811
    db_path, _ = env
    from app.routers.exports import list_unacknowledged_exports

    project_id = _seed_project(db_path)
    await _sharpen(db_path, project_id, "job-away")
    [job] = list_unacknowledged_exports().exports
    assert job.job_id == "job-away" and job.finished is True
