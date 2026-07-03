# T4620: fetch_or_404 Helpers + Finish Enum Adoption + queries.py Stragglers

**Status:** TODO
**Impact:** 6
**Complexity:** 4
**Created:** 2026-07-03
**Source:** Audit items E5 + E12 + E14 ([audit doc](../audit-2026-07-03-code-quality.md)) · Absorbs refactoring-standards leftovers T304/T305

## Problem

[DRY] Three mechanical backend sweeps:

1. **~45 hand-rolled existence checks, 34 "not found" wordings.** `SELECT id FROM projects WHERE id = ?` → 404 in 10+ places (clips.py:1249/:1398/:1563, exports.py:240/:457/:499, projects.py:798/:826/:860, export/framing.py:198/:383, overlay.py:136/:1189/:1417); 17 "Game not found" raise sites; raw_clips at clips.py:727/:768/:1199/:1432. Detail strings drift ("Clip not found" vs "Raw clip not found"; 5 wordings for working video; "Reel"/"Final video"/"Final video file" for one entity).
2. **Enum adoption ~20%.** `constants.py` defines ExportStatus/GameStatus/GameType/UploadStatus, but games.py imports GameStatus (:32) and still writes `'pending'`/`'ready'` literals in SQL (:315, :338, :356, :1271); `game_type` compared as literals (projects.py:96/:98, downloads.py:105/:107). Missing enums entirely: storage status (`'expired'/'active'`), export type, project mode, clip source, share type, credit sources, admin bug statuses (admin.py:1093, `'duplicate'` in SQL :1311). Aspect-ratio list `['16:9','9:16','4:3','1:1']` duplicated (projects.py:500/:621). Three failure vocabularies (`'error'` vs `'failed'` vs `'failed'/'skipped'`) — unify ONLY within each table's own enum; renaming stored values needs a migration and is out of scope unless trivial.
3. **queries.py straggler:** projects.py:338-344 hand-rewrites `latest_working_clips_subquery` with an extra `wc.id DESC` tiebreak the canonical helper lacks. Determine which ordering is CORRECT (T1532 history — same-version ties happen), fix the canonical helper if the tiebreak is right, then adopt it. This is a behavior decision, not just cleanup — small test with tied versions.

## Solution

- `app/repository.py` (or extend an existing module): `get_project_or_404(cursor, id, columns="id")`, `get_game_or_404`, `get_raw_clip_or_404`, `get_working_video_or_404` — one wording per entity. Sweep the ~45 sites.
- Extend `constants.py` (StorageStatus, ExportType, ProjectMode, ClipSource, ShareType, AspectRatio list) and use `.value` in SQL params; sweep per-file.
- **Frontend contract check:** 404 detail strings may be matched by frontend code — `grep -rn "not found" src/frontend/src` (case-insensitive) BEFORE standardizing wordings.

## Steps

1. [ ] The frontend error-string grep; protected strings listed in Progress Log.
2. [ ] Helpers + one router migrated as exemplar → then remaining routers, one commit each.
3. [ ] Enum extension + literal sweep, one file per commit; tiebreak investigation + fix with test.
4. [ ] Import check + full backend tests per commit.

## Acceptance Criteria

- [ ] Existence checks go through the helpers; one wording per entity (grep-verified)
- [ ] No status/type string literals in SQL where an enum exists
- [ ] queries.py is the only latest-working-clips implementation; tiebreak decided with a test
- [ ] No frontend-matched error string changed without its consumer updated
