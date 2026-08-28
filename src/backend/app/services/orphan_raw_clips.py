"""Pure classification logic for orphaned raw_clips/ R2 objects.

Extracted from scripts/cleanup_orphan_raw_clips.py (T7830) so the standalone
report/dry-run script AND the v048 profile_db migration (T7830 follow-up) share
ONE reviewed implementation instead of two copies drifting apart. This is the
SECOND occurrence of this exact logic (repo rule: abstract on the 3rd
duplication) but the data-safety stakes justify pulling it out now rather than
inlining a second, subtly-different copy in the migration — the reference-set
union below already had one real data-loss bug caught and fixed by T7830's
review; a second hand-copy risks reintroducing it.

An "orphan" is an R2 object under a profile's `raw_clips/` prefix whose basename
is NOT referenced by any current DB pointer into that prefix. Two columns point
into `raw_clips/` and BOTH must be treated as live references:
  - `raw_clips.filename`              — annotated-clip extracts + sweep extracts
                                         + direct no-game uploads.
  - `working_clips.uploaded_filename` — user-uploaded multi-clip source clips;
                                         the live export path downloads these
                                         from `raw_clips/{uploaded_filename}`.
    Omitting this column misclassifies every uploaded clip as an orphan.

SWEEP-SIGNATURE GATE (data-safety, T7830): only unreferenced objects whose
basename matches the expiry-sweep writer's `auto_{game}_{clip}_{hex}.mp4` naming
are DELETION candidates. Any other unreferenced object (a `{uuid}.mp4` shape) is
report-only / left alone — never deleted here — so a reference-set gap can never
silently delete a live user upload.
"""

from __future__ import annotations


def is_sweep_orphan_name(basename: str) -> bool:
    """True if `basename` matches the expiry-sweep writer's naming signature.

    The sweep uploads `auto_{game_id}_{clip_id}_{hex8}.mp4` (auto_export.py). Only
    these are deletion candidates — user uploads are `{uuid_hex}{ext}` and must
    never be swept even if a reference-set gap left them unreferenced.
    """
    return basename.startswith("auto_")


def classify_objects(
    referenced: set[str], objects: list[tuple[str, int]]
) -> tuple[list[tuple[str, int]], list[tuple[str, int]]]:
    """Split raw_clips/ objects into (sweep_orphans, other_unreferenced).

    `objects` is a list of (relative_path, size) where relative_path is
    'raw_clips/<basename>'. An object is unreferenced when its basename is not in
    `referenced`. Unreferenced objects further split by the sweep signature:
      - sweep_orphans      — `auto_` prefixed -> DELETION candidates.
      - other_unreferenced — everything else  -> NEVER deleted, report only.
    Referenced objects are dropped from both lists.
    """
    sweep_orphans: list[tuple[str, int]] = []
    other: list[tuple[str, int]] = []
    for rel_path, size in objects:
        basename = rel_path.split("/", 1)[1] if "/" in rel_path else rel_path
        if basename in referenced:
            continue
        if is_sweep_orphan_name(basename):
            sweep_orphans.append((rel_path, size))
        else:
            other.append((rel_path, size))
    return sweep_orphans, other


def referenced_raw_clip_filenames(conn) -> set[str]:
    """Every basename under raw_clips/ that a live DB pointer references, on the
    given sqlite3 connection (active profile DB). Unions BOTH columns that name
    raw_clips/ objects. NULL/empty excluded. Missing table (fresh/empty profile
    DB) tolerated.

    Accepts either a tuple-row-factory or sqlite3.Row connection — reads columns
    by position so it works with the migration runner's default tuple rows.
    """
    referenced: set[str] = set()
    tables = {
        r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    if "raw_clips" in tables:
        for r in conn.execute(
            "SELECT filename FROM raw_clips "
            "WHERE filename IS NOT NULL AND filename != ''"
        ).fetchall():
            referenced.add(r[0])
    if "working_clips" in tables:
        for r in conn.execute(
            "SELECT uploaded_filename FROM working_clips "
            "WHERE uploaded_filename IS NOT NULL AND uploaded_filename != ''"
        ).fetchall():
            referenced.add(r[0])
    return referenced


def list_raw_clip_objects(user_id: str) -> list[tuple[str, int]]:
    """(relative_path, size) for every object under the active profile's
    raw_clips/ prefix. relative_path is the 'raw_clips/<file>' key the app's
    storage helpers (delete_from_r2 etc.) accept. Empty list when R2 is
    disabled/unreachable."""
    from ..storage import R2_BUCKET, get_r2_client, r2_key

    client = get_r2_client()
    if not client:
        return []
    full_prefix = r2_key(user_id, "raw_clips/")
    strip = full_prefix[: -len("raw_clips/")]  # env/users/<uid>/profiles/<pid>/
    out: list[tuple[str, int]] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=R2_BUCKET, Prefix=full_prefix):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if key.endswith("/"):
                continue  # skip folder markers
            out.append((key[len(strip):], obj.get("Size", 0)))
    return out
