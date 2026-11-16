"""T16540 guard: a highlight the parent moved back to drafts (re-edit) is their choice.

Re-edit unpublishes every version of the project. Since T16520 a finished highlight stays
unarchived until the next session, so re-edit takes the not-archived branch; it must still
mark the project (restored_at) so the stranded finish never re-publishes it.
"""

import sqlite3

import pytest

from tests.test_t16520_server_finish import r2  # noqa: F401  (fixture)
from tests.test_t16540_finish_stranded import _rows, _seed_stranded, account  # noqa: F401  (fixture)


@pytest.mark.asyncio
async def test_t16540_a_highlight_moved_back_to_drafts_stays_a_draft(account, r2):  # noqa: F811
    from app.routers.downloads import restore_project_from_archive

    s = _seed_stranded(account["db"], spotlight=True)
    conn = sqlite3.connect(str(account["db"]))
    conn.execute("UPDATE final_videos SET published_at = CURRENT_TIMESTAMP WHERE id = ?",
                 (s["final_video_id"],))
    conn.commit()
    conn.close()

    await restore_project_from_archive(s["final_video_id"], _durable=None)
    account["open"]()

    assert _rows(account["db"], "SELECT published_at FROM final_videos WHERE project_id = ?",
                 (s["project_id"],)) == [{"published_at": None}]
    assert account["archived"] == []
