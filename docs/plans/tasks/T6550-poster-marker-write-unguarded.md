# T6550: `set_project_poster_marker_time` is not column-guarded — the write 500s in the deploy→migrate window

**Status:** TODO
**Impact:** 6 | **Complexity:** 1
**Origin:** surfaced by the T6510 worker while making its dev container representative, 2026-08-05.
Pre-existing gap from T5410 (profile_db v032), not introduced by T6510.

## Problem

The read and write of `projects.poster_marker_time` are guarded **asymmetrically**.

**Read — guarded** (`app/services/poster.py:553`):
```python
def get_project_poster_marker_time(project_id):
    """...Column-guarded for the deploy->migrate window (v032 not yet applied) --
    mirrors the T6030 pattern (never raises "no such column" on a hot path)."""
    if not column_exists(cursor, "projects", "poster_marker_time"):
        return None
```

**Write — unguarded** (`app/services/poster.py:572`):
```python
def set_project_poster_marker_time(project_id, time):
    conn.execute("UPDATE projects SET poster_marker_time = ? WHERE id = ?", (time, project_id))
```

On a profile DB below v032 the read degrades to "no override" and the overlay screen loads fine, but
**dragging the preview-image marker raises `no such column: poster_marker_time` and 500s.**

Reproduced in a container whose profile DB was below head: `/poster-time` returned 500 until the
profile was migrated.

## Why it matters

Migrations do NOT auto-run on deploy — they are triggered afterwards via the admin endpoint. So
**every deploy opens a window** in which code expecting v032 runs against un-migrated profiles. The
read side was written with that window explicitly in mind; the write side was not, which makes the
failure look random: the screen works, then one gesture 500s.

This is the same class the project already treats as a landmine (a new column on a hot path breaking
un-migrated DBs), applied to a write instead of a read. The guarded read is the pattern to copy.

## Scope

- Guard `set_project_poster_marker_time` with `column_exists`, mirroring the read.
- **Decide what a guarded write does** — it must not pretend to succeed. The natural answer is to
  return a distinct "not available yet" outcome the caller surfaces honestly, rather than silently
  swallowing a user's gesture (a silent no-op would violate the no-silent-fallbacks rule just as
  loudly as a 500 violates usability). State the choice in the docstring.
- **Sweep for siblings.** `poster_marker_time` is unlikely to be the only column whose read is guarded
  and write is not. Check the other v032/T6030-era guarded reads and report any matching asymmetry
  rather than fixing only the one instance.

## Relevant files
- `src/backend/app/services/poster.py:553` (guarded read), `:572` (unguarded write)
- `src/backend/app/routers/export/overlay.py` — the `/poster-time` caller
- `.claude/knowledge/export-pipeline.md` § poster
- `src/backend/tests/test_t6030_migration_window_structural_guard.py` — the existing structural guard
  test is the natural home for a write-side case

## Classification hint
S/M-tier, backend-only, no migration. The test matters more than the fix: drive the WRITE path against
a below-head profile (drop the column, as the T6030 guard test already does) and assert it does not
raise.

## Acceptance criteria
- [ ] The write is column-guarded and does not raise on a below-head profile.
- [ ] The guarded outcome is explicit — the caller can tell the difference between "saved" and
      "not available yet"; no silent success.
- [ ] A test drives the write path with the column absent (extend the T6030 structural guard).
- [ ] Other guarded-read/unguarded-write asymmetries are swept for and reported.
