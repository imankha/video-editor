"""
T6340 (HISTORICAL) -- the bulk migration runner had to establish a confirmed
sync baseline for the canonical R2 profile.sqlite it force-downloaded and
swapped into place, or NO profile_db migration could ever reach R2.

T5087 deleted that bulk-sweep migration runner (_migrate_profile_db/
_migrate_user) this file used to test end-to-end, once JIT (T5083/T5085,
hardened by T8190) became the sole per-user migration mechanism with no
bulk-sweep counterpart. Only the `_r2_version_or_none` helper below survived
T5087 -- it still has a live caller in `migrate_local_profile_db_at_seam`
(app/migrations/__init__.py; NOT the user.sqlite primitive, which never
reports an r2_version on failure) -- so only its test survives here.
"""

from unittest.mock import patch


def test_r2_version_or_none_coerces_enum_never_leaks(tmp_path):
    """The error-row version helper must coerce R2VersionResult.{ERROR,NOT_FOUND}
    to None (never leak the enum as a version) and pass a real int through."""
    from app.migrations import _r2_version_or_none
    from app.storage import R2VersionResult

    with patch("app.storage.get_db_version_from_r2", return_value=R2VersionResult.ERROR):
        assert _r2_version_or_none("u", "p") is None
    with patch("app.storage.get_db_version_from_r2", return_value=R2VersionResult.NOT_FOUND):
        assert _r2_version_or_none("u", "p") is None
    with patch("app.storage.get_db_version_from_r2", return_value=2698):
        assert _r2_version_or_none("u", "p") == 2698
