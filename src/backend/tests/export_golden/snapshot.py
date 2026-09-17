"""Golden-snapshot assertion + re-bless mechanism for the T4370 harness.

No snapshot-testing library exists in this repo (verified: grep for
syrupy/snapshottest/pytest-snapshot/golden across the tree returns nothing) --
this is a small hand-rolled one. A golden is a checked-in canonical JSON file
under `goldens/{name}.json`. `BLESS_GOLDENS=1` overwrites it instead of
asserting; `scripts/rebless_export_goldens.py` sets that env var and shows the
resulting `git diff` so a re-bless is always reviewed, never silent.
"""

import difflib
import json
import os
from pathlib import Path

GOLDENS_DIR = Path(__file__).parent / "goldens"

MASKED = "<MASKED>"


def _bless_enabled() -> bool:
    return os.environ.get("BLESS_GOLDENS", "").strip() in ("1", "true", "yes")


def canonicalize_row(
    row: dict, *, blob_fields: tuple = (), mask_fields: tuple = (), blob_subfield_masks: dict | None = None,
) -> dict:
    """Decode msgpack BLOB columns and mask nondeterministic columns (UUID-suffixed
    filenames, wall-clock timestamps, gpu_seconds/modal_function sourced from a
    stubbed Modal result) so the golden pins SHAPE, not incidental randomness.

    `blob_subfield_masks` masks nondeterministic KEYS INSIDE a decoded blob dict
    (e.g. export_jobs.input_data legitimately embeds the real user_id + a real
    tmp render path -- nondeterministic in production too, not a test artifact):
    ``{blob_field_name: (subkey, ...)}``.

    `row` may be a sqlite3.Row or a plain dict.
    """
    from app.utils.encoding import decode_data

    blob_subfield_masks = blob_subfield_masks or {}
    out = {}
    keys = row.keys() if hasattr(row, "keys") else row
    for key in keys:
        value = row[key]
        if key in mask_fields:
            out[key] = MASKED if value is not None else None
            continue
        if key in blob_fields and value is not None:
            try:
                value = decode_data(value)
                if isinstance(value, dict) and key in blob_subfield_masks:
                    for subkey in blob_subfield_masks[key]:
                        if subkey in value and value[subkey] is not None:
                            value[subkey] = MASKED
            except Exception:
                value = f"<UNDECODABLE BLOB len={len(value)}>"
        out[key] = value
    return out


def _canonical_json(tables: dict) -> str:
    return json.dumps(tables, indent=2, sort_keys=True, default=str) + "\n"


def load_or_bless(name: str, actual: dict) -> dict:
    """Lower-level primitive than `assert_matches_golden`: with BLESS_GOLDENS=1,
    writes `actual` as the golden and returns it; otherwise reads and returns
    the checked-in golden dict, leaving comparison to the caller.

    For data with an intrinsic tolerance (render goldens: duration/frame-hash
    drift is expected across ffmpeg builds) -- exact-JSON-equality via
    `assert_matches_golden` is the wrong tool; the caller applies its own
    per-field tolerance against the returned dict.
    """
    golden_path = GOLDENS_DIR / f"{name}.json"
    if _bless_enabled():
        GOLDENS_DIR.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(_canonical_json(actual))
        return actual
    if not golden_path.exists():
        raise AssertionError(
            f"No golden file at {golden_path}.\n"
            f"Run `BLESS_GOLDENS=1 python3 scripts/rebless_export_goldens.py` "
            f"to create it, then review the diff with `git diff` before committing."
        )
    return json.loads(golden_path.read_text())


def assert_matches_golden(name: str, tables: dict) -> None:
    """Assert `tables` (a `{table_name: [row_dict, ...]}` snapshot of the DB
    delta a trigger produced) matches the checked-in golden `goldens/{name}.json`.

    With BLESS_GOLDENS=1, writes the golden instead of asserting (see
    scripts/rebless_export_goldens.py for the reviewable-diff wrapper).
    """
    golden_path = GOLDENS_DIR / f"{name}.json"
    actual_json = _canonical_json(tables)

    if _bless_enabled():
        GOLDENS_DIR.mkdir(parents=True, exist_ok=True)
        golden_path.write_text(actual_json)
        return

    if not golden_path.exists():
        raise AssertionError(
            f"No golden file at {golden_path}.\n"
            f"Run `BLESS_GOLDENS=1 python3 scripts/rebless_export_goldens.py` "
            f"to create it, then review the diff with `git diff` before committing."
        )

    expected_json = golden_path.read_text()
    if actual_json != expected_json:
        diff = "\n".join(
            difflib.unified_diff(
                expected_json.splitlines(),
                actual_json.splitlines(),
                fromfile=f"golden (expected): {golden_path}",
                tofile="actual (this run)",
                lineterm="",
            )
        )
        raise AssertionError(
            f"DB-delta snapshot mismatch for {name!r}:\n{diff}\n\n"
            f"If this is an INTENTIONAL behavior change, run "
            f"`BLESS_GOLDENS=1 python3 scripts/rebless_export_goldens.py` and review "
            f"the diff with `git diff` before committing."
        )
