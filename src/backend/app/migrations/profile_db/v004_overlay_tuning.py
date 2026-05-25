import msgpack
from ..base import BaseMigration


class V004OverlayTuning(BaseMigration):
    version = 4
    description = "Add overlay tuning columns and migrate keyframe opacity to strokeOpacity/fillOpacity"

    def up(self, conn) -> None:
        has_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='working_videos'"
        ).fetchone()
        if not has_table:
            return

        for col, default in [
            ("stroke_width REAL", "3"),
            ("fill_enabled INTEGER", "0"),
            ("fill_opacity REAL", "0.10"),
            ("dim_strength REAL", "0.15"),
        ]:
            try:
                conn.execute(f"ALTER TABLE working_videos ADD COLUMN {col} DEFAULT {default}")
            except Exception:
                pass

        rows = conn.execute(
            "SELECT id, highlights_data FROM working_videos WHERE highlights_data IS NOT NULL"
        ).fetchall()

        for row in rows:
            wv_id = row[0]
            raw = row[1]
            if isinstance(raw, memoryview):
                raw = bytes(raw)
            if not raw:
                continue

            try:
                regions = msgpack.unpackb(raw, raw=False)
            except Exception:
                continue

            changed = False
            for region in regions:
                keyframes = region.get("keyframes", [])
                for kf in keyframes:
                    if "opacity" in kf and "strokeOpacity" not in kf:
                        kf["strokeOpacity"] = 0.85
                        kf["fillOpacity"] = kf.pop("opacity")
                        changed = True

            if changed:
                conn.execute(
                    "UPDATE working_videos SET highlights_data = ? WHERE id = ?",
                    (msgpack.packb(regions, use_bin_type=True), wv_id),
                )
