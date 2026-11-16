# T16535: Archiving a finished project keeps its clips

## In plain words

When a highlight is finished, a cleanup (the archive) later removes the project's working data from the account database to keep it small: the crop and spotlight clips and the working video, saved aside in storage. After that, changing the crop or spotlight of a finished highlight means bringing all of that back first, which is slower and breaks if anything goes wrong. The owner ruled on 2026-11-16 that archiving should not delete the clips; it should remove only the game video, which is the large file. Then a parent can redo the crop or spotlight of a finished highlight straight away (T16530). Done when a finished, archived project still has its clips and crop and spotlight data in the account database, the game video is gone, and the redo screen opens it without a restore step.

**Status:** WIP
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-16
**Updated:** 2026-11-16
**Milestone:** Automatic finish (see [EPIC.md](EPIC.md)). Prerequisite of T16530.

## How we got here

`archive_project` (`src/backend/app/services/project_archive.py`) saves the project, its working clips and its working videos to storage as one file, then deletes the clips and working videos from the database and clears the project's working video link. The sweep that runs at each sign-in archives every published project. T16520 deliberately leaves archiving to that sweep so crop and spotlight stay editable after finishing; T16530 needs them editable at any later time, and the owner ruled the clips should stay.

## The problem

Archiving deletes data a redo needs. A redo after the sweep has to restore it from storage first.

## What we will do

1. Archive keeps the clip data (working clips and the crop and spotlight data) in the database.
2. Archive removes only the game video (the large source file), once nothing else needs it.
3. Decide in design, with a named expert review, what "the working video" is: keep it if the redo needs it, drop it only if it is a large copy of the game video. State the storage cost per project before and after.
4. Existing archived projects keep working through the old restore path; no data migration of past archives is required here.

## Acceptance Criteria

- [ ] After a finished project is archived, its clips are still in the database and the redo screen opens its crop and spotlight without a restore.
- [ ] After archiving, the game video is no longer stored for that project.
- [ ] Projects archived before this change still open for redo through the existing restore path.
- [ ] Highlights that were already finished keep playing and keep their share links.

## For the implementer

### Relevant files
- `src/backend/app/services/project_archive.py` (`archive_project`, `archive_completed_projects`), `src/frontend/src/hooks/useReEditReel.js`.
- Knowledge docs: `export-pipeline.md`, `persistence-sync.md`.

### Notes
- Tier L-ish: it changes what the archive deletes. Architect design gate. State how it obeys restore-if-newer.
- Sport-neutral strings.
