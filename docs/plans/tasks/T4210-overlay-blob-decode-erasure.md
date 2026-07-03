# T4210: Overlay Highlight Erasure — Corrupt Blob Silently Becomes [] + Orphaned Full-Blob PUT

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-07-03
**Source:** Code quality audit ([audit-2026-07-03-code-quality.md](../audit-2026-07-03-code-quality.md) items A2 + A9-partial)

## Problem

**Exposure: overlay editing = the highlight product itself (retention); data loss here is permanent and user-visible.**

Two ways all of a project's highlights can be silently erased:

1. **Decode fallback.** When `highlights_data` fails to decode, the actions endpoint silently treats it as an empty list. Every overlay action then does read-modify-write of the whole blob — so the user's very next gesture (move a region, change a color) **persists the empty list**, permanently erasing every highlight region and keyframe. One bad byte becomes total loss the moment the user touches anything. This is the exact "silent fallback for internal data" pattern CLAUDE.md bans.

2. **Orphaned full-blob writer.** `PUT /export/projects/{id}/overlay-data` still exists but has **zero frontend callers** (the frontend only GETs that URL). Its docstring still claims "Called by frontend auto-save". If anything hits it (stale PWA bundle — a real recurring theme, see T4150 — an old tab, a script), it overwrites `highlights_data`, `text_overlays`, AND `effect_type`, and does **not** bump `overlay_version`, so every surgical edit made since is silently reverted and undetectable.

## Root Cause (verified)

- `src/backend/app/routers/export/overlay.py:308-313` — `_load_overlay_data`: `except Exception: highlights = []`, no log. Callers then `_save_overlay_data` (`:322-328`) the empty list back on any action.
- `src/backend/app/routers/export/overlay.py:1383-1467` — the orphaned PUT; `:1470-1575` — its private mirror into `raw_clips.default_highlight_regions` (the ONLY writer of that column).

## Solution

1. **Decode failure = visible error, never `[]`.** In `_load_overlay_data`, on decode failure: log at ERROR with `working_video_id` + exception, and raise (let the endpoint return 500). The user's gesture fails loudly; their data stays intact in the DB for recovery. Do NOT try to "repair" the blob here.
2. **Delete the PUT endpoint** (`overlay.py:1383-1467`) and the mirror function. Before deleting, verify:
   - `grep -r "overlay-data" src/frontend/src` → only GET usages (audit already confirmed: `OverlayScreen.jsx:445, 528`)
   - `grep -rn "default_highlight_regions" src/backend src/frontend` → list every reader. Leave the column and any readers untouched (no migration); just remove the writer. Note readers in the PR description so the follow-up decision (audit item E11) has the inventory.
   - Check backend tests for PUT usage; update/delete tests that exercised it.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/export/overlay.py` — `_load_overlay_data`, `_save_overlay_data`, the PUT endpoint + mirror
- `src/backend/tests/` — search for tests touching `overlay-data`

### Related Tasks
- Blocks nothing; pairs with future B6 (expected_version 409) which needs `overlay_version` to be trustworthy — deleting the version-skipping PUT is a prerequisite for that.

### Technical Notes
- `decode_data` handles both msgpack and legacy JSON (`utils/encoding.py`) — write the reproducing test by inserting literal garbage bytes into `highlights_data`, not by mocking.
- Frontend already shows a toast on failed overlay actions (wrappers in `OverlayScreen.jsx:575-745` catch and report) — a 500 here surfaces correctly with no frontend change.

## Implementation

### Steps
1. [ ] Test first: seed a working_video with corrupt `highlights_data`; assert an overlay action returns 500 AND the stored blob is byte-identical afterwards (nothing overwrote it).
2. [ ] Implement the raise-on-decode-failure.
3. [ ] Grep-verify the PUT is orphaned (frontend + tests + scripts), then delete endpoint + mirror function.
4. [ ] `python -c "from app.main import app"` + backend tests.

## Acceptance Criteria

- [ ] Corrupt blob → 500 + ERROR log; stored data never replaced by `[]`
- [ ] `PUT /export/projects/{id}/overlay-data` no longer exists (404/405)
- [ ] Reader inventory for `default_highlight_regions` documented in the PR
- [ ] Reproducing test passes and would fail on the old code
