# T5260: Draft rename doesn't reach My Reels (publish freezes a stale name)

**Status:** DONE
**Impact:** 6
**Complexity:** 2
**Created:** 2026-07-17
**Updated:** 2026-07-17

## Problem

User report (2026-07-16, imankh@gmail.com on dev): renamed a reel while it was in Reel
Drafts, then clicked "Move to My Reels" — the reel appears in My Reels under its OLD name.

**Live evidence (dev, user 3ed03fb5-949d-4cfd-b708-0c758ea68ef3, profile 9fa7378c):**

| Table | Row | Name |
|-------|-----|------|
| `projects` | id 31 | `Brilliant Control - From Air.  Test Intro Image` (rename TOOK) |
| `final_videos` | id 74 (project 31, published 2026-07-17 01:22:54) | `Brilliant Control` (STALE) |

All other published finals in the profile have `final_videos.name == projects.name` — they
were never renamed between render and publish, which is why this went unnoticed.

## Root cause

`final_videos.name` is frozen when the final-video row is INSERTed at export/render time
([overlay.py:169](../../src/backend/app/routers/export/overlay.py#L169) and :1350). The
publish gesture (`POST /api/downloads/publish/{project_id}`,
[downloads.py:1207-1282](../../src/backend/app/routers/downloads.py#L1207)) sets ONLY
`published_at` + `watched_at` — it never re-freezes the name. So a draft rename AFTER
render but BEFORE publish is silently lost in the gallery.

Per the "explicit names after archive" principle (freeze derived names at publish, no
re-derivation after), the PUBLISH gesture is the correct freeze point — render is too early
because the draft remains renameable while in Drafts.

## Solution

In `publish_to_my_reels`, when setting `published_at`, also freeze the CURRENT project name
into the final video row:

```sql
UPDATE final_videos
SET published_at = CURRENT_TIMESTAMP, watched_at = NULL,
    name = (SELECT name FROM projects WHERE id = ?)
WHERE id = ?
```

(or read the project name first and pass it — match existing style). Notes:
- Before publish there is no user-facing rename path for `final_videos.name`, so copying is
  safe (the published-reel rename endpoint at downloads.py:868 only touches
  `published_at IS NOT NULL` rows, i.e. after publish).
- If the project row is missing a name (NULL), keep the existing frozen name — do not write
  NULL over it; log at info (no silent wrong data).
- Do NOT make the draft-rename gesture write to `final_videos` (two write paths for the same
  data) and do NOT re-derive names after publish (memory: explicit-names-after-archive).
- Check the frontend gallery reads `final_videos.name` only (no client-side caching of the
  old name in a store that survives the publish response).

### Data repair (dev only)

Fix the one known stale row for the reporting user (dev): final_videos id 74 name ->
project 31's current name. Decide whether a migration is warranted: the bug window (renamed
between render and publish) is narrow; a one-off `scripts/edit-user-db.py` repair on the
affected account is likely enough. Do not blanket-copy project names over published names —
published reels may have been legitimately renamed via the gallery endpoint after publish.

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/downloads.py` — `publish_to_my_reels` (~1207), gallery rename (~868)
- `src/backend/app/routers/export/overlay.py` — final_videos INSERT (name frozen at render; no change expected, reference)
- `src/backend/tests/` — add regression test: rename draft after render, publish, gallery shows new name
- Frontend (verify only): gallery/downloads list reads the published name from the API

### Related Tasks
- Principle: explicit names frozen at publish (memory feedback_explicit_names_after_archive)
- Same surface: T4110 (publish durability), v019 heal (sweep reel metadata)

## Acceptance Criteria

- [ ] Rename a draft after its final video is rendered, click Move to My Reels -> My Reels
      shows the NEW name (regression test proves it: insert final_video with old name,
      update project name, call publish, assert final_videos.name == new project name)
- [ ] Publishing a never-renamed draft is unchanged (name stays correct)
- [ ] Project-name NULL edge: existing frozen name kept, logged, publish still succeeds
- [ ] Published-reel rename via the gallery endpoint still works (no regression)
- [ ] Tests pass

## Classification hint
S/M-tier, backend-only, 1-2 files + test, no schema change. The fix is a few lines in the
publish handler; most of the work is the regression test.
